// app.js — Smart Scanner v4.8

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

// —— Auth（沿用 v4.7） ——
(async ()=>{
  try{ await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); log("Auth persistence: LOCAL"); }catch(e){ log("setPersistence error: "+e.message); }
  try{ const res = await auth.getRedirectResult(); if(res && res.user){ log("Redirect 回來，已登入："+res.user.email); } }catch(e){ log("getRedirectResult error: "+e.code+" / "+e.message); }
})();
auth.onAuthStateChanged(async (u)=>{
  $("auth-status").textContent = u ? `已登入：${u.email}` : "尚未登入（未登入時可測試掃描，但無法寫入）";
  $("btn-signin").style.display = u ? "none" : "inline-block";
  $("btn-signout").style.display = u ? "inline-block" : "none";
  if(u){ await loadHandlers(); await refreshHandlerList(); }
});
$("btn-signin").addEventListener("click", async ()=>{
  try{ if(isIOSSafari()) await auth.signInWithRedirect(provider); else await auth.signInWithPopup(provider); }
  catch(e){ log("Auth error: "+e.code+" / "+e.message); alert("登入失敗："+e.message); }
});
$("btn-signout").addEventListener("click", ()=>auth.signOut());

// Firestore helpers（同前）
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

// —— 掃描引擎：BarcodeDetector → Quagga2（fallback）→ ZXing（最後保底） ——
let currentStream=null; let torchOn=false; let intervalId=null; let usingEngine=""; let bd=null;
function clearIntervalSafe(){ if(intervalId){ clearInterval(intervalId); intervalId=null; } }
function logEngine(){ log("使用引擎："+usingEngine); }
async function startStream(videoEl){
  const constraints = {
    audio:false,
    video:{
      facingMode:{ ideal:"environment" },
      width:{ ideal:1920, min:1280 },
      height:{ ideal:1080, min:720 }
    }
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
  await new Promise(r=> videoEl.onloadedmetadata = ()=>{ videoEl.play(); r(); });
  currentStream = stream;
  log(`Video ready: ${videoEl.videoWidth}x${videoEl.videoHeight}`);
  return stream;
}
function stopVideo(videoEl){ try{ const s=videoEl.srcObject; if(s){ s.getTracks().forEach(t=>t.stop()); } }catch(e){} videoEl.srcObject=null; currentStream=null; clearIntervalSafe(); if(window.Quagga){ try{ Quagga.stop(); }catch{} } }

function roiCanvas(videoEl){
  const zoom = $("opt-zoom").checked;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const w = videoEl.videoWidth || 1280, h = videoEl.videoHeight || 720;
  if(zoom){
    // 取中間 60% 高度、100% 寬度，並放大到 2x（提升 Code128 成功率）
    const roiH = Math.floor(h*0.6), y = Math.floor((h-roiH)/2);
    canvas.width = w*2; canvas.height = roiH*2;
    ctx.drawImage(videoEl, 0, y, w, roiH, 0, 0, canvas.width, canvas.height);
  }else{
    canvas.width = w; canvas.height = h;
    ctx.drawImage(videoEl, 0, 0, w, h);
  }
  return canvas;
}

// A) Native BarcodeDetector
async function tryBarcodeDetector(videoEl, onText){
  if(!("BarcodeDetector" in window)){ return false; }
  const formats = await window.BarcodeDetector.getSupportedFormats();
  if(!formats.includes("code_128") && !formats.includes("codabar") && !formats.includes("code_39")){ return false; }
  bd = new window.BarcodeDetector({ formats: formats.includes("code_128") ? ["code_128"] : formats });
  usingEngine = "BarcodeDetector"; logEngine();
  clearIntervalSafe();
  intervalId = setInterval(async ()=>{
    try{
      const canvas = roiCanvas(videoEl);
      const bitmap = await createImageBitmap(canvas);
      const codes = await bd.detect(bitmap);
      if(codes && codes.length){
        const txt = codes[0].rawValue || codes[0].rawValueText || "";
        if(txt){ onText(txt); }
      }
    }catch(e){ /* ignore per tick */ }
  }, 120);
  return true;
}

// B) Quagga2 Fallback
async function tryQuaggaLive(videoEl, onText){
  if(!window.Quagga) return false;
  usingEngine = "Quagga2"; logEngine();
  clearIntervalSafe();
  // Quagga 會自己建立 video，這裡用 target 容器包裹現有 <video> 的父層
  const target = videoEl.parentElement; // .video-wrap
  return new Promise((resolve)=>{
    Quagga.init({
      inputStream:{
        name:"Live",
        type:"LiveStream",
        target: target,
        constraints:{ facingMode:"environment", width:{ideal:1920}, height:{ideal:1080} }
      },
      locator:{ patchSize:"large", halfSample:true },
      decoder:{ readers:["code_128_reader","code_39_reader","ean_reader","ean_8_reader","upc_reader","upc_e_reader","i2of5_reader"] },
      locate:true,
      frequency: 10
    }, (err)=>{
      if(err){ log("Quagga init error: "+err); resolve(false); return; }
      Quagga.start();
      Quagga.onDetected((data)=>{
        const code = data?.codeResult?.code;
        if(code){ onText(code); }
      });
      resolve(true);
    });
  });
}

// C) ZXing Last Resort（decode snapshot every tick）
async function tryZXingPolling(videoEl, onText){
  const ZX = window.ZXing;
  if(!ZX || !ZX.BrowserMultiFormatReader) return false;
  usingEngine = "ZXing"; logEngine();
  const reader = new ZX.BrowserMultiFormatReader();
  clearIntervalSafe();
  intervalId = setInterval(async ()=>{
    try{
      const canvas = roiCanvas(videoEl);
      const res = await reader.decodeFromCanvas(canvas);
      if(res?.getText){ onText(res.getText()); }
    }catch(e){}
  }, 150);
  return true;
}

// UI 綁定 — 開啟掃描
$("btn-open-scanner").addEventListener("click", async ()=>{
  const keepOpen = $("t-batch").checked;
  const onText=(txt)=>{ $("t-barcode").value = txt; $("scan-preview").innerHTML = `最近一次解碼：<b>${txt}</b>`; if(!keepOpen){ stopVideo($("video")); } };
  try{
    await startStream($("video"));
    $("scan-help").textContent = "把條碼橫向置中，距離 15–25cm；必要時開啟手電筒。";
    // Engine chain
    const okBD = await tryBarcodeDetector($("video"), onText);
    if(!okBD){
      const okQ = await tryQuaggaLive($("video"), onText);
      if(!okQ){ await tryZXingPolling($("video"), onText); }
    }
  }catch(e){ $("scan-help").textContent = "相機開啟失敗"; log("open-scanner error: "+e); }
});
$("btn-stop-scanner").addEventListener("click", ()=> stopVideo($("video")));

$("btn-snapshot").addEventListener("click", async ()=>{
  const canvas = roiCanvas($("video"));
  // Try detector first
  try{
    if(bd){ const bitmap = await createImageBitmap(canvas); const res = await bd.detect(bitmap); if(res && res[0]){ const txt=res[0].rawValue||""; if(txt){ $("t-barcode").value=txt; $("scan-preview").innerHTML=`最近一次解碼：<b>${txt}</b>`; return; } } }
  }catch(e){}
  // Fallback to Quagga2 one-shot
  if(window.Quagga){
    try{
      Quagga.decodeSingle({
        src: canvas.toDataURL("image/png"),
        numOfWorkers: 0,
        locator:{ patchSize:"large", halfSample:false },
        decoder:{ readers:["code_128_reader","code_39_reader","ean_reader","ean_8_reader"] },
        locate:true
      }, (data)=>{
        const code = data?.codeResult?.code;
        if(code){ $("t-barcode").value=code; $("scan-preview").innerHTML=`最近一次解碼：<b>${code}</b>`; }
        else{ alert("此張影像無法解碼，請再靠近、補光或換角度。"); }
      });
      return;
    }catch(e){ log("Quagga decodeSingle error: "+e); }
  }
  // Last try ZXing
  try{
    const ZX = window.ZXing; if(ZX && ZX.BrowserMultiFormatReader){
      const r = new ZX.BrowserMultiFormatReader(); const res = await r.decodeFromCanvas(canvas);
      if(res?.getText){ $("t-barcode").value=res.getText(); $("scan-preview").innerHTML=`最近一次解碼：<b>${res.getText()}</b>`; return; }
    }
  }catch(e){ log("ZXing snapshot error: "+e); }
});

$("btn-torch").addEventListener("click", async ()=>{
  if(!currentStream){ alert("請先開啟相機"); return; }
  const track = currentStream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if(!caps.torch){ alert("裝置不支援手電筒或瀏覽器未開放"); return; }
  const cur = track.getSettings()?.torch;
  try{ await track.applyConstraints({ advanced:[{ torch: !cur }] }); }catch(e){ alert("無法切換手電筒："+e.message); }
});

// 照片上傳掃碼（Quagga2 → ZXing）
$("btn-file-scan").addEventListener("click", ()=> $("file-scan").click());
$("file-scan").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = ()=>{
    if(window.Quagga){
      try{
        Quagga.decodeSingle({
          src: url, numOfWorkers: 0,
          locator:{ patchSize:"large", halfSample:false },
          decoder:{ readers:["code_128_reader","code_39_reader","ean_reader","ean_8_reader","upc_reader","upc_e_reader","i2of5_reader"] },
          locate:true
        }, (data)=>{
          const code = data?.codeResult?.code;
          if(code){ $("t-barcode").value=code; $("scan-preview").innerHTML=`最近一次解碼：<b>${code}</b>`; }
          else{ alert("無法從照片辨識條碼，請換更清晰的照片或靠近一點。"); }
          URL.revokeObjectURL(url); e.target.value="";
        });
        return;
      }catch(err){ log("Quagga photo error: "+err); }
    }
    // fallback ZXing
    try{
      const ZX = window.ZXing; if(ZX && ZX.BrowserMultiFormatReader){
        const r = new ZX.BrowserMultiFormatReader();
        r.decodeFromImageUrl(url).then(res=>{
          $("t-barcode").value=res.getText(); $("scan-preview").innerHTML=`最近一次解碼：<b>${res.getText()}</b>`;
          URL.revokeObjectURL(url); e.target.value="";
        }).catch(_=>{ alert("照片也無法解碼，請改變距離或角度再試。"); URL.revokeObjectURL(url); e.target.value=""; });
      }
    }catch(e){ URL.revokeObjectURL(url); e.target.value=""; }
  };
  img.src = url;
});

