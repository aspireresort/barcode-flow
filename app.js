// Insert your Firebase config here (already filled from your previous message)
const firebaseConfig = {
  apiKey: "AIzaSyBUmWFAfcwLdhRBJ4GFkfqe_m7DOgrE808",
  authDomain: "ar-fo-2501.firebaseapp.com",
  projectId: "ar-fo-2501",
  storageBucket: "ar-fo-2501.firebasestorage.app",
  messagingSenderId: "55341993889",
  appId: "1:55341993889:web:9c1430f86bec918bb845e0"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

const tip = document.getElementById("tip");
const codeInput = document.getElementById("code");
const scanBtn = document.getElementById("btn-scan");
const stopBtn = document.getElementById("btn-stop");
const scanBox = document.getElementById("scanner");

let qr = null;
let running = false;

function isiOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function ensurePermission() {
  // On iOS, labels are empty until we grant permission once.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }
    });
    // Immediately stop to release camera for html5-qrcode
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (e) {
    console.error("預先取得相機權限失敗", e);
    return false;
  }
}

async function startScanner() {
  if (running) return;
  scanBox.style.display = "block";
  tip.textContent = "";

  if (!qr) qr = new Html5Qrcode("scanner");

  // iOS guidance
  if (isiOS()) {
    tip.innerHTML = "提示：請確認使用 <b>Safari</b> 且網址為 <b>https</b>，並允許相機權限。若沒有跳出權限提示，請到 iOS 設定 → Safari → 網站設定 → 相機 → 允許。";
  }

  // Pre-permission step (especially for iOS)
  const ok = await ensurePermission();
  if (!ok) {
    tip.innerHTML = "無法取得相機權限。請確認：<br>1) 使用 Safari 並且為 HTTPS 網址<br>2) 沒有在 Line/FB 內建瀏覽器開啟<br>3) iOS 設定已允許此網站使用相機";
    return;
  }

  try {
    const devices = await Html5Qrcode.getCameras();
    if (!devices || devices.length === 0) {
      tip.textContent = "找不到相機裝置（可能權限被拒絕或裝置不支援）";
      return;
    }
    // Prefer back camera
    let back = devices.find(d => /back|rear|environment/i.test(d.label));
    const cameraId = (back ? back : devices[0]).id;

    await qr.start(
      cameraId,
      { fps: 10, qrbox: 250 },
      (decodedText) => {
        codeInput.value = decodedText;
        stopScanner();
      },
      (err) => {}
    );
    running = true;
    scanBtn.style.display = "none";
    stopBtn.style.display = "inline-block";
  } catch (e) {
    console.error(e);
    tip.textContent = "啟動相機失敗：" + e;
    scanBox.style.display = "none";
  }
}

async function stopScanner() {
  if (qr) {
    try { await qr.stop(); } catch (e) {}
  }
  running = false;
  scanBtn.style.display = "inline-block";
  stopBtn.style.display = "none";
  scanBox.style.display = "none";
}

scanBtn.addEventListener("click", startScanner);
stopBtn.addEventListener("click", stopScanner);

// Auth minimal UI
auth.onAuthStateChanged(u => {
  document.getElementById('auth-status').textContent = u ? `已登入：${u.email}` : '尚未登入';
  document.getElementById('btn-signin').style.display = u ? 'none' : 'inline-block';
  document.getElementById('btn-signout').style.display = u ? 'inline-block' : 'none';
});
document.getElementById('btn-signin').onclick = () => auth.signInWithPopup(provider);
document.getElementById('btn-signout').onclick = () => auth.signOut();
