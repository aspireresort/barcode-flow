// app.js — Smart Scanner v4.4

// Firebase 初始化
const firebaseConfig = {
  apiKey: "AIzaSyBUmWFAfcwLdhRBJ4GFkfqe_m7DOgrE808",
  authDomain: "ar-fo-2501.firebaseapp.com",
  projectId: "ar-fo-2501",
  storageBucket: "ar-fo-2501.firebasestorage.app",
  messagingSenderId: "55341993889",
  appId: "1:55341993889:web:9c1430f86bec918bb845e0"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

// 工具
const $ = (id)=>document.getElementById(id);
const pad2=(n)=>String(Math.floor(n)).padStart(2,"0");
const fmt=(ts)=>{ if(!ts) return ""; const d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts)); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
const ddhhmmss=(sec)=>{ sec=Math.max(0,Math.floor(sec||0)); const d=Math.floor(sec/86400),h=Math.floor((sec%86400)/3600),m=Math.floor((sec%3600)/60),s=sec%60; return `${pad2(d)}:${pad2(h)}:${pad2(m)}:${pad2(s)}`; };
function isIOSSafari(){ return /iP(hone|ad|od)/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent); }
function log(msg){ const b=$("debug-log"); if(!b) return; const d=document.createElement("div"); d.textContent=msg; b.appendChild(d); }

// Auth（按鈕永遠可點，寫入時才檢查登入）
function requireLogin(){ if(!auth.currentUser){ alert("請先登入 Google 才能寫入資料"); return false; } return true; }
auth.onAuthStateChanged(async (u)=>{
  $("auth-status").textContent = u ? `已登入：${u.email}` : "尚未登入";
  $("btn-signin").style.display = u ? "none" : "inline-block";
  $("btn-signout").style.display = u ? "inline-block" : "none";
  if(u){ await loadHandlers(); await refreshHandlerList(); }
});
$("btn-signin").addEventListener("click", async ()=>{
  try{ if(isIOSSafari()) await auth.signInWithRedirect(provider); else await auth.signInWithPopup(provider); }
  catch(e){ alert("登入失敗：" + e.message); }
});
$("btn-signout").addEventListener("click", ()=>auth.signOut());

// 分頁
document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active"); document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// Firestore helpers
async function getLastFlow(barcode){
  const snap = await db.collection("flows").where("barcode_id","==",barcode).orderBy("entry_time","desc").limit(1).get();
  if(snap.empty) return null; const doc = snap.docs[0]; return { id: doc.id, ...doc.data() };
}
async function anyFlowExists(barcode){ const s = await db.collection("flows").where("barcode_id","==",barcode).limit(1).get(); return !s.empty; }
async function createTransfer({barcode, handler, titleInput}){
  if(!requireLogin()) return;
  const now = new Date(); const last = await getLastFlow(barcode); let title = titleInput;
  if(last){
    title = last.title || titleInput;
    if(!last.leave_time){
      const staySec = Math.floor((now - last.entry_time.toDate())/1000);
      await db.collection("flows").doc(last.id).update({ leave_time: now, stay_duration_seconds: staySec, stay_duration_str: ddhhmmss(staySec), status: "已完成" });
    }
  }else{
    if(!title || !title.trim()) throw new Error("第一筆紀錄必須輸入『文件標題』。");
  }
  await db.collection("flows").add({ barcode_id: barcode, title, handler, entry_time: now, leave_time: null, stay_duration_seconds: 0, stay_duration_str: "", status: "在手上" });
  return true;
}
async function queryByBarcode(barcode){
  const current = await getLastFlow(barcode);
  const histSnap = await db.collection("flows").where("barcode_id","==",barcode).orderBy("entry_time","asc").get();
  const history = histSnap.docs.map(d=>({id:d.id,...d.data()}));
  return {current, history};
}
async function rangeQuery(start,end){
  let q = db.collection("flows").orderBy("entry_time","asc");
  if(start) q=q.where("entry_time",">=",start);
  if(end) q=q.where("entry_time","<=",end);
  const snap = await q.get(); const rows = snap.docs.map(d=>({id:d.id,...d.data()}));
  const results=[];
  for(const r of rows){
    const early = await db.collection("flows").where("barcode_id","==",r.barcode_id).where("entry_time","<", r.entry_time).limit(1).get();
    results.push({...r,__isFirst: early.empty});
  }
  return results;
}
async function buildReport(start,end){
  let q = db.collection("flows").orderBy("entry_time","asc");
  if(start) q=q.where("entry_time",">=",start);
  if(end) q=q.where("entry_time","<=",end);
  const snap = await q.get(); const rows = snap.docs.map(d=>({id:d.id,...d.data()}));
  let newCount=0, transferCount=0, totalStay=0, n=0;
  for(const r of rows){
    const early = await db.collection("flows").where("barcode_id","==",r.barcode_id).where("entry_time","<", r.entry_time).limit(1).get();
    if(early.empty) newCount++; else transferCount++;
    if(r.leave_time && r.stay_duration_seconds && (!start || r.leave_time.toDate()>=start) && (!end || r.leave_time.toDate()<=end)){ totalStay += Number(r.stay_duration_seconds||0); n++; }
  }
  return { rows, newCount, transferCount, avgStayStr: n?ddhhmmss(totalStay/n):"—" };
}

