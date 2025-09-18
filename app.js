// app.js — Smart Scanner v4
// Firebase config
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

const $ = (id)=>document.getElementById(id);
const pad2=(n)=>String(Math.floor(n)).padStart(2,"0");
const fmt=(ts)=>{ if(!ts) return ""; const d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts)); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
const ddhhmmss=(sec)=>{ sec=Math.max(0,Math.floor(sec||0)); const d=Math.floor(sec/86400),h=Math.floor((sec%86400)/3600),m=Math.floor((sec%3600)/60),s=sec%60; return `${pad2(d)}:${pad2(h)}:${pad2(m)}:${pad2(s)}`; };

// Detect iOS Safari (rough)
function isIOSSafari(){
  return /iP(hone|ad|od)/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
}

// Auth — keep scanner buttons enabled even if not logged in
function setAppEnabled(enabled){
  document.querySelectorAll("button,input,select,textarea").forEach(el=>{
    // 不禁用掃描按鈕與條碼輸入框，避免 Safari popup 被擋時完全卡住
    if (['btn-open-scanner','btn-open-scanner-q','btn-file-scan','file-scan','t-barcode','q-barcode','force-zxing'].includes(el.id)) return;
    if (el.id==='btn-signin' || el.id==='btn-signout') return;
    el.disabled = !enabled;
  });
}
setAppEnabled(false);

// iOS Safari: 使用 Redirect 登入，避免 Popup 被擋
auth.onAuthStateChanged(async (u)=>{
  $("auth-status").textContent = u ? `已登入：${u.email}` : "尚未登入";
  $("btn-signin").style.display = u ? "none" : "inline-block";
  $("btn-signout").style.display = u ? "inline-block" : "none";
  setAppEnabled(!!u);
  if(u){ await loadHandlers(); await refreshHandlerList(); }
});

$("btn-signin").addEventListener("click", async ()=>{
  try{
    if(isIOSSafari()){
      await auth.signInWithRedirect(provider);
    }else{
      await auth.signInWithPopup(provider);
    }
  }catch(e){
    alert("登入失敗：" + e.message + (isIOSSafari() ? "\\n（iOS Safari 建議改用 Redirect，自動切換中）" : ""));
  }
});
$("btn-signout").addEventListener("click", ()=> auth.signOut());

// Firestore helpers
async function getLastFlow(barcode){
  const snap = await db.collection("flows").where("barcode_id","==",barcode).orderBy("entry_time","desc").limit(1).get();
  if(snap.empty) return null; const doc = snap.docs[0]; return { id: doc.id, ...doc.data() };
}
async function anyFlowExists(barcode){ const s = await db.collection("flows").where("barcode_id","==",barcode).limit(1).get(); return !s.empty; }
async function createTransfer({barcode, handler, titleInput}){
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

// Render helpers
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

// Scanner logic
let zxingReader=null; let detectorTimer=null;
function stopVideo(videoEl){ try{ const s=videoEl.srcObject; if(s){ s.getTracks().forEach(t=>t.stop()); } }catch(e){} videoEl.srcObject=null; }
async function preflightPermission(){ try{ const s=await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ideal:"environment"} }, audio:false }); s.getTracks().forEach(t=>t.stop()); return true; }catch(e){ return false; } }

async function startBarcodeDetector(videoEl, onText){
  if(!('BarcodeDetector' in window)) throw new Error("no-detector");
  const detector = new window.BarcodeDetector({ formats: ['qr_code','code_128','ean_13','ean_8','code_39','upc_a','upc_e'] });
  const loop = async ()=>{
    if(!videoEl.srcObject) return;
    try{ const res = await detector.detect(videoEl); if(res && res[0] && res[0].rawValue){ onText(res[0].rawValue); return; } }catch(e){}
    requestAnimationFrame(loop);
  };
  loop();
}

async function startZXing(videoElId, onText){
  zxingReader = zxingReader || new ZXing.BrowserMultiFormatReader();
  const devices = await ZXing.BrowserCodeReader.listVideoInputDevices();
  if(!devices.length) throw new Error("no-cam");
  const back = devices.find(d=>/back|rear|environment/i.test(d.label));
  const camId = (back||devices[0]).deviceId;
  await zxingReader.decodeFromVideoDevice(camId, videoElId, (res, err)=>{
    if(res && res.getText){ onText(res.getText()); }
  });
}

