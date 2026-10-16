/* Tesseract runs locally: original images never enter the model/API request. */
(() => {
  'use strict';
  let library;
  function config() { return {scriptPath:'./assets/ocr/tesseract.min.js',workerPath:'./assets/ocr/worker.min.js',corePath:'./assets/ocr',langPath:'./assets/ocr',...(window.TRIP_OCR_CONFIG || {})}; }
  function load() {
    if(window.Tesseract?.createWorker) return Promise.resolve(window.Tesseract);
    if(library) return library;
    library=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=config().scriptPath;
      script.onload=()=>window.Tesseract?.createWorker ? resolve(window.Tesseract) : reject(new Error('OCR 引擎未就緒，請改貼圖片文字。'));
      script.onerror=()=>{library=null;script.remove();reject(new Error('無法載入本機 OCR 引擎，請連線重試或貼入文字。'));};document.head.append(script);
    });return library;
  }
  async function prepare(file) {
    if(!(file instanceof Blob) || file.size>4*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('圖片限 PNG、JPEG、WebP，每張最多 4 MB。');
    const bitmap=await createImageBitmap(file);
    try {
      if(!bitmap.width || !bitmap.height || bitmap.width*bitmap.height>40000000) throw new Error('圖片尺寸過大，請先縮小後再試。');
      const ratio=Math.min(1,2048/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('圖片轉換失敗。')),'image/png'));
    } finally {bitmap.close();}
  }
  async function recognize(file,{onProgress=()=>{},signal}={}) {
    const prepared=await prepare(file),engine=await load(),options=config();
    if(signal?.aborted) throw new DOMException('已取消','AbortError');
    let worker;
    const abort=()=>{worker?.terminate();};
    try {
      worker=await engine.createWorker('eng+jpn+chi_tra',1,{workerPath:options.workerPath,corePath:options.corePath,langPath:options.langPath,gzip:true,workerBlobURL:false,logger:message=>onProgress({phase:message.status,progress:message.progress || 0})});
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted) throw new DOMException('已取消','AbortError');
      const result=await worker.recognize(prepared);
      if(signal?.aborted) throw new DOMException('已取消','AbortError');
      return {text:String(result.data?.text || ''),confidence:Number(result.data?.confidence || 0)};
    } finally {signal?.removeEventListener('abort',abort);await worker?.terminate();}
  }
  window.TripImportOCR=Object.freeze({prepare,recognize});
})();