// Handlers & 其餘 UI（與 v4.7 相同）
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
  const onText=(txt)=>{ $("q-barcode").value = txt; $("scan-preview").innerHTML=`最近一次解碼：<b>${txt}</b>`; stopVideo($("video-q")); };
  try{
    await startStream($("video-q"));
    const okBD = await tryBarcodeDetector($("video-q"), onText);
    if(!okBD){ const okQ = await tryQuaggaLive($("video-q"), onText); if(!okQ){ await tryZXingPolling($("video-q"), onText); } }
  }catch(e){ log("query scanner error: "+e); }
});
$("btn-stop-scanner-q").addEventListener("click", ()=> stopVideo($("video-q")));

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

// 區段查詢與報表
$("btn-range-query").addEventListener("click", async ()=>{
  const s=$("q-start").value; const e=$("q-end").value; const start=s?new Date(s):null; const end=e?new Date(e):null; const box=$("range-results"); box.innerHTML="查詢中…";
  try{ const rows=await rangeQuery(start,end); renderRangeResults(box,rows); }catch(err){ box.innerHTML = `<div class="card error">錯誤：${err.message}</div>`; }
});
$("btn-report").addEventListener("click", async ()=>{
  const s=$("r-start").value; const e=$("r-end").value; const start=s?new Date(s):null; const end=e?new Date(e):null; const cards=$("report-cards"); const list=$("report-list"); list.innerHTML="查詢中…";
  try{ const rep=await buildReport(start,end); const ks=cards.querySelectorAll(".stat .k"); ks[0].textContent=rep.newCount; ks[1].textContent=rep.transferCount; ks[2].textContent=rep.avgStayStr; renderReportList(list,rep.rows); }
  catch(err){ list.innerHTML = `<div class="card error">錯誤：${err.message}</div>`; }
});
