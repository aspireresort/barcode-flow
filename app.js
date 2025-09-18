// app.js
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

// 登入狀態
auth.onAuthStateChanged(u => {
  document.getElementById('auth-status').textContent = u ? u.email : '尚未登入';
});
document.getElementById('btn-signin').onclick = () => auth.signInWithPopup(provider);
document.getElementById('btn-signout').onclick = () => auth.signOut();

// 分頁切換
document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  };
});

// 相機掃描
async function startScanner(containerId, inputId) {
  const qr = new Html5Qrcode(containerId);
  const devices = await Html5Qrcode.getCameras();
  let back = devices.find(d => /back|rear|environment/i.test(d.label));
  await qr.start(back ? back.id : devices[0].id,
    { fps: 10, qrbox: 200 },
    txt => {
      document.getElementById(inputId).value = txt;
      qr.stop();
      document.getElementById(containerId).style.display = 'none';
    }
  );
}

document.getElementById('btn-open-scanner').onclick = () => {
  document.getElementById('scanner').style.display = 'block';
  startScanner('scanner', 't-barcode');
};
document.getElementById('btn-open-scanner-q').onclick = () => {
  document.getElementById('scanner-q').style.display = 'block';
  startScanner('scanner-q', 'q-barcode');
};
