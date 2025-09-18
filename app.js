// =========================
// 🔧 將您的 Firebase 設定貼在這裡（從 Firebase Console 取得）
// =========================
const firebaseConfig = {
  apiKey: "AIzaSyBUmWFAfcwLdhRBJ4GFkfqe_m7DOgrE808",
  authDomain: "ar-fo-2501.firebaseapp.com",
  projectId: "ar-fo-2501",
  storageBucket: "ar-fo-2501.firebasestorage.app",
  messagingSenderId: "55341993889",
  appId: "1:55341993889:web:9c1430f86bec918bb845e0"
};

// === 初始化 Firebase / Firestore ===
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// === Auth ===
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

const authBar = document.getElementById('auth-bar');
const authStatus = document.getElementById('auth-status');
const btnSignin = document.getElementById('btn-signin');
const btnSignout = document.getElementById('btn-signout');

// 監看登入狀態
auth.onAuthStateChanged((user) => {
  if (user) {
    authStatus.textContent = `已登入：${user.email}`;
    btnSignin.style.display = 'none';
    btnSignout.style.display = 'inline-block';
    // 允許操作（頁面已載入的按鈕本來就綁好事件，這裡不需額外處理）
  } else {
    authStatus.textContent = '尚未登入';
    btnSignin.style.display = 'inline-block';
    btnSignout.style.display = 'none';
  }
});

// 點擊登入
btnSignin?.addEventListener('click', async () => {
  try {
    await auth.signInWithPopup(provider);
  } catch (e) {
    alert('登入失敗：' + e.message);
  }
});

// 點擊登出
btnSignout?.addEventListener('click', async () => {
  await auth.signOut();
});


// ===（選擇性）主管密碼（示範用，正式環境請用 Firebase Auth + 角色控制）===
const SUPERVISOR_PASS_L1 = "level1-demo";
const SUPERVISOR_PASS_L2 = "level2-demo";

