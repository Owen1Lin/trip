/* Private device cache; callers must obtain a verified membership identity first. */
(() => {
  'use strict';
  const DB='trip-import-private-v1', TABLE='drafts';
  const key=identity=>{
    if(!identity || typeof identity.id!=='string' || !identity.id || identity.scope!=='owen-winnie-20261021') throw new Error('請先驗證會員身份。');
    return `${identity.scope}:${identity.id}`;
  };
  function open() {
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB) return reject(new Error('此瀏覽器無法暫存匯入草稿；請保持頁面開啟。'));
      const request=indexedDB.open(DB,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(TABLE);
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(new Error('本裝置匯入暫存無法開啟。'));
      request.onblocked=()=>reject(new Error('本裝置暫存升級被其他分頁阻擋，請關閉舊分頁。'));
    });
  }
  async function transaction(identity,mode,operation) {
    const current=window.TripAuth?.getCurrentIdentity?.();
    if(!current || current.id!==identity?.id || current.scope!==identity?.scope) throw new Error('未核實目前會員，不能讀取私人暫存。');
    const identityKey=key(identity),db=await open();
    const afterOpen=window.TripAuth?.getCurrentIdentity?.();
    if(!afterOpen || afterOpen.id!==identity.id || afterOpen.scope!==identity.scope){db.close();throw new Error('登入狀態已變更，私人暫存未讀取。');}
    try { return await new Promise((resolve,reject)=>{
      const tx=db.transaction(TABLE,mode), request=operation(tx.objectStore(TABLE),identityKey);let result;
      request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(result);
      tx.onerror=tx.onabort=()=>reject(new Error('本裝置草稿暫存失敗，輸入仍保留於本頁。'));
    }); } finally {db.close();}
  }
  window.TripImportStore=Object.freeze({read:identity=>transaction(identity,'readonly',(store,k)=>store.get(k)),save:(identity,value)=>transaction(identity,'readwrite',(store,k)=>store.put(value,k)),remove:identity=>transaction(identity,'readwrite',(store,k)=>store.delete(k))});
})();