// 掃描
let zxingReader=null; let currentStream=null; let torchOn=false;
function stopVideo(videoEl){ try{ const s=videoEl.srcObject; if(s){ s.getTracks().forEach(t=>t.stop()); } }catch(e){} videoEl.srcObject=null; currentStream=null; }
async function startStream(videoEl){
  const constraints = {
    audio:false,
    video:{
      facingMode:{ ideal:"environment" },
      width:{ min:640, ideal:1920, max:3840 },
      height:{ min:480, ideal:1080, max:2160 }
    }
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream; await videoEl.play();
  currentStream = stream;
}
function buildZXingReader(){
  const ZX = window.ZXing;
  log("ZX type: "+typeof ZX+"; has BrowserMultiFormatReader: "+(ZX && ZX.BrowserMultiFormatReader ? "yes":"no"));
  if(!ZX || !ZX.BrowserMultiFormatReader){ alert("ZXing 載入失敗，請重新整理頁面或檢查網路"); return null; }
  if(zxingReader) return zxingReader;
  const hints = new Map();
  if(ZX.DecodeHintType){ // 某些瀏覽器可能沒有 HintType 也能正常運作
    hints.set(ZX.DecodeHintType.TRY_HARDER, true);
    if(ZX.BarcodeFormat){
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
        ZX.BarcodeFormat.CODE_128,
        ZX.BarcodeFormat.CODE_39,
        ZX.BarcodeFormat.EAN_13,
        ZX.BarcodeFormat.EAN_8,
        ZX.BarcodeFormat.QR_CODE,
        ZX.BarcodeFormat.UPC_A,
        ZX.BarcodeFormat.UPC_E,
        ZX.BarcodeFormat.ITF,
        ZX.BarcodeFormat.CODABAR
      ].filter(Boolean));
    }
  }
  zxingReader = new ZX.BrowserMultiFormatReader(hints);
  return zxingReader;
}
function showDecodedPreview(txt){ const box=$("scan-preview"); if(box) box.innerHTML = `<div>最近一次解碼：<strong>${txt}</strong></div>`; }
async function startZXingContinuous(videoElId, onText){
  const ZX = window.ZXing;
  const reader = buildZXingReader(); if(!reader) throw new Error("zxing-missing");
  let devices = await ZX.BrowserCodeReader.listVideoInputDevices();
  if(!devices.length){
    try{ await startStream($("video")); devices = await ZX.BrowserCodeReader.listVideoInputDevices(); }catch(e){}
  }
  if(!devices.length) throw new Error("no-cam");
  const back = devices.find(d=>/back|rear|environment/i.test(d.label));
  const camId = (back||devices[0]).deviceId;
  log("使用 ZXing 相機ID: "+camId);
  await reader.decodeFromVideoDevice(camId, videoElId, (res, err)=>{
    if(res && res.getText){ log("ZXing 解碼："+res.getText()); onText(res.getText()); }
  });
}
async function snapshotDecode(videoEl){
  const ZX = window.ZXing;
  const reader = buildZXingReader(); if(!reader) return null;
  const canvas = document.createElement("canvas");
  canvas.width = videoEl.videoWidth || 1280;
  canvas.height = videoEl.videoHeight || 720;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  try{
    const result = await reader.decodeFromCanvas(canvas);
    showDecodedPreview(result.getText());
    return result.getText();
  }catch(e){
    alert("此張影像無法解碼，請靠近、對焦、補光或換角度再試。");
    log("snapshot decode fail: "+e);
    return null;
  }
}
async function toggleTorch(){
  if(!currentStream){ alert("請先開啟相機"); return; }
  const track = currentStream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if(!caps.torch){ alert("裝置不支援手電筒或瀏覽器未開放"); return; }
  torchOn = !torchOn;
  try{ await track.applyConstraints({ advanced:[ { torch: torchOn } ] }); }catch(e){ alert("無法切換手電筒：" + e.message); }
}