// === 工具函式 ===
function fmt(ts) {
  if (!ts) return "";
  const d = (ts instanceof Date) ? ts : ts.toDate ? ts.toDate() : new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ddhhmmss(diffSeconds) {
  diffSeconds = Math.max(0, Math.floor(diffSeconds || 0));
  const d = Math.floor(diffSeconds / 86400);
  const h = Math.floor((diffSeconds % 86400) / 3600);
  const m = Math.floor((diffSeconds % 3600) / 60);
  const s = diffSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d)}:${pad(h)}:${pad(m)}:${pad(s)}`;
}

// 取得某條碼最新一筆 flow
async function getLastFlow(barcode) {
  const snap = await db.collection("flows")
    .where("barcode_id", "==", barcode)
    .orderBy("entry_time", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

// 建立 / 更新交接紀錄
async function createTransfer({ barcode, handler, titleInput, signLevelInput }) {
  const now = new Date();
  const last = await getLastFlow(barcode);

  let title = titleInput;
  let requireSignLv = Number(signLevelInput || 0);

  if (last) {
    // 沿用標題與簽核層級
    title = last.title || titleInput;
    requireSignLv = last.require_sign_lv ?? requireSignLv;

    // 將上一筆補上離開時間與停留時長（若未填）
    if (!last.leave_time) {
      const prevRef = db.collection("flows").doc(last.id);
      const staySec = Math.floor((now.getTime() - last.entry_time.toDate().getTime()) / 1000);
      await prevRef.update({
        leave_time: now,
        stay_duration_seconds: staySec,
        stay_duration_str: ddhhmmss(staySec),
        status: "已完成"
      });
    }
  } else {
    // 第一筆但未填標題 → 報錯
    if (!title || !title.trim()) {
      throw new Error("第一筆紀錄必須輸入『文件標題』。");
    }
  }

  // 寫入新的一筆 flow
  const approvals = {
    l1_status: requireSignLv >= 1 ? "待簽核" : "不適用",
    l2_status: requireSignLv >= 2 ? "待簽核" : "不適用",
    l1_note: "",
    l2_note: ""
  };

  await db.collection("flows").add({
    barcode_id: barcode,
    title: title,
    handler: handler,
    entry_time: now,
    leave_time: null,
    stay_duration_seconds: 0,
    stay_duration_str: "",
    status: "在手上",
    require_sign_lv: requireSignLv,
    approvals
  });

  return { ok: true, message: "已新增 / 交接完成。" };
}

// 查詢：目前狀態 & 歷史
async function queryByBarcode(barcode) {
  const current = await getLastFlow(barcode);

  const histSnap = await db.collection("flows")
    .where("barcode_id", "==", barcode)
    .orderBy("entry_time", "asc")
    .get();

  const history = histSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  return { current, history };
}

// 簽核（主管）
async function approve({ barcode, level, action, note, passcode }) {
  // 超簡易驗證（示範）
  if (Number(level) === 1 && passcode !== SUPERVISOR_PASS_L1) {
    throw new Error("Level 1 主管密碼錯誤（示範用）。");
  }
  if (Number(level) === 2 && passcode !== SUPERVISOR_PASS_L2) {
    throw new Error("Level 2 主管密碼錯誤（示範用）。");
  }

  const last = await getLastFlow(barcode);
  if (!last) throw new Error("查無此條碼。");

  const ref = db.collection("flows").doc(last.id);
  const approvals = last.approvals || {};
  const requireLv = Number(last.require_sign_lv || 0);

  if (level == 1) {
    if (requireLv < 1) throw new Error("此文件不需 Level 1 簽核。");
    approvals.l1_status = (action === "approve") ? "同意" : "退回";
    approvals.l1_note = note || "";
  } else if (level == 2) {
    if (requireLv < 2) throw new Error("此文件不需 Level 2 簽核。");
    // 需先通過 L1
    if ((approvals.l1_status || "") !== "同意") {
      throw new Error("請先完成 Level 1 同意後，才能 Level 2 簽核。");
    }
    approvals.l2_status = (action === "approve") ? "同意" : "退回";
    approvals.l2_note = note || "";
  }

  // 若退回 → 更新狀態為退回
  let statusUpdate = {};
  if (action === "reject") {
    statusUpdate.status = "退回";
  }

  await ref.update({
    approvals,
    ...statusUpdate
  });

  return { ok: true, message: "簽核已送出。" };
}

// === UI 綁定 ===
function bindTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panes = document.querySelectorAll(".tab-pane");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(b => b.classList.remove("active"));
      panes.forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

function mountScanner(btnOpenId, containerId, targetInputId) {
  const btn = document.getElementById(btnOpenId);
  const box = document.getElementById(containerId);
  const input = document.getElementById(targetInputId);

  let qr = null;

  btn.addEventListener("click", async () => {
    if (box.style.display === "none") {
      box.style.display = "block";
      if (!qr) {
        qr = new Html5Qrcode(containerId);
      }
      qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          input.value = decodedText;
          // 掃到就收起相機
          qr.stop().then(() => { box.style.display = "none"; }).catch(() => {});
        },
        (err) => {}
      ).catch(e => {
        alert("無法開啟相機，請檢查瀏覽器權限或改用手動輸入。");
      });
    } else {
      box.style.display = "none";
      if (qr) {
        try { await qr.stop(); } catch(e) {}
      }
    }
  });
}

function renderCurrent(el, current) {
  if (!current) {
    el.innerHTML = `<div class="card error">查無資料。</div>`;
    return;
  }
  // 若尚未離開，動態顯示目前停留時長（至現在）
  let stay = current.stay_duration_str || "";
  if (!current.leave_time && current.entry_time) {
    const now = new Date().getTime();
    const ent = current.entry_time.toDate().getTime();
    stay = ddhhmmss((now - ent)/1000);
  }

  el.innerHTML = `
    <div class="card">
      <div><strong>條碼：</strong>${current.barcode_id}</div>
      <div><strong>標題：</strong>${current.title || "-"}</div>
      <div><strong>目前經手人：</strong>${current.handler || "-"}</div>
      <div><strong>狀態：</strong>${current.status || "-"}</div>
      <div><strong>進入時間：</strong>${fmt(current.entry_time)}</div>
      <div><strong>離開時間：</strong>${fmt(current.leave_time)}</div>
      <div><strong>停留時長：</strong>${stay}</div>
      <div><strong>簽核需求：</strong>${Number(current.require_sign_lv||0)===0?"不需":(Number(current.require_sign_lv)===1?"Level 1":"Level 1 + Level 2")}</div>
      <div><strong>簽核狀態：</strong>L1=${current.approvals?.l1_status||"-"}；L2=${current.approvals?.l2_status||"-"}</div>
    </div>
  `;
}

function renderHistory(tableBody, rows) {
  tableBody.innerHTML = "";
  rows.forEach(r => {
    let stay = r.stay_duration_str || "";
    if (!r.leave_time && r.entry_time) {
      stay = ddhhmmss((new Date().getTime() - r.entry_time.toDate().getTime())/1000);
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.barcode_id}</td>
      <td>${r.title || ""}</td>
      <td>${r.handler || ""}</td>
      <td>${fmt(r.entry_time)}</td>
      <td>${fmt(r.leave_time)}</td>
      <td>${stay}</td>
      <td>${r.status || ""}</td>
      <td>${(r.approvals?.l1_status||"-")}/${(r.approvals?.l2_status||"-")}</td>
    `;
    tableBody.appendChild(tr);
  });
}

