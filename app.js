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

// Debug log helper
function log(msg){document.getElementById('debug').textContent += msg+"\n";}

// ZXing 初始化
const ZX = window.ZXing;
log("ZX type: "+typeof ZX);
log("has BrowserMultiFormatReader: "+(!!ZX && !!ZX.BrowserMultiFormatReader));

let reader;
if(ZX && ZX.BrowserMultiFormatReader){
  reader = new ZX.BrowserMultiFormatReader();
}

let currentStream;

// 開啟相機掃描
document.getElementById('openScannerBtn').onclick = async () => {
  try{
    const video = document.getElementById('video');
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
    video.srcObject = stream;
    currentStream = stream;
    reader.decodeFromVideoElement(video,(result,err)=>{
      if(result){
        document.getElementById('lastDecoded').textContent = result.getText();
        document.getElementById('barcodeInput').value = result.getText();
        log("ZXing 解碼："+result.getText());
      }
    });
  }catch(e){
    log("open-scanner error:"+e);
  }
};

// 手動擷取影像解碼
document.getElementById('snapBtn').onclick = async () => {
  try{
    const video = document.getElementById('video');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video,0,0);
    const imgData = canvas.toDataURL('image/png');
    reader.decodeFromImage(undefined,imgData).then(res=>{
      document.getElementById('lastDecoded').textContent = res.getText();
      document.getElementById('barcodeInput').value = res.getText();
      log("手動擷取解碼："+res.getText());
    }).catch(err=>log("snap decode error:"+err));
  }catch(e){
    log("snapBtn error:"+e);
  }
};

// 照片上傳掃碼
document.getElementById('fileInput').onchange = async (ev)=>{
  const file = ev.target.files[0];
  if(!file)return;
  const url = URL.createObjectURL(file);
  reader.decodeFromImageUrl(url).then(res=>{
    document.getElementById('lastDecoded').textContent = res.getText();
    document.getElementById('barcodeInput').value = res.getText();
    log("照片解碼："+res.getText());
  }).catch(err=>log("file decode error:"+err));
};

// 新增 / 交接紀錄 (簡化版)
document.getElementById('addRecordBtn').onclick = async ()=>{
  const code = document.getElementById('barcodeInput').value;
  const handler = document.getElementById('handlerInput').value;
  if(!code||!handler){alert("請輸入條碼與經手人");return;}
  await db.collection("flows").add({
    barcode: code, handler: handler, entry_time:new Date()
  });
  alert("已新增紀錄");
};

// 查詢
document.getElementById('searchBtn').onclick = async ()=>{
  const code = document.getElementById('searchBarcodeInput').value;
  if(!code){alert("請輸入條碼");return;}
  const qs = await db.collection("flows").where("barcode","==",code).get();
  let html="";
  qs.forEach(doc=>{
    const d=doc.data();
    html+=`<div>${d.handler} - ${d.entry_time.toDate?d.entry_time.toDate():d.entry_time}</div>`;
  });
  document.getElementById('history').innerHTML = html;
};