// 綁定
$("btn-open-scanner").addEventListener("click", async ()=>{
  const keepOpen = $("t-batch").checked;
  const onText=(txt)=>{ $("t-barcode").value = txt; showDecodedPreview(txt); if(!keepOpen) stopVideo($("video")); };
  try{
    await startStream($("video")); // 確保串流已開
    await startZXingContinuous("video", onText);
    $("scan-help").textContent = "請將條碼置中，距離 15–30cm，必要時開啟手電筒。";
  }catch(e){
    $("scan-help").textContent = "ZXing 啟動失敗，請改用『照片上傳掃碼』。"; log("open-scanner error: "+e);
  }
});
$("btn-snapshot").addEventListener("click", async ()=>{
  const code = await snapshotDecode($("video")); if(code){ $("t-barcode").value = code; }
});
$("btn-torch").addEventListener("click", toggleTorch);

$("btn-file-scan").addEventListener("click", ()=> $("file-scan").click());
$("file-scan").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  const url = URL.createObjectURL(file); const img = new Image();
  img.onload = async ()=>{
    const reader = buildZXingReader(); if(!reader){ URL.revokeObjectURL(url); e.target.value=""; return; }
    try{ const result = await reader.decodeFromImageElement(img); $("t-barcode").value = result.getText(); showDecodedPreview(result.getText()); }
    catch{ alert("無法從照片辨識條碼，請換更清晰的照片"); }
    finally{ URL.revokeObjectURL(url); e.target.value=""; }
  };
  img.src = url;
});

