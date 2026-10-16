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
    const h=url.hostname.toLowerCase();
    if(h==='localhost' || /[:]|^\d+(?:\.\d+)*$|(?:^|\.)(?:localhost|local|internal)$/.test(h))throw new Error('不可讀取本機或內部網路。');
    for(const platform of ['instagram.com','threads.net','threads.com','google.com','youtube.com','facebook.com'])if(h.includes(platform) && h!==platform && !h.endsWith('.'+platform))throw new Error('平台網址格式不正確。');
    if(['google.com','www.google.com'].includes(h) && !/^\/maps(?:\/|$)/.test(url.pathname))throw new Error('Google 連結請使用 Maps 地點。');
    url.hash='';return url.href;
  }
  const status=message=>{$('#link-import-status').textContent=message;};
  function clear({privateLock=false}={}) {
    generation++;sourceUrl='';pending=false;operation?.abort();operation=null;clearTimeout(saveTimer);
    rich=null;attachments=[];queuedJobId='';jobs=[];jobInputs=Object.create(null);cacheNotice='';clearTimeout(jobTimer);document.documentElement.removeAttribute('data-import-keyboard');releaseImages();
    $('#link-import-form').reset();$('#link-draft-form').reset();$('#link-draft-form').hidden=true;
    $('#draft-source').removeAttribute('href');$('#draft-source').textContent='';$('#draft-evidence').value='';$('#draft-pending').textContent='';$('#draft-add').disabled=true;$('#link-fetch').disabled=false;
    if($('#import-results'))$('#import-results').hidden=true;$('#import-results-list')?.replaceChildren();$('#import-progress')?.replaceChildren();if($('#import-history'))$('#import-history').hidden=true;$('#import-history-list')?.replaceChildren();
    if(privateLock)identity=null;status('');
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
  let identity=null, rich=null, attachments=[], objectUrls=[], saveTimer=null, operation=null;
  const el=(tag,className,content)=>{const element=document.createElement(tag);if(className)element.className=className;if(content!==undefined)element.textContent=content;return element;};
  const dates=['2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25'];
  const timeValid=value=>!value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const factsLabels={address:'地址／交通',phone:'電話',hours:'營業／休息時間',reservation:'預約方式',price:'價格與條件',branch:'分店',dishes:'特色餐點',recommendation:'推薦理由',validity:'活動有效期限',transport:'交通方式',menu:'餐點／菜單',website:'網站',prices:'價格與條件'};
  const sourceTypes={webpage:'公開網頁（官方身份未核實）',official:'官方（仍須核對）',social:'社群／個人分享',unverified:'尚未核實',raw_text:'使用者提供文字',user_text:'使用者提供文字',image_ocr:'圖片 OCR',video_caption:'影片字幕',video_transcript:'影片語音轉錄'};
  const sourceType=source=>sourceTypes[source.type] || '來源類型未核實';
  const unknownLabel=value=>factsLabels[value] || value;
  function setProgress(message) {const target=$('#import-progress');if(target){target.replaceChildren(el('li','',message));}if(rich)rich.phase=message;}
  function releaseImages() {objectUrls.forEach(url=>URL.revokeObjectURL(url));objectUrls=[];$('#import-image-list')?.replaceChildren();}
  let queuedJobId='', jobs=[], jobInputs=Object.create(null), jobTimer=null, cacheNotice='';
  const jobStatuses={queued:'排隊中',running:'處理中',succeeded:'來源擷取完成',failed:'處理失敗'};
  const jobPhases={extracting:'讀取公開來源',captions:'擷取字幕',transcription:'音訊轉錄',frame_ocr:'辨識抽樣畫面'};
  const jobPhase=job=>jobPhases[job.phase] || job.phase || '';
  function renderHistory() {
    const box=$('#import-history'),list=$('#import-history-list');if(!box||!list)return;
    list.replaceChildren();box.hidden=!cacheNotice&&!jobs.length&&!queuedJobId;
    if(cacheNotice)list.append(el('p','import-source-meta',cacheNotice));
    for(const job of jobs) {
      const card=el('article','import-item');card.append(el('h4','',`${jobStatuses[job.status] || '狀態待確認'}：${job.source_url || '公開來源任務'}`),el('p','import-source-meta',`${jobPhase(job)} ${job.error || ''}；${job.updated_at || job.created_at || ''}`));
      const actions=el('div','planner-actions');
      for(const [action,title] of [['get','更新狀態'],...(job.status==='succeeded'?[['result','查看並整理結果']]:[]),...(job.status==='failed'?[['retry','重試任務']]:[]),['delete','刪除此任務']]) {
        const button=el('button','secondary-button',title);button.type='button';
        button.addEventListener('click',async()=>{
          const attempt=generation;button.disabled=true;
          try {
            if(action==='result')await loadJobResult(job.id,attempt);
            else {const reply=await window.TripAuth.importJobs({action,jobId:job.id});if(attempt!==generation)return;if(action==='delete'){jobs=jobs.filter(entry=>entry.id!==job.id);delete jobInputs[job.id];if(queuedJobId===job.id){queuedJobId='';clearTimeout(jobTimer);}}else if(reply.job){upsertJob(reply.job);if(action==='retry'){queuedJobId=job.id;clearTimeout(jobTimer);pollJob(job.id,attempt);}}renderHistory();persistRich();}
          }catch(error){if(attempt===generation)status(error.message+' 原始輸入仍保留。');}
          finally{button.disabled=false;}
        });actions.append(button);
      }card.append(actions);list.append(card);
    }
    if(queuedJobId&&!jobs.some(job=>job.id===queuedJobId))list.append(el('p','',`背景任務 ${queuedJobId} 已排入，可更新狀態；尚未取得摘要。`));
  }
  function upsertJob(job){if(!job||typeof job.id!=='string')return;jobs=[job,...jobs.filter(entry=>entry.id!==job.id)].slice(0,20);}
  async function loadJobResult(jobId,attempt) {
    setProgress('背景來源已擷取，正在根據證據整理摘要…');
    const data=await window.TripAuth.importAnalysis({...(jobInputs[jobId] || {}),workerJobId:jobId,model:jobs.find(job=>job.id===jobId)?.model || $('#link-model').value});
    if(attempt!==generation||$('#private-app').hidden)return;
    await initializeRich(data,jobId);queuedJobId='';persistRich();renderHistory();status(data.items?.length ? '背景處理結果已整理，請核對來源並選擇草稿；尚未加入行程。' : '背景來源已取得，但尚未識別店家；請核對原始證據、補貼文字或手動建立草稿，尚未加入行程。');
  }
  async function pollJob(jobId,attempt,started=Date.now()) {
    if(attempt!==generation||$('#private-app').hidden || queuedJobId!==jobId)return;
    try {
      const reply=await window.TripAuth.importJobs({action:'get',jobId});if(attempt!==generation||$('#private-app').hidden || queuedJobId!==jobId)return;
      if(reply.job){upsertJob(reply.job);renderHistory();
        if(reply.job.status==='succeeded'){
          try{await loadJobResult(jobId,attempt);}catch(error){if(attempt===generation)status(`${error.message} 來源任務已完成；可按「查看並整理結果」重試摘要，原始輸入仍保留。`);}
          return;
        }
        if(reply.job.status==='failed'){status(`背景處理失敗：${reply.job.error || '來源無法取得'}；可重試或補貼字幕／圖片，原始輸入仍保留。`);return;}
        setProgress(`背景任務：${jobPhase(reply.job) || jobStatuses[reply.job.status] || '等待狀態'}；可離開頁面，下次驗證會員後查看。`);
      }
    }catch(error){if(attempt!==generation)return;status(`${error.message} 任務識別仍保留，重新連線後可查詢。`);}
    if(queuedJobId!==jobId)return;
    if(Date.now()-started<120000)jobTimer=setTimeout(()=>pollJob(jobId,attempt,started),5000);
    else status('背景任務仍未完成，自動查詢暫停；排程約每15分鐘執行，平台忙碌可能延後。可稍後更新狀態，未宣稱取得摘要。');
  }
  async function restoreJobs(attempt) {
    try {const reply=await window.TripAuth.importJobs({action:'list'});if(attempt!==generation||$('#private-app').hidden)return;jobs=Array.isArray(reply?.jobs)?reply.jobs.slice(0,20):[];renderHistory();if(queuedJobId)pollJob(queuedJobId,attempt);}
    catch(error){if(attempt===generation){cacheNotice=[cacheNotice,`背景任務暫時無法查詢：${error.message}`].filter(Boolean).join(' ');renderHistory();}}
  }
  function persistRich() {
    clearTimeout(saveTimer);
    if(!identity || $('#private-app').hidden || !window.TripImportStore) return;
    const attempt=generation,owner={...identity};
    saveTimer=setTimeout(async()=>{
      if(attempt!==generation || $('#private-app').hidden)return;
      const value={version:2,url:$('#link-url').value,text:$('#link-text')?.value || '',model:$('#link-model').value,attachments,rich,queuedJobId,jobInputs,includeFrames:$('#link-include-frames')?.checked || false,updatedAt:new Date().toISOString()};
      try {await window.TripImportStore.save(owner,value);if(attempt===generation){cacheNotice='已在本裝置私有暫存；重新驗證會員後可還原。可按「捨棄結果及附件」刪除。';renderHistory();}}
      catch(error){if(attempt===generation)status(error.message);}
    },250);
  }
  function showImages() {
    releaseImages();const target=$('#import-image-list');if(!target)return;
    attachments.forEach((image,index)=>{
      const card=el('article','import-image-card'),preview=el('img','import-image-preview');
      const url=URL.createObjectURL(image.blob);objectUrls.push(url);preview.src=url;preview.alt=`第 ${index+1} 張待核對原圖`;
      const original=el('a','secondary-button','查看原圖');original.href=url;original.target='_blank';original.rel='noopener noreferrer';
      const remove=el('button','secondary-button','刪除此附件');remove.type='button';remove.dataset.removeImage=String(index);
      remove.addEventListener('click',()=>{if(pending)return;attachments.splice(index,1);showImages();persistRich();});
      card.append(preview,el('p','import-source-meta',image.ocrText!==undefined ? `OCR 辨識信心 ${Math.round(image.confidence || 0)}%；圖中文字可能有錯，請核對原圖。${image.insufficient ? '未辨識到足夠店名文字，請補店名或原文。' : ''}` : '原圖僅留於本裝置，不傳模型。'));
      if(image.ocrText!==undefined){const raw=el('details','import-evidence');raw.append(el('summary','','圖片原始辨識文字（可能錯誤）'),el('pre','preview-source',image.ocrText || '未辨識出文字'));card.append(raw);}card.append(original,remove);target.append(card);
    });
  }
  function valueOf(fact) {return typeof fact?.value==='string'?fact.value:'';}
  function grounded(fact,sources) {
    return fact && typeof fact.quote==='string' && fact.quote.trim() && typeof fact.sourceId==='string' && typeof fact.value==='string' && fact.quote.includes(fact.value) && sources.some(source=>source.id===fact.sourceId && typeof source.text==='string' && source.text.includes(fact.quote));
  }
  function sourceReference(source) {return source.url || `${sourceType(source)}：${source.title || source.id}`;}
  function videoEvidenceLink(source,quote='') {
    if(!source.url)return null;
    const url=new URL(source.url);if(!/(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname))return null;
    let seconds=Number.isFinite(source.timestamp)&&source.timestamp>=0?Math.floor(source.timestamp):null;
    const stamp=String(quote).match(/(?:^|\n)\[(\d+:\d{2}(?::\d{2})?)\]/);
    if(seconds===null && stamp)seconds=stamp[1].split(':').reduce((total,value)=>total*60+Number(value),0);
    if(seconds===null)return null;url.searchParams.set('t',`${seconds}s`);
    const link=el('a','source-link',`核對影片 ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} 畫面／字幕`);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';return link;
  }
  function itemNotes(item,sources) {
    const lines=['【來源整理；請核對，並非營業或預約保證】'];
    for(const [key,fact] of Object.entries(item.facts || {})) if(grounded(fact,sources)) {
      const source=sources.find(source=>source.id===fact.sourceId);
      lines.push(`${factsLabels[key] || key}：${fact.value}\n原文：「${fact.quote}」\n來源：${sourceReference(source)}\n取得：${source.capturedAt || '未提供'}；資料日期：${fact.date || source.publishedAt || '未提供，可能過時'}`);
    }
    for(const opinion of item.opinions || []) if(grounded(opinion,sources)) lines.push(`【單一來源心得】${opinion.value}\n原文：「${opinion.quote}」`);
    for(const warning of item.warnings || [])if(typeof warning==='string')lines.push(`來源限制：${warning}`);
    for(const unknown of item.unknown || []) if(typeof unknown==='string') lines.push(`待確認：${unknownLabel(unknown)}`);
    return lines.length>1 ? lines.join('\n\n') : '資料不足：請依原始來源核對店名、分店與內容；日期及時間由本人決定。';
  }
  function sanitizeResponse(data) {
    if(!data || data.version!==2 || !Array.isArray(data.sources) || data.sources.length>20 || !Array.isArray(data.items) || data.items.length>50) throw new Error('整理結果格式不正確；原始輸入仍保留，請重試或手動建立。');
    const sources=data.sources.filter(source=>source && typeof source.id==='string' && typeof source.text==='string').map(source=>({...source,text:source.text.slice(0,20000),url:source.url?validateUrl(source.url):undefined}));
    return {...data,sources,items:data.items.filter(item=>item && typeof item==='object')};
  }
  async function initializeRich(data,workerJobId='',attempt=generation) {
    const response=sanitizeResponse(data);
    const fingerprint=workerJobId ? `worker:${workerJobId}` : JSON.stringify(response.sources.map(source=>[source.url || '',source.text]));
    const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
    const digest=await hash(fingerprint);
    const itemKeys=await Promise.all(response.items.map(item=>hash(JSON.stringify([item.name?.value || '',response.sources.find(source=>source.id===item.scope?.sourceId)?.url || '',item.scope?.quote || item.name?.quote || '']))));
    if(attempt!==generation || $('#private-app').hidden)throw new DOMException('登入狀態或輸入已變更','AbortError');
    const jobId='import_'+digest;
    const existingKeys=new Set(window.TripPlanner.getTrips()[0].days.flat().flatMap(activity=>activity.fields.filter(field=>field.label==='匯入識別').map(field=>field.value)));
    rich={id:jobId,response,edits:response.items.map((item,index)=>({importKey:`${jobId}_${itemKeys[index].slice(0,24)}`,place:grounded(item.name,response.sources)?item.name.value:'',category:'自訂',notes:itemNotes(item,response.sources),date:'',startTime:'',endTime:'',endDayOffset:0,confirmed:false,selected:false,added:existingKeys.has(`${jobId}_${itemKeys[index].slice(0,24)}`),userEdited:false})),phase:'整理完成，請核對來源與分項草稿。'};
    renderRich();persistRich();
  }
  function richProblems(draft) {
    const problems=[];
    if(!draft.place.trim() || draft.place.length>150)problems.push('請填寫名稱（最多150字）');
    if(!dates.includes(draft.date))problems.push('請選擇旅行日期');
    if(!timeValid(draft.startTime) || !timeValid(draft.endTime) || (draft.endTime && !draft.startTime) || (draft.endTime && !draft.endDayOffset && draft.endTime<=draft.startTime) || (draft.endDayOffset && (!draft.startTime || !draft.endTime)))problems.push('時間格式或起訖順序不正確；跨日請勾選翌日');
    if(draft.notes.length>5000)problems.push('備註超過5000字，請先整理');
    if(!draft.confirmed)problems.push('請本人確認來源、日期與時間');
    if(draft.added)problems.push('已加入行程');
    return problems;
  }
  function updateRich() {
    if(!rich)return;
    const selected=rich.edits.filter(draft=>draft.selected && !draft.added);
    $('#import-batch-add').disabled=pending || !selected.length || selected.some(draft=>richProblems(draft).length);
    $('#import-results-summary').textContent=`共 ${rich.edits.length} 筆草稿，已選 ${selected.length} 筆。${rich.response.warnings?.filter(message=>typeof message==='string').join('；') || ''} 未補查的資料不視為已查證；發布日、營業時間與旅行排程分開。`;
    rich.edits.forEach((draft,index)=>{
      const message=$(`#import-${index}-status`);if(!message)return;
      const problems=richProblems(draft);
      let timing=draft.startTime ? '日期／時間已由本人確認' : '未填時間，保留待確認';
      if(dates.includes(draft.date) && draft.endDayOffset===1){const endDate=new Date(`${draft.date}T00:00:00Z`);endDate.setUTCDate(endDate.getUTCDate()+1);timing=`${draft.date} ${draft.startTime || '待確認'} → ${endDate.toISOString().slice(0,10)} ${draft.endTime || '待確認'}；跨日 +1，活動留在開始日`;}
      message.textContent=[...problems,timing+'（日本時間）'].join('；');
    });
  }
  function renderRich() {
    if(!rich || !$('#import-results'))return;
    $('#link-draft-form').hidden=true;$('#import-results').hidden=false;const list=$('#import-results-list');list.replaceChildren();
    const sources=rich.response.sources;
    const rawDetails=el('details','import-evidence'),rawTitle=el('summary','','原始資料與來源（不是模型摘要）');rawDetails.append(rawTitle);
    sources.forEach(source=>{
      const section=el('section','');section.append(el('h4','',source.title || source.id),el('p','import-source-meta',`來源類型：${sourceType(source)}；取得：${source.capturedAt || '未提供'}；發布：${source.publishedAt || '未知，可能過時'}`));
      if(source.url){const link=el('a','source-link',source.url);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';section.append(link);}
      const timestamp=videoEvidenceLink(source);if(timestamp)section.append(timestamp);section.append(el('pre','preview-source',source.text));rawDetails.append(section);
    });list.append(rawDetails);
    rich.edits.forEach((draft,index)=>{
      const item=rich.response.items[index] || {},card=el('article','import-item');card.dataset.importItem=String(index);
      const header=el('div','import-item-heading'),label=el('label','import-select'),select=el('input');select.type='checkbox';select.id=`import-${index}-select`;select.checked=draft.selected;select.disabled=draft.added;label.append(select,document.createTextNode(draft.added ? `第${index+1}筆（已加入）` : `選擇第${index+1}筆`));header.append(label,el('h3','',valueOf(item.name) || '名稱待確認'));card.append(header);
      select.addEventListener('change',()=>{draft.selected=select.checked;updateRich();persistRich();});
      card.append(el('p','import-summary',`來源支持 ${Object.values(item.facts || {}).filter(fact=>grounded(fact,sources)).length} 項資訊；${rich.response.modelUsed && rich.response.modelUsed!=='metadata' ? '模型協助整理，仍須核對原文' : '原始資料整理，未使用模型'}。分店、營業與價格可能變動。`));
      for(const warning of item.warnings || [])if(typeof warning==='string')card.append(el('p','import-warning',warning));
      const evidence=el('details','import-evidence');evidence.append(el('summary','','來源摘要與逐項證據'));
      if(grounded(item.name,sources))evidence.append(el('p','',`名稱依據：「${item.name.quote}」〔${item.name.sourceId}〕`));
      for(const [key,fact] of Object.entries(item.facts || {})) {
        if(grounded(fact,sources)) {
          const source=sources.find(source=>source.id===fact.sourceId),group=el('div','import-facts');group.append(el('h4','',factsLabels[key] || key),el('p','',fact.value),el('blockquote','',fact.quote),el('p','import-source-meta',`〔${fact.sourceId}〕${sourceType(source)}；${sourceReference(source)}；資料日期：${fact.date || '未提供，需確認是否過時'}`));const timestamp=videoEvidenceLink(source,fact.quote);if(timestamp)group.append(timestamp);evidence.append(group);
        } else evidence.append(el('p','import-warning',`${factsLabels[key] || key}沒有可核對的逐字證據，未採用，請手動確認。`));
      }
      for(const opinion of item.opinions || [])if(grounded(opinion,sources))evidence.append(el('p','',`單一來源心得（非官方資料）：${opinion.value}；原文「${opinion.quote}」〔${opinion.sourceId}〕`));
      for(const message of item.unknown || [])if(typeof message==='string')evidence.append(el('p','import-warning',`待確認：${unknownLabel(message)}`));card.append(evidence);
      const fields=el('div','import-edit-fields');fields.append(el('h4','','本人編輯的旅行草稿'));
      for(const [key,title,suffix] of [['place','名稱','place'],['category','分類','category'],['notes','備註（可修改；來源證據仍保留在上方）','notes'],['date','旅行開始日期','date'],['startTime','開始時間（選填）','start'],['endTime','結束時間（選填）','end']]) {
        const label=el('label','form-field',title),input=el(key==='notes'?'textarea':['category','date'].includes(key)?'select':'input');input.id=`import-${index}-${suffix}`;input.setAttribute('aria-label',`第${index+1}筆${title}`);
        if(key==='category')for(const option of ['自訂','景點','購物','美食','交通','住宿']) {const node=el('option','',option);node.value=option;input.append(node);}
        if(key==='date')for(const option of ['待確認：選擇日期',...dates]) {const node=el('option','',option);node.value=dates.includes(option)?option:'';input.append(node);}
        if(key==='startTime' || key==='endTime')input.type='time';
        if(key==='place')input.maxLength=150;if(key==='notes'){input.rows=5;input.maxLength=5000;}
        input.value=draft[key];input.disabled=draft.added;
        input.addEventListener('input',()=>{draft[key]=input.value;draft.userEdited=true;draft.confirmed=false;$(`#import-${index}-confirm`).checked=false;updateRich();persistRich();});label.append(input);fields.append(label);
      }
      for(const [suffix,title,key] of [['next-day','結束於翌日（跨日 +1，活動留在開始日）','endDayOffset'],['confirm','我已核對來源、分店及本人旅行日期時間；未填時間保留待確認','confirmed']]) {
        const label=el('label','import-confirm'),checkbox=el('input');checkbox.type='checkbox';checkbox.id=`import-${index}-${suffix}`;checkbox.checked=Boolean(draft[key]);checkbox.disabled=draft.added;
        checkbox.addEventListener('change',()=>{draft[key]=key==='endDayOffset'?(checkbox.checked?1:0):checkbox.checked;if(key==='endDayOffset'){draft.confirmed=false;$(`#import-${index}-confirm`).checked=false;}updateRich();persistRich();});label.append(checkbox,document.createTextNode(title));fields.append(label);
      }
      const message=el('p','draft-pending');message.id=`import-${index}-status`;fields.append(message);card.append(fields);list.append(card);
    });
    const manual=el('button','secondary-button','從原始資料建立一筆待確認草稿');manual.type='button';manual.id='import-manual-item';
    manual.addEventListener('click',()=>{if(rich.edits.length>=50){status('一次最多50筆草稿。');return;}const index=rich.edits.length;rich.response.items.push({facts:{},opinions:[],unknown:['由本人核對原始資料建立，尚無模型識別店名。']});rich.edits.push({importKey:`${rich.id}_${index}`,place:'',category:'自訂',notes:'本人依原始資料建立；請核對名稱、分店與內容。',date:'',startTime:'',endTime:'',endDayOffset:0,confirmed:false,selected:false,added:false,userEdited:true});renderRich();persistRich();});list.append(manual);updateRich();setProgress(rich.phase || '請核對草稿。');
  }
  async function restoreRich(verified) {
    const attempt=generation;
    try {
      identity={id:verified.id,scope:verified.scope};
      const saved=await window.TripImportStore?.read(identity);
      if(attempt!==generation || $('#private-app').hidden)return;
      if(saved?.version===2){
        $('#link-url').value=typeof saved.url==='string'?saved.url:'';if($('#link-text'))$('#link-text').value=typeof saved.text==='string'?saved.text:'';
        if(['metadata','qwen','llama'].includes(saved.model))$('#link-model').value=saved.model;if($('#link-include-frames'))$('#link-include-frames').checked=saved.includeFrames===true;
        attachments=Array.isArray(saved.attachments)?saved.attachments.filter(image=>image?.blob instanceof Blob).slice(0,2):[];
        if(saved.rich && Array.isArray(saved.rich.edits) && saved.rich.edits.length<=50){rich={...saved.rich,response:sanitizeResponse(saved.rich.response)};renderRich();}
        queuedJobId=typeof saved.queuedJobId==='string'?saved.queuedJobId:'';
        jobInputs=Object.create(null);for(const [id,value] of Object.entries(saved.jobInputs || {}).slice(0,20))if(value && typeof value==='object'){jobInputs[id]={...(typeof value.text==='string'&&value.text.length<=12000?{text:value.text}:{}),...(typeof value.imageText==='string'&&value.imageText.length<=12000?{imageText:value.imageText}:{})};}
        showImages();cacheNotice='已還原本裝置私有草稿；先前未完成的擷取不會宣稱完成。';renderHistory();
        status('已在驗證會員身份後還原本裝置草稿；附件僅留本裝置，可一鍵捨棄刪除。');
      }
    }catch(error){if(attempt===generation)status(error.message);}
    if(attempt===generation && !$('#private-app').hidden)restoreJobs(attempt);
  }
  async function runRichImport(url,text,attempt) {
    operation=new AbortController();
    const timeout=setTimeout(()=>operation?.abort(),120000);
    try {
      const ocr=[];
      for(const [index,image] of attachments.entries()) {
        setProgress(`圖片 ${index+1}/${attachments.length}：本機 OCR 辨識中…`);
        if(image.ocrText===undefined){const result=await window.TripImportOCR.recognize(image.blob,{signal:operation.signal,onProgress:progress=>{if(attempt===generation)setProgress(`圖片 ${index+1}/${attachments.length}：${progress.phase} ${Math.round(progress.progress*100)}%`);}});if(attempt!==generation)return;image.ocrText=result.text;image.confidence=result.confidence;}
        image.insufficient=String(image.ocrText || '').replace(/[^\p{L}\p{N}]/gu,'').length<4;
        if(!image.insufficient)ocr.push(`【圖片${index+1} OCR；信心${Math.round(image.confidence)}%，請核對原圖】\n${image.ocrText}`);
      }
      if(attempt!==generation || $('#private-app').hidden)return;showImages();persistRich();
      if(attachments.length && !ocr.length && !url && !text)throw new Error('未辨識到足夠店名文字，請補店名或原文；原圖及原始辨識文字可在上方核對。');
      setProgress(url ? '正在取得公開來源與有證據的文字整理；受限平台不會繞過登入。' : '正在整理提供的文字／OCR 證據…');
      const imageText=ocr.join('\n\n');
      if(imageText.length>12000)throw new Error('圖片辨識文字合計超過12000字；請刪除附件或裁切圖片分批整理，原圖與辨識結果仍保留。');
      const data=await window.TripAuth.importAnalysis({url:url || undefined,text:text || undefined,imageText:imageText || undefined,model:$('#link-model').value,includeFrames:$('#link-include-frames')?.checked || false},{signal:operation.signal});
      if(attempt!==generation || $('#private-app').hidden)return;
      if(data?.version===2 && data.status==='queued' && typeof data.jobId==='string'){queuedJobId=data.jobId;jobInputs[data.jobId]={text:text || undefined,imageText:imageText || undefined};persistRich();renderHistory();status('已建立私人背景任務，尚未取得摘要。約每15分鐘啟動處理，可能延後；原始輸入保留，可離開後重新驗證會員查看。');pollJob(queuedJobId,attempt);}
      else if(data?.version===2) {await initializeRich(data);status(data.status==='needs_input'?'未取得足夠來源，請補貼原文／字幕／圖片，或依原始資料建立待確認草稿。':'整理結果已保留，請核對各項證據；尚未加入行程。');}
      else if(data && typeof data.evidence==='string' && data.evidence.trim()){showDraft(url,data);status(data.warning || '已取得公開資料；請編輯草稿，缺資料保持待確認。');}
      else throw new Error('沒有可核對的來源內容；請補貼文字、字幕或清晰圖片。');
    } finally {clearTimeout(timeout);operation=null;}
  }
  $('#link-import-form').addEventListener('submit',async event=>{
    event.preventDefault();if(pending||$('#private-app').hidden)return;
    let url='',text=$('#link-text')?.value.trim() || '';
    try {if($('#link-url').value.trim())url=validateUrl($('#link-url').value.trim());if(!url&&!text&&!attachments.length)throw new Error('請提供公開連結、圖片或原文／字幕。');if(text.length>12000)throw new Error('原文最多12000字，請分批整理。');}catch(error){status(error.message);return;}
    const attempt=++generation;pending=true;sourceUrl='';persistRich();$('#link-fetch').disabled=true;$('#draft-add').disabled=true;$('#link-draft-form').hidden=true;status('正在整理，原始輸入與既有結果仍保留；成功後會重建草稿並取代手動修改，不會直接加入行程。');
    try {
      if(typeof window.TripAuth?.importAnalysis!=='function')throw new Error('前端版本不一致，請重新整理頁面。');
      await runRichImport(url,text,attempt);
    }catch(error){if(attempt!==generation||$('#private-app').hidden)return;setProgress('未完成；可保留原文重試或補貼來源。');status(`${error.name==='AbortError'?'辨識已取消或逾時':error.message} 原始輸入仍保留；未取得的資料不會編造，請貼入原文、字幕或清晰圖片。`);if(!attachments.length && !text)showDraft(url,null);persistRich();}
    finally{if(attempt===generation){pending=false;$('#link-fetch').disabled=false;updateRich();}}
  });
  $('#link-images')?.addEventListener('change',event=>{
    const files=[...event.target.files];event.target.value='';
    if(pending)return;
    if(attachments.length+files.length>2){status('一次最多2張圖片；原附件仍保留。');return;}
    if(files.some(file=>file.size>4*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(file.type))){status('圖片限 PNG、JPEG、WebP，每張最多4 MB；原附件仍保留。');return;}
    attachments.push(...files.map(blob=>({id:crypto.randomUUID(),blob,name:blob.name})));showImages();persistRich();
  });
  for(const selector of ['#link-url','#link-text','#link-model','#link-include-frames'])$(selector)?.addEventListener('input',persistRich);
  $('#import-batch-add')?.addEventListener('click',()=>{
    if(pending || !rich || $('#private-app').hidden)return;
    const selected=rich.edits.filter(draft=>draft.selected&&!draft.added);
    try {
      if(!selected.length || selected.some(draft=>richProblems(draft).length))throw new Error('請核對並確認每一筆選取草稿；整批尚未加入。');
      const result=window.TripPlanner.addImportedDrafts(selected.map(draft=>({...draft,crossDayConfirmed:draft.endDayOffset===1,sources:rich.response.sources.map(sourceReference).slice(0,10)})));
      selected.forEach(draft=>{draft.added=true;draft.selected=false;});renderRich();persistRich();status(`已將 ${result.count} 筆草稿加入行程；請按儲存，讓另一位載入。原始來源與結果仍保留。`);
    }catch(error){status(error.message);}
  });
  $('#import-clear-results')?.addEventListener('click',async()=>{if(!identity)return;const owner={...identity};clear();try{await window.TripImportStore?.remove(owner);status('已捨棄本裝置草稿並刪除附件；已加入的行程不受影響。');}catch(error){status(error.message);}});
  window.addEventListener('trip-member-ready',event=>restoreRich(event.detail));
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
  $('#draft-cancel').addEventListener('click',()=>{const owner=identity;clear();if(owner)window.TripImportStore?.remove(owner).catch(error=>status(error.message));});
  window.addEventListener('trip-planner-locked',()=>clear({privateLock:true}));
  let focusFrame=0;
  function keepImportFocusVisible(){
    focusFrame=0;const control=document.activeElement,view=$('#view-link-import');
    if($('#private-app').hidden || !view || view.hidden || !view.contains(control) || !control.matches('input:not([type="checkbox"]),textarea,select'))return;
    const viewport=window.visualViewport,top=(viewport?.offsetTop || 0)+12;
    let bottom=(viewport?.offsetTop || 0)+(viewport?.height || innerHeight)-14;
    const nav=$('.bottom-nav'),navRect=nav?.getBoundingClientRect();if(navRect&&getComputedStyle(nav).position==='fixed'&&navRect.top>top&&navRect.top<bottom)bottom=navRect.top-14;
    let rect=control.getBoundingClientRect(),targetTop=rect.top,targetBottom=rect.bottom;
    if(control.matches('textarea')){
      const style=getComputedStyle(control),mirror=el('div'),marker=el('span','','\u200b');
      for(const property of ['fontFamily','fontSize','fontWeight','letterSpacing','lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderLeftWidth','borderRightWidth','whiteSpace','wordBreak'])mirror.style[property]=style[property];
      Object.assign(mirror.style,{position:'fixed',left:'-100000px',top:'0',width:`${rect.width}px`,boxSizing:'border-box',whiteSpace:'pre-wrap',overflowWrap:'break-word',visibility:'hidden',borderStyle:'solid'});
      mirror.textContent=control.value.slice(0,control.selectionStart ?? control.value.length);mirror.append(marker);document.body.append(mirror);
      const y=marker.getBoundingClientRect().top-mirror.getBoundingClientRect().top,line=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.5;mirror.remove();
      if(y+line-control.scrollTop>control.clientHeight-8)control.scrollTop=y+line-control.clientHeight+8;
      else if(y-control.scrollTop<8)control.scrollTop=Math.max(0,y-8);
      targetTop=Math.max(rect.top,rect.top+y-control.scrollTop);targetBottom=Math.min(rect.bottom,targetTop+line*1.5);
    }
    if(bottom<=top+20)return;
    const delta=targetBottom>bottom+2?Math.min(targetBottom-bottom,Math.max(0,targetTop-top)):targetTop<top-2?targetTop-top:0;
    if(Math.abs(delta)>2)window.scrollBy({top:delta,behavior:'instant'});
  }
  function scheduleImportFocus(){
    const viewport=window.visualViewport,focused=$('#view-link-import')?.contains(document.activeElement),keyboard=!$('#private-app').hidden && focused && viewport && Math.abs((viewport.scale || 1)-1)<.05 && (document.documentElement.clientHeight-viewport.height)>=120;
    if(keyboard)document.documentElement.dataset.importKeyboard='open';else document.documentElement.removeAttribute('data-import-keyboard');
    if(!focusFrame)focusFrame=requestAnimationFrame(keepImportFocusVisible);
  }
  for(const type of ['focusin','input','compositionupdate','compositionend'])$('#view-link-import')?.addEventListener(type,scheduleImportFocus);
  window.visualViewport?.addEventListener('resize',scheduleImportFocus);window.visualViewport?.addEventListener('scroll',scheduleImportFocus);window.addEventListener('resize',scheduleImportFocus);
  window.TripLinkImport=Object.freeze({validateUrl,clear});
})();