// === Main ===
document.addEventListener("DOMContentLoaded", () => {
  bindTabs();

  // 掃碼器掛載
  mountScanner("btn-open-scanner", "scanner", "t-barcode");
  mountScanner("btn-open-scanner-q", "scanner-q", "q-barcode");
  mountScanner("btn-open-scanner-a", "scanner-a", "a-barcode");

  // 新增 / 交接
  document.getElementById("btn-transfer").addEventListener("click", async () => {
    const barcode = document.getElementById("t-barcode").value.trim();
    const title = document.getElementById("t-title").value.trim();
    const handler = document.getElementById("t-handler").value.trim();
    const signLv = document.getElementById("t-signlevel").value;

    const out = document.getElementById("t-result");
    out.textContent = "";

    if (!barcode) { alert("請輸入條碼號碼"); return; }
    if (!handler) { alert("請輸入經手人姓名"); return; }

    try {
      const res = await createTransfer({ barcode, handler, titleInput: title, signLevelInput: signLv });
      out.textContent = res.message;
      // 清空輸入（保留條碼方便連掃）
      document.getElementById("t-title").value = "";
      // handler 保留、barcode 清空（或保留看需求）
      document.getElementById("t-barcode").value = "";
    } catch (e) {
      out.textContent = "錯誤：" + e.message;
      out.classList.add("error");
    }
  });

  // 查詢
  document.getElementById("btn-query").addEventListener("click", async () => {
    const barcode = document.getElementById("q-barcode").value.trim();
    if (!barcode) { alert("請輸入條碼號碼"); return; }

    const currentEl = document.getElementById("q-current");
    const tbody = document.querySelector("#history-table tbody");
    currentEl.innerHTML = "";
    tbody.innerHTML = "";

    try {
      const { current, history } = await queryByBarcode(barcode);
      renderCurrent(currentEl, current);
      renderHistory(tbody, history);
    } catch (e) {
      currentEl.innerHTML = `<div class="card error">錯誤：${e.message}</div>`;
    }
  });

  // 主管簽核
  document.getElementById("btn-approve").addEventListener("click", async () => {
    const barcode = document.getElementById("a-barcode").value.trim();
    const level = document.getElementById("a-level").value;
    const action = document.getElementById("a-action").value;
    const note = document.getElementById("a-note").value.trim();
    const passcode = document.getElementById("a-passcode").value;

    const out = document.getElementById("a-result");
    out.textContent = "";

    if (!barcode) { alert("請輸入條碼號碼"); return; }

    try {
      const res = await approve({ barcode, level, action, note, passcode });
      out.textContent = res.message;
      document.getElementById("a-note").value = "";
      document.getElementById("a-passcode").value = "";
    } catch (e) {
      out.textContent = "錯誤：" + e.message;
      out.classList.add("error");
    }
  });
});