// Handlers
async function loadHandlers(){
  const sel = $("t-handler"); if(!sel) return; sel.innerHTML="";
  const snap = await db.collection("handlers").orderBy("name","asc").get();
  if(snap.empty){ ["王小明","李小華","陳大同"].forEach(n=>{ const o=document.createElement("option"); o.value=n; o.textContent=n; sel.appendChild(o); }); }
  else{ snap.forEach(doc=>{ const n=doc.data().name; const o=document.createElement("option"); o.value=n; o.textContent=n; sel.appendChild(o); }); }
}
async function refreshHandlerList(){
  const wrap=$("h-list"); if(!wrap) return; wrap.innerHTML="";
  const snap=await db.collection("handlers").orderBy("name","asc").get();
  if(snap.empty){ wrap.innerHTML="<div class='muted tiny'>尚無經手人</div>"; return; }
  snap.forEach(doc=>{
    const id=doc.id, n=doc.data().name;
    const div=document.createElement("div"); div.className="card";
    div.innerHTML=`<div class="row"><div>${n}</div><div><button data-id="${id}" class="danger">刪除</button></div></div>`;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll("button.danger").forEach(btn=>{
    btn.addEventListener("click", async ()=>{ const id=btn.getAttribute("data-id"); await db.collection("handlers").doc(id).delete(); await loadHandlers(); await refreshHandlerList(); });
  });
}
$("btn-h-add")?.addEventListener("click", async ()=>{
  const name = $("h-name").value.trim(); if(!name){ alert("請輸入姓名"); return; }
  await db.collection("handlers").add({ name }); $("h-name").value=""; await loadHandlers(); await refreshHandlerList();
});

// 查詢、報表
$("btn-transfer").addEventListener("click", async ()=>{
  const barcode=$("t-barcode").value.trim(); const handler=$("t-handler").value; const title=$("t-title").value.trim();
  if(!barcode){ alert("請輸入條碼號碼"); return; }
  try{
    if($("t-batch").checked){ const exists=await anyFlowExists(barcode); if(!exists && !title){ $("t-result").innerHTML = `<span class="card error">第一筆需輸入標題，已跳過。</span>`; return; } }
    await createTransfer({ barcode, handler, titleInput: title });
    $("t-result").textContent="已新增 / 交接完成。"; if(!$("t-batch").checked){ $("t-barcode").value=""; }
  }catch(e){ $("t-result").innerHTML = `<span class="card error">錯誤：${e.message}</span>`; }
});

$("btn-open-scanner-q").addEventListener("click", async ()=>{
  try{
    await startStream($("video-q"));
    await startZXingContinuous("video-q", (txt)=>{ $("q-barcode").value = txt; showDecodedPreview(txt); stopVideo($("video-q")); });
  }catch(e){
    $("range-results").innerHTML = `<div class="card error">查詢用相機啟動失敗，請直接輸入條碼。</div>`;
  }
});
$("btn-query").addEventListener("click", async ()=>{
  const barcode=$("q-barcode").value.trim(); if(!barcode){ alert("請輸入條碼號碼"); return; }
  const curEl=$("q-current"); const tbody=document.querySelector("#history-table tbody"); curEl.innerHTML=""; tbody.innerHTML="";
  try{ const {current, history}=await queryByBarcode(barcode); renderCurrent(curEl,current); renderHistory(tbody,history); }
  catch(e){ curEl.innerHTML = `<div class="card error">錯誤：${e.message}</div>`; }
});

function renderCurrent(el,current){
  if(!current){ el.innerHTML = `<div class="card error">查無資料。</div>`; return; }
  let stay = current.stay_duration_str || "";
  if(!current.leave_time && current.entry_time){ stay = ddhhmmss((Date.now()-current.entry_time.toDate().getTime())/1000); }
  el.innerHTML = `<div class="card">
    <div><strong>條碼：</strong>${current.barcode_id}</div><div><strong>標題：</strong>${current.title||"-"}</div>
    <div><strong>目前經手人：</strong>${current.handler||"-"}</div><div><strong>狀態：</strong>${current.status||"-"}</div>
    <div><strong>進入時間：</strong>${fmt(current.entry_time)}</div><div><strong>離開時間：</strong>${fmt(current.leave_time)}</div>
    <div><strong>停留時長：</strong>${stay}</div></div>`;
}
function renderHistory(tbody, rows){
  tbody.innerHTML=""; rows.forEach(r=>{
    let stay=r.stay_duration_str||""; if(!r.leave_time && r.entry_time){ stay = ddhhmmss((Date.now()-r.entry_time.toDate().getTime())/1000); }
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${r.barcode_id}</td><td>${r.title||""}</td><td>${r.handler||""}</td><td>${fmt(r.entry_time)}</td><td>${fmt(r.leave_time)}</td><td>${stay}</td><td>${r.status||""}</td>`;
    tbody.appendChild(tr);
  });
}
function renderRangeResults(container, rows){
  const firsts=rows.filter(r=>r.__isFirst), transfers=rows.filter(r=>!r.__isFirst);
  const block=(title,list)=>{
    const items=list.map(r=>`<div class="card tiny"><div><strong>${r.barcode_id}</strong> — ${r.title||""}</div>
      <div>經手人：${r.handler||""}</div><div>進入：${fmt(r.entry_time)}；離開：${fmt(r.leave_time)||"-"}</div>
      <div>停留：${r.stay_duration_str||"-"}</div></div>`).join("");
    return `<h4>${title}（${list.length}）</h4>${items||"<div class='muted tiny'>無資料</div>"}`;
  };
  container.innerHTML = block("新增（第一筆）",firsts)+block("交接（非第一筆）",transfers);
}
function renderReportCards(container,{newCount,transferCount,avgStayStr}){
  const ks=container.querySelectorAll(".stat .k"); ks[0].textContent=newCount; ks[1].textContent=transferCount; ks[2].textContent=avgStayStr;
}
function renderReportList(container, rows){
  if(!rows.length){ container.innerHTML="<div class='muted tiny'>無資料</div>"; return; }
  container.innerHTML = rows.map(r=>`<div class="card tiny"><div><strong>${r.barcode_id}</strong> — ${r.title||""}</div>
    <div>經手人：${r.handler||""}</div><div>進入：${fmt(r.entry_time)}；離開：${fmt(r.leave_time)||"-"}</div>
    <div>停留：${r.stay_duration_str||"-"}</div></div>`).join("");
}

// 報表按鈕
$("btn-range-query").addEventListener("click", async ()=>{
  const s=$("q-start").value; const e=$("q-end").value; const start=s?new Date(s):null; const end=e?new Date(e):null; const box=$("range-results"); box.innerHTML="查詢中…";
  try{ const rows=await rangeQuery(start,end); renderRangeResults(box,rows); }catch(err){ box.innerHTML = `<div class="card error">錯誤：${err.message}</div>`; }
});
$("btn-report").addEventListener("click", async ()=>{
  const s=$("r-start").value; const e=$("r-end").value; const start=s?new Date(s):null; const end=e?new Date(e):null; const cards=$("report-cards"); const list=$("report-list"); list.innerHTML="查詢中…";
  try{ const rep=await buildReport(start,end); 
       const ks=cards.querySelectorAll(".stat .k"); ks[0].textContent=rep.newCount; ks[1].textContent=rep.transferCount; ks[2].textContent=rep.avgStayStr;
       renderReportList(list,rep.rows); }catch(err){ list.innerHTML = `<div class="card error">錯誤：${err.message}</div>`; }
});
