// app.js - 文件條碼流轉系統 v2 完整版

// === Firebase 初始化 ===
// TODO: 將下方替換為你的 Firebase Config
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

// === Auth 控制 ===
const authStatus = document.getElementById("auth-status");
const btnSignin = document.getElementById("btn-signin");
const btnSignout = document.getElementById("btn-signout");
const provider = new firebase.auth.GoogleAuthProvider();

auth.onAuthStateChanged((user) => {
  if (user) {
    authStatus.textContent = `已登入：${user.email}`;
    btnSignin.style.display = "none";
    btnSignout.style.display = "inline-block";
  } else {
    authStatus.textContent = "尚未登入";
    btnSignin.style.display = "inline-block";
    btnSignout.style.display = "none";
  }
});

btnSignin.addEventListener("click", async () => {
  try {
    await auth.signInWithPopup(provider);
  } catch (e) {
    alert("登入失敗：" + e.message);
  }
});

btnSignout.addEventListener("click", async () => {
  await auth.signOut();
});

// === Tabs ===
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// === 經手人下拉 ===
const handlerSelect = document.getElementById("t-handler");
async function loadHandlers() {
  handlerSelect.innerHTML = "";
  const snap = await db.collection("handlers").get();
  if (snap.empty) {
    ["王小明","陳小華","林小美"].forEach(n => {
      let opt = document.createElement("option");
      opt.value = n; opt.textContent = n;
      handlerSelect.appendChild(opt);
    });
  } else {
    snap.forEach(doc => {
      let name = doc.data().name;
      let opt = document.createElement("option");
      opt.value = name; opt.textContent = name;
      handlerSelect.appendChild(opt);
    });
  }
}
loadHandlers();

// === 掃碼功能 (使用 get-camera) ===
async function startScanner(targetId, inputElement) {
  const scannerElem = document.getElementById(targetId);
  scannerElem.style.display = "block";
  const html5QrCode = new Html5Qrcode(targetId);

  try {
    const devices = await Html5Qrcode.getCameras();
    if (!devices || devices.length === 0) {
      alert("找不到相機裝置");
      return;
    }
    // 嘗試找後鏡頭，若沒有就用第一個
    let backCam = devices.find(d => /back|rear|environment/i.test(d.label));
    let cameraId = backCam ? backCam.id : devices[0].id;

    await html5QrCode.start(
      cameraId,
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        inputElement.value = decodedText;
        if (document.getElementById("t-batch")?.checked) {
          handleTransfer(); // 連續掃描模式
        } else {
          html5QrCode.stop();
          scannerElem.style.display = "none";
        }
      }
    );
  } catch (err) {
    console.error("Scanner 啟動失敗", err);
    alert("無法啟動相機：" + err);
  }
}


// Transfer tab
document.getElementById("btn-open-scanner").addEventListener("click", () => {
  startScanner("scanner", document.getElementById("t-barcode"));
});
document.getElementById("btn-open-scanner-q").addEventListener("click", () => {
  startScanner("scanner-q", document.getElementById("q-barcode"));
});

// === OCR 功能 ===
document.getElementById("btn-ocr").addEventListener("click", async () => {
  const file = document.getElementById("t-ocr-file").files[0];
  if (!file) { alert("請選擇圖片"); return; }
  document.getElementById("t-ocr-status").textContent = "OCR 辨識中...";
  const result = await Tesseract.recognize(file, 'chi_tra+eng');
  document.getElementById("t-title").value = result.data.text.trim();
  document.getElementById("t-ocr-status").textContent = "完成";
});

// === 新增 / 交接 ===
async function handleTransfer() {
  if (!auth.currentUser) { alert("請先登入"); return; }
  const code = document.getElementById("t-barcode").value.trim();
  const title = document.getElementById("t-title").value.trim();
  const handler = handlerSelect.value;
  const batchMode = document.getElementById("t-batch").checked;
  if (!code) { alert("請輸入條碼"); return; }
  if (!handler) { alert("請選擇經手人"); return; }

  const snap = await db.collection("flows")
    .where("barcode_id","==",code).orderBy("entry_time","desc").limit(1).get();
  let now = new Date();
  if (snap.empty) {
    if (!title) { alert("第一筆必須輸入標題"); return; }
    await db.collection("flows").add({
      barcode_id: code, title, handler, entry_time: now, status:"在手上"
    });
  } else {
    const last = snap.docs[0];
    await db.collection("flows").doc(last.id).update({
      leave_time: now,
      stay_seconds: Math.floor((now - last.data().entry_time.toDate())/1000),
      status: "已完成"
    });
    await db.collection("flows").add({
      barcode_id: code,
      title: last.data().title,
      handler, entry_time: now, status:"在手上"
    });
  }
  document.getElementById("t-result").textContent = "已新增 / 交接";
  if (!batchMode) {
    document.getElementById("t-barcode").value="";
  }
}
document.getElementById("btn-transfer").addEventListener("click", handleTransfer);