async function smartScan(videoElId, inputId, keepOpen=false){
  const forceZX = $("force-zxing").checked;
  const videoEl = $(videoElId); const inputEl = $(inputId);
  $("scan-help").innerHTML = "若未出現相機權限請求，請用 Safari 開啟 https 網址，或改用『拍照上傳掃碼』。";

  await preflightPermission().catch(()=>{});

  // 開串流
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio:false });
    videoEl.srcObject = stream; await videoEl.play();
  }catch(e){
    $("scan-help").innerHTML = "無法啟動相機串流，請點『以拍照上傳掃碼』後備。"; return;
  }

  const onDetected = (txt)=>{
    inputEl.value = txt;
    if(!keepOpen){
      stopVideo(videoEl);
      if(zxingReader){ try{ zxingReader.reset(); }catch(e){} }
    }
    // 連續模式：自動交接
    if(keepOpen){
      const handler = $("t-handler").value;
      const title = $("t-title").value.trim();
      // 不在這裡自動寫庫，避免未登入。交給按鈕。
    }
  };

  // 若強制 ZXing，直接走 ZXing
  if(forceZX){
    try{ await startZXing(videoElId, onDetected); }catch(e){ $("scan-help").innerHTML = "ZXing 也無法啟動，請用『以拍照上傳掃碼』。"; }
    return;
  }

  // 先 BarcodeDetector，5 秒內沒結果就切 ZXing
  let switched = false;
  try{
    await startBarcodeDetector(videoEl, (txt)=>{ if(switched) return; switched=true; onDetected(txt); });
  }catch(e){
    switched=true;
    try{ await startZXing(videoElId, onDetected); }catch(err){ $("scan-help").innerHTML = "無法啟動掃描，請用『以拍照上傳掃碼』。"; }
    return;
  }
  detectorTimer = setTimeout(async ()=>{
    if(!switched){
      switched=true;
      try{ await startZXing(videoElId, onDetected); }catch(err){ $("scan-help").innerHTML = "無法啟動掃描，請用『以拍照上傳掃碼』。"; }
    }
  }, 5000);
}

// Fallback: photo upload scan via ZXing
$("btn-file-scan").addEventListener("click", ()=> $("file-scan").click());
$("file-scan").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  const url = URL.createObjectURL(file); const img = new Image();
  img.onload = async ()=>{
    const reader = new ZXing.BrowserMultiFormatReader();
    try{ const result = await reader.decodeFromImageElement(img); $("t-barcode").value = result.getText(); }
    catch{ alert("無法從照片辨識條碼，請再試一次（請對焦、光線足）。"); }
    finally{ URL.revokeObjectURL(url); e.target.value=""; }
  };
  img.src = url;
});

// Handlers
async function loadHandlers(){
  const sel = $("t-handler"); sel.innerHTML="";
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

// Actions
$("btn-open-scanner").addEventListener("click", ()=> smartScan("video","t-barcode", $("t-batch").checked));
$("btn-open-scanner-q").addEventListener("click", ()=> smartScan("video-q","q-barcode", false));

$("btn-transfer").addEventListener("click", async ()=>{
  const barcode=$("t-barcode").value.trim(); const handler=$("t-handler").value; const title=$("t-title").value.trim();
  if(!barcode){ alert("請輸入條碼號碼"); return; }
  try{
    if($("t-batch").checked){ const exists=await anyFlowExists(barcode); if(!exists && !title){ $("t-result").innerHTML = `<span class="card error">第一筆需輸入標題，已跳過。</span>`; return; } }
    await createTransfer({ barcode, handler, titleInput: title });
    $("t-result").textContent="已新增 / 交接完成。"; if(!$("t-batch").checked){ $("t-barcode").value=""; }
  }catch(e){ $("t-result").innerHTML = `<span class="card error">錯誤：${e.message}</span>`; }
});

$("btn-query").addEventListener("click", async ()=>{
  const barcode=$("q-barcode").value.trim(); if(!barcode){ alert("請輸入條碼號碼"); return; }
  const curEl=$("q-current"); const tbody=document.querySelector("#history-table tbody"); curEl.innerHTML=""; tbody.innerHTML="";
  try{ const {current, history}=await queryByBarcode(barcode); renderCurrent(curEl,current); renderHistory(tbody,history); }
  catch(e){ curEl.innerHTML = `<div class="card error">錯誤：${e.message}</div>`; }
});

$("btn-range-query").addEventListener("click", async ()=>{
  const s=$("q-start").value; const e=$("q-end").value; const start=s?new Date(s):null; const end=e?new Date(e):null; const box=$("range-results"); box.innerHTML="查詢中…";
  try{ const rows=await rangeQuery(start,end); renderRangeResults(box,rows); }catch(err){ box.innerHTML = `<div class="card error">錯誤：${err.message}</div>`; }
});
$("btn-report").addEventListener("click", async ()=>{
  const s=$("r-start").value; const e=$("r-end").value; const start=s?new Date(s):null; const end=e?new Date(e):null; const cards=$("report-cards"); const list=$("report-list"); list.innerHTML="查詢中…";
  try{ const rep=await buildReport(start,end); renderReportCards(cards,rep); renderReportList(list,rep.rows); }catch(err){ list.innerHTML = `<div class="card error">錯誤：${err.message}</div>`; }
});
