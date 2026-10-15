'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  if (!$('#link-import-form')) return;
  let generation=0, sourceUrl='', pending=false;
  const labels={place:'地點',date:'日期',period:'時段',startTime:'開始時間',endTime:'結束時間'};
  function validateUrl(input) {
    if (typeof input!=='string' || input.length>1000) throw new Error('連結過長或格式不正確。');
    let url; try { url=new URL(input); } catch { throw new Error('請輸入有效的 HTTPS 連結。'); }
    if (url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443')) throw new Error('僅支援不含帳密的 HTTPS 公開連結。');
    const h=url.hostname;
    const maps=(['www.google.com','google.com','maps.google.com','www.google.co.jp','google.co.jp'].includes(h) && (h==='maps.google.com'||/^\/maps(?:\/|$)/.test(url.pathname))) || (h==='maps.app.goo.gl'&&url.pathname.length>1) || (h==='goo.gl'&&url.pathname.startsWith('/maps/'));
    const threads=['threads.net','www.threads.net','threads.com','www.threads.com'].includes(h)&&/^\/@[^/]+\/post\/[^/]+\/?$/.test(url.pathname);
    const instagram=['instagram.com','www.instagram.com'].includes(h)&&/^\/(p|reel|reels)\/[^/]+\/?$/.test(url.pathname);
    if (!maps&&!threads&&!instagram) throw new Error('請使用 Google Maps 地點、Threads 貼文或 Instagram 公開貼文連結。');
    url.hash='';return url.href;
  }
  const status=message=>{$('#link-import-status').textContent=message;};
  function clear() {
    generation++;sourceUrl='';pending=false;
    $('#link-import-form').reset();$('#link-draft-form').reset();$('#link-draft-form').hidden=true;
    $('#draft-source').removeAttribute('href');$('#draft-source').textContent='';$('#draft-evidence').value='';$('#draft-pending').textContent='';$('#draft-add').disabled=true;$('#link-fetch').disabled=false;status('');
  }
  function update() {
    const selectedStart=$('#draft-start').value;
    $('#draft-period').value=selectedStart ? (selectedStart < '12:00' ? 'morning' : 'afternoon') : '';
    const missing=[];
    for (const field of ['place','date','period','start','end']) if (!$(`#draft-${field}`).value.trim()) missing.push(labels[field==='start'?'startTime':field==='end'?'endTime':field]);
    const start=$('#draft-start').value,end=$('#draft-end').value;
    const times= /^([01]\d|2[0-3]):[0-5]\d$/.test(start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(end)&&end>start;
    $('#draft-pending').textContent=missing.length ? `待確認：${missing.join('、')}。` : !times ? '待確認：結束時間須晚於開始時間，跨日活動請分開填寫。' : !$('#draft-confirm').checked ? '請確認日期、時段及起訖時間；草稿尚未加入行程。' : '已確認，可加入行程；加入後請按儲存。';
    $('#draft-add').disabled=missing.length>0||!times||!$('#draft-confirm').checked||!sourceUrl;
  }
  function showDraft(url,data) {
    sourceUrl=url;$('#link-draft-form').reset();$('#link-draft-form').hidden=false;
    $('#draft-source').href=url;$('#draft-source').textContent=url;
    const evidence=typeof data?.evidence==='string'?data.evidence.slice(0,2000):'';
    $('#draft-evidence').value=evidence;
    // A response cannot set scheduling or executable markup, even when a model is selected.
    $('#draft-place').value=typeof data?.draft?.place==='string'&&data.draft.place.length<=150&&evidence.includes(data.draft.place)?data.draft.place:'';
    $('#draft-notes').value=typeof data?.draft?.notes==='string'&&data.draft.notes.length<=1600&&evidence.includes(data.draft.notes)?data.draft.notes:'';
    $('#draft-category').value='自訂';update();$('#draft-place').focus();
  }
  $('#link-import-form').addEventListener('submit',async event=>{
    event.preventDefault();if(pending||$('#private-app').hidden)return;
    let url;try{url=validateUrl($('#link-url').value.trim());}catch(error){status(error.message);return;}
    const attempt=++generation;pending=true;sourceUrl='';
    $('#link-draft-form').reset();$('#draft-source').removeAttribute('href');$('#draft-source').textContent='';$('#draft-evidence').value='';$('#draft-pending').textContent='';$('#draft-add').disabled=true;
    $('#link-fetch').disabled=true;$('#link-draft-form').hidden=true;status('正在取得公開資料，不會直接加入行程…');
    try {
      if (typeof window.TripAuth?.importPublicLink!=='function') throw new Error('頁面載入的前端版本不一致，請重新整理頁面後再試。');
      const data=await window.TripAuth.importPublicLink({url,model:$('#link-model').value});
      if(attempt!==generation||$('#private-app').hidden)return;
      if (!data || typeof data.evidence!=='string' || !data.evidence.trim()) throw new Error('沒有可讀取的公開資料。');
      showDraft(url,data);status(data.warning || '已取得公開資料；請編輯草稿，缺資料保持待確認。');
    }catch(error){
      if(attempt!==generation||$('#private-app').hidden)return;
      showDraft(url,null);status(`${error.message} 未取得的資料不會編造，請手動填寫草稿。`);
    }finally{if(attempt===generation){pending=false;$('#link-fetch').disabled=false;}}
  });
  $('#link-draft-form').addEventListener('input',()=>{$('#draft-confirm').checked=false;update();});
  $('#link-draft-form').addEventListener('change',event=>{if(event.target.id!=='draft-confirm')$('#draft-confirm').checked=false;update();});
  // Checkbox input must keep the user's explicit confirmation.
  $('#draft-confirm').addEventListener('input',event=>event.stopPropagation());
  $('#link-draft-form').addEventListener('submit',event=>{
    event.preventDefault();if(pending||$('#private-app').hidden||$('#link-draft-form').hidden)return;
    try {
      window.TripPlanner.addImportedDraft({sourceUrl,date:$('#draft-date').value,period:$('#draft-period').value,startTime:$('#draft-start').value,endTime:$('#draft-end').value,place:$('#draft-place').value.trim(),category:$('#draft-category').value,notes:$('#draft-notes').value,confirmed:$('#draft-confirm').checked});
      clear();status('草稿已加入行程；請按儲存，讓另一位載入。');
    }catch(error){status(error.message);}
  });
  $('#draft-cancel').addEventListener('click',clear);
  window.addEventListener('trip-planner-locked',clear);
  window.TripLinkImport=Object.freeze({validateUrl,clear});
})();
