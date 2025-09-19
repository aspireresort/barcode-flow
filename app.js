// app.js — Smart Scanner v5.1

// ===== Firebase 初始化 =====
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

// ===== DOM utils =====
const $ = (id)=>document.getElementById(id);
const pad2=(n)=>String(Math.floor(n)).padStart(2,"0");
const fmt=(ts)=>{ if(!ts) return ""; const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts)); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
const ddhhmmss=(sec)=>{ sec=Math.max(0,Math.floor(sec||0)); const d=Math.floor(sec/86400),h=Math.floor((sec%86400)/3600),m=Math.floor((sec%3600)/60),s=sec%60; return `${pad2(d)}:${pad2(h)}:${pad2(m)}:${pad2(s)}`; };
function isIOSSafari(){ return /iP(hone|ad|od)/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent); }
function logTo(elId,msg){ const b=$(elId); if(!b) return; const d=document.createElement("div"); d.textContent=msg; b.appendChild(d); }

// ===== Tabs =====
document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    const id = btn.getAttribute("data-tab");
    document.getElementById(id).classList.add("active");
  });
});

// ===== Auth =====
(async ()=>{
  try{ await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); logTo("c-log","Auth persistence: LOCAL"); }catch(e){ logTo("c-log","setPersistence error: "+e.message); }
  try{ const res = await auth.getRedirectResult(); if(res && res.user){ logTo("c-log","Redirect 回來，已登入："+res.user.email); } }catch(e){ logTo("c-log","getRedirectResult error: "+e.code+" / "+e.message); }
})();
auth.onAuthStateChanged(async (u)=>{
  $("auth-status").textContent = u ? `已登入：${u.email}` : "尚未登入（未登入時可測試掃描，但無法寫入）";
  $("btn-signin").style.display = u ? "none" : "inline-block";
  $("btn-signout").style.display = u ? "inline-block" : "none";
  if(u){ await loadHandlers(); await refreshHandlerList(); }
});
$("btn-signin").addEventListener("click", async ()=>{
  try{ if(isIOSSafari()) await auth.signInWithRedirect(provider); else await auth.signInWithPopup(provider); }
  catch(e){ alert("登入失敗："+e.message); }
});
$("btn-signout").addEventListener("click", ()=>auth.signOut());