// === 查詢功能 ===
function formatDuration(seconds) {
  if (!seconds) return "";
  const d = Math.floor(seconds/86400);
  const h = Math.floor((seconds%86400)/3600);
  const m = Math.floor((seconds%3600)/60);
  const s = seconds%60;
  return `${d.toString().padStart(2,'0')}:${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

async function handleQuery() {
  const code = document.getElementById("q-barcode").value.trim();
  if (!code) { alert("請輸入條碼"); return; }
  const snap = await db.collection("flows")
    .where("barcode_id","==",code).orderBy("entry_time","asc").get();
  const tbody = document.querySelector("#history-table tbody");
  tbody.innerHTML = "";
  let current="";
  snap.forEach(doc => {
    const d=doc.data();
    let tr=document.createElement("tr");
    tr.innerHTML = `<td>${d.barcode_id}</td><td>${d.title||""}</td><td>${d.handler}</td>
      <td>${d.entry_time.toDate().toLocaleString()}</td>
      <td>${d.leave_time?d.leave_time.toDate().toLocaleString():""}</td>
      <td>${formatDuration(d.stay_seconds)}</td><td>${d.status}</td>`;
    tbody.appendChild(tr);
    if (d.status==="在手上") current=d.handler;
  });
  document.getElementById("q-current").textContent = current?`目前在：${current}`:"";
}
document.getElementById("btn-query").addEventListener("click", handleQuery);

// === 區段查詢 ===
document.getElementById("btn-range-query").addEventListener("click", async () => {
  const s = document.getElementById("q-start").value;
  const e = document.getElementById("q-end").value;
  if (!s||!e) { alert("請選擇區段"); return; }
  const start=new Date(s); const end=new Date(e);
  const snap = await db.collection("flows")
    .where("entry_time",">=",start).where("entry_time","<=",end)
    .orderBy("entry_time","asc").get();
  let added=[], transferred=[];
  snap.forEach(doc=>{
    const d=doc.data();
    if (d.status==="在手上" && !d.leave_time) added.push(d);
    else transferred.push(d);
  });
  let html="<h4>新增</h4><ul>"+added.map(d=>`<li>${d.barcode_id}-${d.title}-${d.handler}</li>`).join("")+"</ul>";
  html+="<h4>交接</h4><ul>"+transferred.map(d=>`<li>${d.barcode_id}-${d.title}-${d.handler}</li>`).join("")+"</ul>";
  document.getElementById("range-results").innerHTML=html;
});

// === 報表 ===
document.getElementById("btn-report").addEventListener("click", async () => {
  const s=document.getElementById("r-start").value;
  const e=document.getElementById("r-end").value;
  if (!s||!e){ alert("請選擇區段"); return; }
  const start=new Date(s); const end=new Date(e);
  const snap=await db.collection("flows").where("entry_time",">=",start)
    .where("entry_time","<=",end).orderBy("entry_time","asc").get();
  let adds=0, transfers=0, totalStay=0, countStay=0;
  let list="<ul>";
  snap.forEach(doc=>{
    const d=doc.data();
    if (!d.leave_time) adds++;
    else { transfers++; totalStay+=(d.stay_seconds||0); countStay++; }
    list+=`<li>${d.barcode_id}-${d.title}-${d.handler} @${d.entry_time.toDate().toLocaleString()}</li>`;
  });
  list+="</ul>";
  let avg=countStay?formatDuration(Math.floor(totalStay/countStay)):"無資料";
  document.getElementById("report-cards").innerHTML=`<p>新增數量:${adds}</p><p>交接數量:${transfers}</p><p>平均停留:${avg}</p>`;
  document.getElementById("report-list").innerHTML=list;
});
