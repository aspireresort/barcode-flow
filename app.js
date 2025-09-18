// app.js — Smart Scanner v4.6

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
const fmt=(ts)=>{ if(!ts) return ""; const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts)); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
const ddhhmmss=(sec)=>{ sec=Math.max(0,Math.floor(sec||0)); const d=Math.floor(sec/86400),h=Math.floor((sec%86400)/3600),m=Math.floor((sec%3600)/60),s=sec%60; return `${pad2(d)}:${pad2(h)}:${pad2(m)}:${pad2(s)}`; };
function isIOSSafari(){ return /iP(hone|ad|od)/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent); }
function log(msg){ const b=$("debug-log"); if(!b) return; const d=document.createElement("div"); d.textContent=msg; b.appendChild(d); }

// Auth（Redirect on iOS）
auth.onAuthStateChanged(async (u)=>{
  $("auth-status").textContent = u ? `已登入：${u.email}` : "尚未登入（未登入時可測試掃描，但無法寫入）";
  $("btn-signin").style.display = u ? "none" : "inline-block";
  $("btn-signout").style.display = u ? "inline-block" : "none";
  if(u){ await loadHandlers(); await refreshHandlerList(); }
});
$("btn-signin").addEventListener("click", async ()=>{
  try{
    if(isIOSSafari()) await auth.signInWithRedirect(provider);
    else await auth.signInWithPopup(provider);
  }catch(e){
    log("Auth error: "+e.code+" / "+e.message);
    alert("登入失敗："+e.message+"。請確認 Firebase Auth 已啟用 Google，且已把 github pages 網域加入 Authorized domains。");
  }
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

// Firestore helpers（與前版相同）
async function getLastFlow(barcode){
  const snap = await db.collection("flows").where("barcode_id","==",barcode).orderBy("entry_time","desc").limit(1).get();
  if(snap.empty) return null; const doc = snap.docs[0]; return { id: doc.id, ...doc.data() };
}
async function anyFlowExists(barcode){ const s = await db.collection("flows").where("barcode_id","==",barcode).limit(1).get(); return !s.empty; }
async function createTransfer({barcode, handler, titleInput}){
  if(!auth.currentUser){ alert("尚未登入，無法寫入紀錄。請先登入 Google。"); return; }
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

// —— 掃描（Canvas Polling for iOS）——
let zxingReader=null; let currentStream=null; let torchOn=false; let pollingTimer=null;
function stopVideo(videoEl){ try{ const s=videoEl.srcObject; if(s){ s.getTracks().forEach(t=>t.stop()); } }catch(e){} videoEl.srcObject=null; currentStream=null; }
function stopPolling(){ if(pollingTimer){ clearInterval(pollingTimer); pollingTimer=null; } }
function buildZXingReader(hintsMode="code128-first"){
  const ZX = window.ZXing;
  if(!ZX || !ZX.BrowserMultiFormatReader){ alert("ZXing 載入失敗，請重新整理頁面或檢查網路"); return null; }
  if(zxingReader) return zxingReader;
  let hints = undefined;
  try{
    const H = ZX.DecodeHintType;
    const BF = ZX.BarcodeFormat;
    hints = new Map();
    hints.set(H.TRY_HARDER, true);
    if(hintsMode === "code128-first"){
      hints.set(H.POSSIBLE_FORMATS, [BF.CODE_128]);
    }else{
      hints.set(H.POSSIBLE_FORMATS, [BF.CODE_128,BF.CODE_39,BF.EAN_13,BF.EAN_8,BF.QR_CODE,BF.UPC_A,BF.UPC_E,BF.ITF,BF.CODABAR]);
    }
  }catch(e){
    // 某些環境沒有 HintType 也能跑，忽略
  }
  zxingReader = new ZX.BrowserMultiFormatReader(hints);
  return zxingReader;
}
async function startStream(videoEl){
  const constraints = { audio:false, video:{ facingMode:{ideal:"environment"}, width:{ideal:1920}, height:{ideal:1080} } };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream; await videoEl.play(); currentStream = stream;
  return stream;
}
function startCanvasPolling(videoEl, onText, hintsMode="code128-first"){
  const ZX = window.ZXing;
  const reader = buildZXingReader(hintsMode); if(!reader) throw new Error("zxing-missing");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  stopPolling();
  pollingTimer = setInterval(async ()=>{
    try{
      const w = videoEl.videoWidth || 1280;
      const h = videoEl.videoHeight || 720;
      if(w===0||h===0) return;
      canvas.width = w; canvas.height = h;
      ctx.drawImage(videoEl,0,0,w,h);
      const res = await reader.decodeFromCanvas(canvas);
      if(res && res.getText){
        log("ZXing 解碼："+res.getText());
        onText(res.getText());
      }
    }catch(e){
      // 每幀嘗試，解不到就忽略，過幾幀再試
    }
  }, 160); // 約 6 FPS
}

function showDecodedPreview(txt){ const box=$("scan-preview"); if(box) box.innerHTML = `<div>最近一次解碼：<strong>${txt}</strong></div>`; }
async function toggleTorch(){
  if(!currentStream){ alert("請先開啟相機"); return; }
  const track = currentStream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if(!caps.torch){ alert("裝置不支援手電筒或瀏覽器未開放"); return; }
  torchOn = !torchOn;
  try{ await track.applyConstraints({ advanced:[ { torch: torchOn } ] }); }catch(e){ alert("無法切換手電筒：" + e.message); }
}

// 綁定掃描按鈕
$("btn-open-scanner").addEventListener("click", async ()=>{
  const keepOpen = $("t-batch").checked;
  const onText=(txt)=>{ $("t-barcode").value = txt; showDecodedPreview(txt); if(!keepOpen){ stopPolling(); stopVideo($("video")); } };
  try{
    await startStream($("video"));
    $("scan-help").textContent = "請把 Code128 水平放置，距離 15–25cm，必要時開啟手電筒。";
    startCanvasPolling($("video"), onText, "code128-first");
  }catch(e){
    $("scan-help").textContent = "相機開啟失敗，請改用『照片上傳掃碼』。"; log("open-scanner error: "+e);
  }
});
$("btn-snapshot").addEventListener("click", async ()=>{
  // 用現在幀做一次 decode（相當於立即輪詢一次）
  const ZX = window.ZXing;
  const reader = buildZXingReader("code128-first"); if(!reader) return;
  const videoEl = $("video");
  const canvas = document.createElement("canvas");
  canvas.width = videoEl.videoWidth || 1280;
  canvas.height = videoEl.videoHeight || 720;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  try{
    const res = await reader.decodeFromCanvas(canvas);
    $("t-barcode").value = res.getText(); showDecodedPreview(res.getText());
    log("手動擷取解碼："+res.getText());
  }catch(e){
    alert("此張影像無法解碼，請再靠近、對焦、補光或換角度後重試。");
    log("snapshot decode fail: "+e);
  }
});
$("btn-torch").addEventListener("click", toggleTorch);

$("btn-file-scan").addEventListener("click", ()=> $("file-scan").click());
$("file-scan").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  const url = URL.createObjectURL(file); const img = new Image();
  img.onload = async ()=>{
    const reader = buildZXingReader("code128-first"); if(!reader){ URL.revokeObjectURL(url); e.target.value=""; return; }
    try{ const result = await reader.decodeFromImageElement(img); $("t-barcode").value = result.getText(); showDecodedPreview(result.getText()); }
    catch{ alert("無法從照片辨識條碼，請換更清晰的照片"); }
    finally{ URL.revokeObjectURL(url); e.target.value=""; }
  };
  img.src = url;
});

// Handlers（與前版相同）
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

// 交接 / 查詢 / 報表
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
    startCanvasPolling($("video-q"), (txt)=>{ $("q-barcode").value = txt; showDecodedPreview(txt); stopPolling(); stopVideo($("video-q")); }, "code128-first");
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

// 報表
$("btn-range-query").addEventListener("click", async ()=>{
  const s=$("q-start").value; const e=$("q-end").value; const start=s?new Date(s):null; const end=e?new Date(e):null; const box=$("range-results"); box.innerHTML="查詢中…";
  try{ const rows=await rangeQuery(start,end); renderRangeResults(box,rows); }catch(err){ box.innerHTML = `<div class="card error">錯誤：${err.message}</div>`; }
});
$("btn-report").addEventListener("click", async ()=>{
  const s=$("r-start").value; const e=$("r-end").value; const start=s?new Date(s):null; const end=e?new Date(e):null; const cards=$("report-cards"); const list=$("report-list"); list.innerHTML="查詢中…";
  try{ const rep=await buildReport(start,end); const ks=cards.querySelectorAll(".stat .k"); ks[0].textContent=rep.newCount; ks[1].textContent=rep.transferCount; ks[2].textContent=rep.avgStayStr; renderReportList(list,rep.rows); }
  catch(err){ list.innerHTML = `<div class="card error">錯誤：${err.message}</div>`; }
});