// ===== Firestore helpers =====
async function getLastFlow(barcode){
  const snap = await db.collection("flows").where("barcode_id","==",barcode).orderBy("entry_time","desc").limit(1).get();
  if(snap.empty) return null; const doc = snap.docs[0]; return { id: doc.id, ...doc.data() };
}
async function anyFlowExists(barcode){ const s = await db.collection("flows").where("barcode_id","==",barcode).limit(1).get(); return !s.empty; }
async function createTransfer({barcode, handler, titleInput, isCreate}){
  if(!auth.currentUser){ alert("尚未登入，無法寫入紀錄。請先登入 Google。"); return; }
  const now = new Date(); const last = await getLastFlow(barcode);
  if(isCreate){
    if(last){ throw new Error("此條碼已存在第一筆紀錄，請改用『交接』頁面。"); }
    if(!titleInput || !titleInput.trim()) throw new Error("新增第一筆必須輸入『文件標題』。");
    await db.collection("flows").add({ barcode_id: barcode, title: titleInput, handler, entry_time: now, leave_time: null, stay_duration_seconds: 0, stay_duration_str: "", status: "在手上" });
    return true;
  }else{
    if(!last){ throw new Error("查無此條碼的第一筆，請先到『新增』頁面建立。"); }
    if(!last.leave_time){
      const staySec = Math.floor((now - last.entry_time.toDate())/1000);
      await db.collection("flows").doc(last.id).update({ leave_time: now, stay_duration_seconds: staySec, stay_duration_str: ddhhmmss(staySec), status: "已完成" });
    }
    await db.collection("flows").add({ barcode_id: barcode, title: (last.title||""), handler, entry_time: now, leave_time: null, stay_duration_seconds: 0, stay_duration_str: "", status: "在手上" });
    return true;
  }
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
    results.push({...r,__type: early.empty ? "新增" : "交接"});
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

// ===== Camera & Engines =====
let currentStream=null; let intervalId=null; let usingEngine="";
function clearIntervalSafe(){ if(intervalId){ clearInterval(intervalId); intervalId=null; } }
async function startStream(videoEl, logEl){
  const constraints = { audio:false, video:{ facingMode:{ ideal:"environment" }, width:{ ideal:1920, min:1280 }, height:{ ideal:1080, min:720 } } };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream; await new Promise(r=> videoEl.onloadedmetadata = ()=>{ videoEl.play(); r(); });
  currentStream = stream; logTo(logEl,`Video ready: ${videoEl.videoWidth}x${videoEl.videoHeight}`); return stream;
}
function stopVideo(videoEl){ try{ const s=videoEl.srcObject; if(s){ s.getTracks().forEach(t=>t.stop()); } }catch(e){} videoEl.srcObject=null; currentStream=null; clearIntervalSafe(); if(window.Quagga){ try{ Quagga.stop(); }catch{} } }
function roiCanvas(videoEl, scale=2){
  const canvas=document.createElement("canvas"); const ctx=canvas.getContext("2d"); const w=videoEl.videoWidth||1280,h=videoEl.videoHeight||720;
  const roiH=Math.floor(h*0.56), y=Math.floor((h-roiH)/2), x=0, roiW=w;
  canvas.width=roiW*scale; canvas.height=roiH*scale;
  ctx.drawImage(videoEl, x, y, roiW, roiH, 0, 0, canvas.width, canvas.height);
  return canvas;
}
async function zxingDecodeCanvas(canvas){
  const ZX = window.ZXing; if(!ZX || !ZX.BrowserMultiFormatReader) return null;
  const reader = new ZX.BrowserMultiFormatReader();
  const url = canvas.toDataURL("image/png");
  try{ const res = await reader.decodeFromImageUrl(url); return res?.getText ? res.getText() : null; }catch(e){ return null; }
}
async function tryQuaggaLive(containerEl, readers, logEl, onText){
  if(!window.Quagga) return false;
  usingEngine = "Quagga2"; logTo(logEl,"使用引擎：Quagga2"); clearIntervalSafe();
  return new Promise((resolve)=>{
    Quagga.init({
      inputStream:{ name:"Live", type:"LiveStream", target: containerEl, constraints:{ facingMode:"environment", width:{ideal:1920}, height:{ideal:1080} } },
      locator:{ patchSize:"medium", halfSample:true },
      decoder:{ readers },
      locate:true,
      frequency:12
    }, (err)=>{
      if(err){ logTo(logEl,"Quagga init error: "+err); resolve(false); return; }
      Quagga.start();
      Quagga.onDetected((data)=>{ const code=data?.codeResult?.code; if(code){ onText(code); } });
      resolve(true);
    });
  });
}
async function tryZXingPolling(videoEl, zoom, logEl, onText){
  usingEngine = "ZXing"; logTo(logEl,"使用引擎：ZXing"); clearIntervalSafe();
  intervalId = setInterval(async ()=>{
    const scales = zoom ? [2,3] : [1];
    for(const s of scales){
      const canvas = roiCanvas(videoEl, s);
      const txt = await zxingDecodeCanvas(canvas);
      if(txt){ onText(txt); return; }
    }
  }, 140);
  return true;
}

// ===== Scan controls binding（共用） =====
function bindScanControls(prefix, onDecoded){
  const video = $(prefix+"-video"); const help = $(prefix+"-help"); const logEl = prefix+"-log";
  const engineSel = $(prefix+"-engine"); const zoomChk = $(prefix+"-zoom");
  const openBtn = $(prefix+"-open"); const stopBtn = $(prefix+"-stop"); const snapBtn = $(prefix+"-snapshot");
  const fileBtn = $(prefix+"-file"); const fileInput = $(prefix+"-file-input"); const torchBtn = $(prefix+"-torch");
  const preview = $(prefix+"-preview"); const wrap = video.parentElement;

  function onText(txt, keepOpen){
    $(prefix+"-barcode").value = txt;
    preview.innerHTML = `最近一次解碼：<b>${txt}</b>`;
    if(!keepOpen){ stopVideo(video); }
    if(typeof onDecoded === "function") onDecoded(txt);
  }

  openBtn.addEventListener("click", async ()=>{
    const engine = engineSel.value || "auto";
    const keepOpen = (prefix==="h") ? $("h-batch").checked : false;
    try{
      if(engine==="quagga" || (engine==="auto" && isIOSSafari())){
        stopVideo(video);
        const readers=["code_128_reader","code_39_reader","ean_reader","ean_8_reader","upc_reader","upc_e_reader","i2of5_reader"];
        const okQ = await tryQuaggaLive(wrap, readers, logEl, (txt)=>onText(txt, keepOpen));
        if(okQ) return;
        await startStream(video, logEl); await tryZXingPolling(video, zoomChk.checked, logEl, (txt)=>onText(txt, keepOpen)); return;
      }
      await startStream(video, logEl);
      if(engine==="zxing"){ await tryZXingPolling(video, zoomChk.checked, logEl, (txt)=>onText(txt, keepOpen)); return; }
      stopVideo(video);
      const okQ = await tryQuaggaLive(wrap, ["code_128_reader","code_39_reader","ean_reader","ean_8_reader"], logEl, (txt)=>onText(txt, keepOpen));
      if(okQ) return;
      await startStream(video, logEl); await tryZXingPolling(video, zoomChk.checked, logEl, (txt)=>onText(txt, keepOpen));
    }catch(e){ help.textContent = "相機開啟失敗"; logTo(logEl,"open-scanner error: "+e); }
  });
  stopBtn.addEventListener("click", ()=> stopVideo(video));
  snapBtn.addEventListener("click", async ()=>{
    const scales = zoomChk.checked ? [2,3] : [1];
    for(const s of scales){
      const canvas = roiCanvas(video, s);
      if(window.Quagga){
        try{
          const url = canvas.toDataURL("image/png");
          let ok=false;
          await new Promise((resolve)=>{
            Quagga.decodeSingle({
              src: url, numOfWorkers: 0,
              locator:{ patchSize:"medium", halfSample:false },
              decoder:{ readers:["code_128_reader","code_39_reader","ean_reader","ean_8_reader"] },
              locate:true
            }, (data)=>{
              const code = data?.codeResult?.code;
              if(code){ $(prefix+"-barcode").value=code; preview.innerHTML=`最近一次解碼：<b>${code}</b>`; ok=true; }
              resolve();
            });
          });
          if(ok) return;
        }catch(e){}
      }
      const txt = await zxingDecodeCanvas(canvas);
      if(txt){ $(prefix+"-barcode").value = txt; preview.innerHTML=`最近一次解碼：<b>${txt}</b>`; return; }
    }
    alert("此張影像無法解碼，請把條碼橫向置中、靠近、補光後再試一次。");
  });
  fileBtn.addEventListener("click", ()=> fileInput.click());
  fileInput.addEventListener("change", async (e)=>{
    const file = e.target.files?.[0]; if(!file) return;
    const url = URL.createObjectURL(file);
    if(window.Quagga){
      try{
        await new Promise((resolve)=>{
          Quagga.decodeSingle({
            src: url, numOfWorkers: 0,
            locator:{ patchSize:"large", halfSample:false },
            decoder:{ readers:["code_128_reader","code_39_reader","ean_reader","ean_8_reader","upc_reader","upc_e_reader","i2of5_reader"] },
            locate:true
          }, (data)=>{
            const code = data?.codeResult?.code;
            if(code){ $(prefix+"-barcode").value=code; preview.innerHTML=`最近一次解碼：<b>${code}</b>`; }
            else{ alert("無法從照片辨識條碼，請換更清晰的照片或靠近一點。"); }
            resolve();
          });
        });
        URL.revokeObjectURL(url); e.target.value=""; return;
      }catch(err){ logTo(logEl,"Quagga photo error: "+err); }
    }
    const img = new Image(); img.onload = async ()=>{
      const c=document.createElement("canvas"); c.width=img.width; c.height=img.height; c.getContext("2d").drawImage(img,0,0);
      const txt = await zxingDecodeCanvas(c);
      if(txt){ $(prefix+"-barcode").value=txt; preview.innerHTML=`最近一次解碼：<b>${txt}</b>`; }
      else{ alert("照片也無法解碼，請改變距離或角度再試。"); }
      URL.revokeObjectURL(url); e.target.value="";
    }; img.src=url;
  });
  torchBtn.addEventListener("click", async ()=>{
    if(!currentStream){ alert("請先開啟相機（Quagga 模式不支援手電筒）"); return; }
    const track = currentStream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if(!caps.torch){ alert("裝置不支援手電筒或瀏覽器未開放"); return; }
    const cur = track.getSettings()?.torch;
    try{ await track.applyConstraints({ advanced:[{ torch: !cur }] }); }catch(e){ alert("無法切換手電筒："+e.message); }
  });

  return { video, logEl };
}

// ===== Handlers CRUD =====
async function loadHandlers(){
  for(const id of ["c-handler","h-handler"]){
    const sel = $(id); if(!sel) continue; sel.innerHTML="";
    const snap = await db.collection("handlers").orderBy("name","asc").get();
    if(snap.empty){ ["王小明","李小華","陳大同"].forEach(n=>{ const o=document.createElement("option"); o.value=n; o.textContent=n; sel.appendChild(o); }); }
    else{ snap.forEach(doc=>{ const n=doc.data().name; const o=document.createElement("option"); o.value=n; o.textContent=n; sel.appendChild(o); }); }
  }
}
async function refreshHandlerList(){
  const wrap=$("s-list"); if(!wrap) return; wrap.innerHTML="";
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
$("s-add")?.addEventListener("click", async ()=>{
  const name = $("s-name").value.trim(); if(!name){ alert("請輸入姓名"); return; }
  await db.collection("handlers").add({ name }); $("s-name").value=""; await loadHandlers(); await refreshHandlerList();
});

// ===== Bind pages =====
bindScanControls("c");
bindScanControls("h");

// 新增
$("c-submit").addEventListener("click", async ()=>{
  const barcode=$("c-barcode").value.trim(); const handler=$("c-handler").value; const title=$("c-title").value.trim();
  if(!barcode){ alert("請輸入條碼號碼"); return; }
  try{ await createTransfer({ barcode, handler, titleInput:title, isCreate:true }); $("c-result").textContent="已建立第一筆。"; $("c-barcode").value=""; }
  catch(e){ $("c-result").innerHTML = `<span class="card error">錯誤：${e.message}</span>`; }
});
// 交接
$("h-submit").addEventListener("click", async ()=>{
  const barcode=$("h-barcode").value.trim(); const handler=$("h-handler").value;
  if(!barcode){ alert("請輸入條碼號碼"); return; }
  try{ await createTransfer({ barcode, handler, titleInput:"", isCreate:false }); $("h-result").textContent="已完成交接。"; if(!$("h-batch").checked){ $("h-barcode").value=""; } }
  catch(e){ $("h-result").innerHTML = `<span class="card error">錯誤：${e.message}</span>`; }
});

// 查詢
$("q-open").addEventListener("click", async ()=>{
  const onText=(txt)=>{ $("q-barcode").value = txt; $("q-stop").click(); };
  try{
    stopVideo($("q-video"));
    const okQ = await tryQuaggaLive($("q-video").parentElement, ["code_128_reader","code_39_reader","ean_reader","ean_8_reader"], "c-log", (txt)=>onText(txt));
    if(!okQ){ await startStream($("q-video"), "c-log"); await tryZXingPolling($("q-video"), true, "c-log", (txt)=>onText(txt)); }
  }catch(e){ logTo("c-log","query scanner error: "+e); }
});
$("q-stop").addEventListener("click", ()=> stopVideo($("q-video")));
$("q-submit").addEventListener("click", async ()=>{
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

// 區段查詢（查詢頁）
$("q-range").addEventListener("click", async ()=>{
  const s=$("q-start").value; const e=$("q-end").value; const start=s?new Date(s):null; const end=e?new Date(e):null; const box=$("range-results"); box.innerHTML="查詢中…";
  try{ const rows=await rangeQuery(start,end); renderRangeResults(box,rows); }catch(err){ box.innerHTML = `<div class="card error">錯誤：${err.message}</div>`; }
});
function renderRangeResults(container, rows){
  const firsts=rows.filter(r=>r.__type==="新增"), transfers=rows.filter(r=>r.__type!=="新增");
  const block=(title,list)=>{
    const items=list.map(r=>`<div class="card tiny"><div><strong>${r.barcode_id}</strong> — ${r.title||""}</div>
      <div>經手人：${r.handler||""}</div><div>進入：${fmt(r.entry_time)}；離開：${fmt(r.leave_time)||"-"}</div>
      <div>停留：${r.stay_duration_str||"-"}</div></div>`).join("");
    return `<h4>${title}（${list.length}）</h4>${items||"<div class='muted tiny'>無資料</div>"}`;
  };
  container.innerHTML = block("新增（第一筆）",firsts)+block("交接（非第一筆）",transfers);
}

// 報表
$("r-submit").addEventListener("click", async ()=>{
  const s=$("r-start").value; const e=$("r-end").value; const start=s?new Date(s):null; const end=e?new Date(e):null;
  const cards=$("report-cards"); const tbody=document.querySelector("#report-table tbody"); tbody.innerHTML="<tr><td colspan='8'>查詢中…</td></tr>";
  try{
    const rep=await buildReport(start,end);
    const ks=cards.querySelectorAll(".stat .k"); ks[0].textContent=rep.newCount; ks[1].textContent=rep.transferCount; ks[2].textContent=rep.avgStayStr;
    // 表格清單
    tbody.innerHTML="";
    for(const r of rep.rows){
      const early = await db.collection("flows").where("barcode_id","==",r.barcode_id).where("entry_time","<", r.entry_time).limit(1).get();
      const typ = early.empty ? "新增" : "交接";
      const tr=document.createElement("tr");
      tr.innerHTML=`<td>${r.barcode_id}</td><td>${r.title||""}</td><td>${r.handler||""}</td><td>${fmt(r.entry_time)}</td><td>${fmt(r.leave_time)}</td><td>${r.stay_duration_str||""}</td><td>${r.status||""}</td><td>${typ}</td>`;
      tbody.appendChild(tr);
    }
  }catch(err){
    tbody.innerHTML = `<tr><td colspan="8"><div class="card error">錯誤：${err.message}</div></td></tr>`;
  }
});