'use strict';
(() => {
const $ = selector => document.querySelector(selector);
const SCOPE = 'owen-winnie-20261021';
const keyFor = identity => `trip-private-session-v2-${SCOPE}-${identity.userId}`;
const ACTOR_NAMES = { owen: '歐文', winnie: '溫妮', unknown: '未署名' };
const attribution = value => value === undefined ? 'unknown' : value;
const currentActor = () => session.actor;
const PERIODS = { morning: '上午', afternoon: '下午', pending: '時間待確認' };
const DATES = ['2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25'];
const periodFor = start => start ? (start < '12:00' ? 'morning' : 'afternoon') : 'pending';
const CATEGORIES = ['景點', '購物', '美食', '交通', '住宿', '自訂'];
const emptyTrip = () => ({ id: 'fukuoka-20261021', name: '福岡＆九州五日旅行', destination: '福岡＆九州', startDate: '2026-10-21', dayCount: 5, days: [[], [], [], [], []] });
let session = null, trip = null, activeDay = 0, editingId = null;
let sessionGeneration = 0;
let preservedDraftKey = null;
let quickBatch = null, quickSource = null;
const endOffset = activity => activity.endDayOffset === undefined ? 0 : activity.endDayOffset;
const validTiming = activity => (activity.startTime === '' || time(activity.startTime)) && (activity.endTime === '' || time(activity.endTime)) && [0,1].includes(endOffset(activity)) && (!activity.endTime ? endOffset(activity) === 0 : Boolean(activity.startTime) && (endOffset(activity) === 1 || activity.endTime > activity.startTime));
const followingDate = date => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate()+1); return value.toISOString().slice(0,10); };
const newId = () => crypto.randomUUID();
const authorized = () => session !== null;
function requireAuth() { if (!authorized()) throw new Error('請先以獲授權的 Google 帳號登入。'); }
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('visible'), 3500); }
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function text(value, max, optional = false) { return typeof value === 'string' && value.length <= max && (optional || value.trim().length > 0); }
function time(value) { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function mergeNotes(shopping,notes) {
  return shopping !== '' ? `購物清單：\n${shopping}\n\n備註：\n${notes}` : notes;
}
function validateTrips(trips) {
  const fail = () => { throw new Error('資料格式不正確：僅接受這份福岡＆九州五日手帳的有效備份。'); };
  if (!Array.isArray(trips) || trips.length !== 1) fail();
  const input = trips[0];
  if (!input || input.id !== 'fukuoka-20261021' || input.startDate !== '2026-10-21' || input.dayCount !== 5 || !Array.isArray(input.days) || input.days.length !== 5) fail();
  const ids = new Set();
  const days = input.days.map(day => {
    if (!Array.isArray(day) || day.length > 100) fail();
    return day.map(activity => {
      if (!activity || typeof activity.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(activity.id) || ids.has(activity.id) || !validTiming(activity) || !['morning','afternoon','pending','noon','evening'].includes(activity.period) || !CATEGORIES.includes(activity.category) || !text(activity.place, 150) || !text(activity.shopping, 2000, true) || !text(activity.notes, 5000, true) || typeof activity.completed !== 'boolean' || !Array.isArray(activity.fields) || activity.fields.length > 20) fail();
      if (!Object.hasOwn(ACTOR_NAMES, attribution(activity.createdBy)) || !Object.hasOwn(ACTOR_NAMES, attribution(activity.updatedBy))) fail();
      const notes=mergeNotes(activity.shopping,activity.notes);
      if (!text(notes,5000,true)) fail();
      ids.add(activity.id);
      const fields = activity.fields.map(field => { if (!field || !text(field.label, 60) || !text(field.value, 1000, true)) fail(); return { label: field.label.trim(), value: field.value }; });
      return { id: activity.id, startTime: activity.startTime, endTime: activity.endTime, endDayOffset: endOffset(activity), period: periodFor(activity.startTime), category: activity.category, place: activity.place.trim(), shopping: '', notes, completed: activity.completed, fields, createdBy: attribution(activity.createdBy), updatedBy: attribution(activity.updatedBy) };
    });
  });
  return [{ ...emptyTrip(), days }];
}
function persist({silent=false} = {}) {
  requireAuth();
  try { sessionStorage.setItem(keyFor(session), JSON.stringify({ version: 2, trips: [trip] })); $('#storage-status').textContent = '已暫存於本次登入；登出會清除暫存，共同手帳請儲存到雲端。'; }
  catch { $('#storage-status').textContent = '瀏覽器無法儲存。請儲存到雲端或匯出備份，避免遺失。'; }
  if (!silent) window.dispatchEvent(new CustomEvent('trip-planner-changed'));
}
function setEditorMode(editing) {
  if ($('#activity-quick-entry')) $('#activity-quick-entry').hidden=editing;
  if ($('#activity-detail-fields')) $('#activity-detail-fields').hidden=!editing;
  $('#activity-place').required=editing;
  $('#activity-start').required=false; $('#activity-end').required=false; $('#activity-period').required=false; $('#activity-period').disabled=true;
  if ($('#activity-date')) $('#activity-date').required=editing;
  if ($('#activity-text')) $('#activity-text').required=!editing;
}
function updateEditorDate() {
  if (!$('#editor-date')) return;
  const date=editingId && $('#activity-date') ? $('#activity-date').value : DATES[activeDay];
  const index=DATES.indexOf(date);
  $('#editor-date').textContent=index>=0 ? `10 月 ${21+index} 日 · 星期${['三','四','五','六','日'][index]}` : '日期待確認';
}
function resetEditor() {
  editingId = null; quickBatch = null; quickSource = null; $('#activity-form').reset(); $('#custom-fields').replaceChildren();
  $('#activity-start').value = ''; $('#activity-end').value = '';
  if ($('#activity-date')) $('#activity-date').value=DATES[activeDay];
  updateEditorDate();
  if ($('#quick-preview')) { $('#quick-preview').textContent=''; delete $('#quick-preview').dataset.state; }
  setEditorMode(false);
  $('#activity-form-title').textContent = '新增活動'; $('#activity-submit').textContent = '新增'; $('#activity-cancel').hidden = true;
}
function readQuickBatch() {
  if (!window.TripQuickEntry?.parseBatch) throw new Error('批次文字解析尚未準備完成，請重新整理頁面。');
  return window.TripQuickEntry.parseBatch($('#activity-text').value,{date:DATES[activeDay]});
}
function entryProblems(entry) {
  const errors=[];
  if (!text(entry.place,150)) errors.push('請填寫 1 至 150 字的行程名稱。');
  if (!DATES.includes(entry.date)) errors.push('開始日期須在 2026/10/21 至 10/25；不同年份請核對並修改日期。');
  if (!validTiming(entry)) errors.push('起訖時間格式不正確，或結束未晚於開始；跨日請勾選「結束於翌日」。');
  for (const issue of entry.issues || []) {
    if (issue.blocking === false) continue;
    const fields=issue.fields || [issue.field];
    const field=issue.field;
    if (['segment','year','unknown'].includes(field)) { if(!entry.acknowledged) errors.push(issue.message); continue; }
    const repaired=fields.some(key=>entry.edited?.[key] && (['startTime','endTime'].includes(key) ? time(entry[key]) : key==='date' ? DATES.includes(entry.date) : text(entry[key],key==='notes'?5000:150,key==='notes')));
    if (!repaired && !(field==='endTime' && entry.endDayOffset===1 && time(entry.startTime) && time(entry.endTime))) errors.push(issue.message);
  }
  if (!entry.issues && entry.errors.length) {
    for(const message of entry.errors) {
      if (/時間|點|分鐘/.test(message)) {
        if (!(entry.edited?.startTime && time(entry.startTime)) && !(entry.edited?.endTime && time(entry.endTime)) && !(entry.endDayOffset===1 && time(entry.startTime) && time(entry.endTime))) errors.push(message);
      } else if(/日期|年份/.test(message)) { if(!entry.edited?.date || !DATES.includes(entry.date)) errors.push(message); }
      else if(!entry.acknowledged) errors.push(message);
    }
  }
  if (entry.crossDayNeedsConfirmation && !entry.endDayOffset && entry.endTime && entry.endTime <= entry.startTime) errors.push('請修正結束時間，或確認結束於翌日。');
  if (!text(entry.notes || '',5000,true)) errors.push('備註最多 5000 字。');
  return [...new Set(errors)];
}
function batchErrors(batch) {
  return [...batch.errors,...batch.entries.flatMap((entry,index)=>entryProblems(entry).map(error=>`第 ${index+1} 筆：${error}`))];
}
function previewSummary() {
  if (!quickBatch) return;
  const errors=batchErrors(quickBatch), status=$('#quick-preview-status');
  $('#quick-preview').dataset.state=errors.length ? 'error' : 'ready';
  status.textContent=errors.length ? `整批尚未加入；請修正或確認以下問題。${errors.join('；')}` : `將新增 ${quickBatch.entries.length} 筆活動；送出使用下方修正資料。`;
  quickBatch.entries.forEach((entry,index)=>{
    const target=$(`#preview-message-${index}`), problems=entryProblems(entry);
    const pending=entry.pending.filter(message=>!(/開始時間/.test(message) && time(entry.startTime)) && !(/結束時間/.test(message) && time(entry.endTime)) && !(/日期/.test(message) && entry.edited.date) && !(/翌日|跨日/.test(message) && entry.endDayOffset===1));
    target.dataset.state=problems.length ? 'error' : pending.length ? 'pending' : 'recognized';
    target.textContent=[problems.length ? '格式錯誤／待確認' : pending.length ? '待確認' : '已辨識',...problems,...pending,entry.edited.date ? '日期已手動修正' : '',entry.endDayOffset===1 && entry.date && DATES.includes(entry.date) ? `跨日 +1：${entry.date} ${entry.startTime} 至 ${followingDate(entry.date)} ${entry.endTime}（日本時間）` : ''].filter(Boolean).join(' · ');
  });
}
function renderQuickPreview() {
  const container=$('#quick-preview'); container.replaceChildren();
  container.append(node('p','preview-status','')); container.firstChild.id='quick-preview-status';
  quickBatch.entries.forEach((entry,index)=>{
    const item=node('section','preview-item'); item.dataset.entry=String(index);
    item.append(node('h4','',`第 ${index+1} 筆`),node('pre','preview-source',entry.raw || entry.source || quickSource));
    const fields=node('div','preview-fields');
    for (const [key,title] of [['place','行程名稱'],['date','日期'],['startTime','開始時間'],['endTime','結束時間'],['notes','備註']]) {
      const label=node('label',`form-field${key==='place' || key==='notes' ? ' preview-wide' : ''}`,title), input=node(key==='notes'?'textarea':'input');
      input.id=`preview-${index}-${key}`; input.dataset.field=key; input.value=entry[key] || ''; input.setAttribute('aria-label',`第 ${index+1} 筆${title}`);
      if(key==='notes') input.className='preview-notes';
      if(key==='date') input.placeholder='2026-10-21';
      if(key==='startTime' || key==='endTime') input.placeholder='HH:mm（可留空）';
      input.addEventListener('input',()=>{entry[key]=input.value;entry.edited[key]=true;previewSummary();}); label.append(input);fields.append(label);
    }
    const nextLabel=node('label','preview-confirm'), next=node('input');next.type='checkbox';next.id=`preview-${index}-next-day`;next.checked=entry.endDayOffset===1;
    next.addEventListener('change',()=>{entry.endDayOffset=next.checked?1:0;entry.crossDayConfirmed=next.checked;previewSummary();});nextLabel.append(next,document.createTextNode('結束於翌日（跨日 +1）'));fields.append(nextLabel);
    if(entry.errors.length || (entry.issues || []).some(issue=>['segment','year','unknown'].includes(issue.field)) || entry.pending.some(message=>/歧義|分段|確認原文/.test(message))) {
      const label=node('label','preview-confirm'), checkbox=node('input');checkbox.type='checkbox';checkbox.id=`preview-${index}-ack`;checkbox.className='preview-ack';
      checkbox.addEventListener('change',()=>{entry.acknowledged=checkbox.checked;previewSummary();});label.append(checkbox,document.createTextNode('已核對完整原文及分段，並修正預覽資訊'));fields.append(label);
    }
    const message=node('p','preview-message');message.id=`preview-message-${index}`;item.append(fields,message);container.append(item);
  });
  previewSummary();
}
function previewQuickEntry() {
  if (!authorized() || !$('#quick-preview') || editingId) return;
  const input=$('#activity-text')?.value || '';
  if(quickSource===input && quickBatch) return;
  quickSource=input;
  if (!input.trim()) { quickBatch=null; $('#quick-preview').textContent='可貼入多筆活動；未寫日期沿用前一筆日期，首筆採目前選取日期；時間可稍後補充。'; delete $('#quick-preview').dataset.state; return; }
  try {
    quickBatch=readQuickBatch();
    quickBatch.entries.forEach(entry=>{entry.edited={};entry.acknowledged=false;entry.endDayOffset=entry.endDayOffset || 0;entry.errors=entry.errors || [];entry.pending=entry.pending || [];});
    renderQuickPreview();
  } catch(error) { quickBatch=null; $('#quick-preview').textContent=error.message; $('#quick-preview').dataset.state='error'; }
}
function closeEditor() { window.TripMobileUI?.closeEditor(); window.TripMobileUI?.showView('itinerary'); }
function startActivity() {
  requireAuth();
  setEditorMode(Boolean(editingId)); previewQuickEntry();
  window.TripMobileUI?.openEditor({editing:Boolean(editingId)});
}
function addField(label = '', value = '') {
  if (!authorized()) return;
  if ($('#custom-fields').children.length >= 20) { toast('最多可新增 20 個自訂欄位。'); return; }
  const row = node('div', 'custom-field-row');
  const labelInput = node('input'); labelInput.value = label; labelInput.maxLength = 60; labelInput.required = true; labelInput.placeholder = '欄位名稱'; labelInput.setAttribute('aria-label', '自訂欄位名稱');
  const valueInput = node('input'); valueInput.value = value; valueInput.maxLength = 1000; valueInput.placeholder = '內容'; valueInput.setAttribute('aria-label', '自訂欄位內容');
  const remove = node('button', 'danger-button', '移除'); remove.type = 'button'; remove.setAttribute('aria-label', '移除自訂欄位'); remove.addEventListener('click', () => { if (authorized()) row.remove(); });
  row.append(labelInput, valueInput, remove); $('#custom-fields').append(row);
}
function edit(activity) {
  if (!authorized()) return;
  editingId = activity.id; setEditorMode(true);
  if ($('#activity-date')) $('#activity-date').value=DATES[activeDay];
  updateEditorDate();
  if ($('#activity-next-day')) $('#activity-next-day').checked=endOffset(activity)===1;
  for (const [id, value] of Object.entries({ start: activity.startTime, end: activity.endTime, period: periodFor(activity.startTime), category: activity.category, place: activity.place, notes:activity.notes })) $(`#activity-${id}`).value = value;
  $('#custom-fields').replaceChildren(); activity.fields.forEach(field => addField(field.label, field.value));
  $('#activity-form-title').textContent = '編輯活動'; $('#activity-submit').textContent = '完成編輯'; $('#activity-cancel').hidden = false;
  window.TripMobileUI?.openEditor({editing:true}); $('#activity-place').focus();
}
function changed(options) { persist(options); render(); }
function render() {
  if (!authorized()) return;
  const generation = sessionGeneration;
  const allowed = () => authorized() && generation === sessionGeneration;
  const weekdays = ['三', '四', '五', '六', '日'];
  $('#day-tabs').replaceChildren();
  for (let index = 0; index < 5; index++) {
    const button = node('button', 'day-tab'); button.type = 'button'; button.setAttribute('aria-pressed', String(index === activeDay)); button.setAttribute('aria-label',`10 / ${21 + index} · 第 ${index + 1} 天`);
    button.append(node('span','day-tab-weekday',`週${weekdays[index]}`),node('span','day-tab-number',String(21+index)),node('span','day-tab-count',`${trip.days[index].length} 個活動`));
    button.addEventListener('click', () => { if (!allowed()) return; activeDay = index; render(); previewQuickEntry(); $('#day-tabs').children[index].focus(); }); $('#day-tabs').append(button);
  }
  $('#day-summary').textContent = `10 月 ${21 + activeDay} 日 · 星期${weekdays[activeDay]}`;
  const activityCount=trip.days[activeDay].length, completedCount=trip.days[activeDay].filter(activity=>activity.completed).length;
  if ($('#day-progress')) $('#day-progress').textContent=`${activityCount} 個活動 · 已完成 ${completedCount} 個`;
  updateEditorDate();
  const list = $('#activity-list'); list.replaceChildren();
  Object.entries(PERIODS).forEach(([period,title]) => {
    const sorted=trip.days[activeDay].filter(activity=>activity.period===period).sort((a,b)=>a.startTime.localeCompare(b.startTime));
    if (period==='pending' && !sorted.length) return;
    const section=node('section','period-section'); section.dataset.period=period;
    const header=node('div','period-header'); header.append(node('h3','period-heading',title)); section.append(header);
    const activities=node('div','period-list');
    if (!sorted.length) activities.append(node('p','empty-state','留點空白，等我們一起填上。'));
    sorted.forEach(activity=>{
      const card=node('article',`activity-card actor-${activity.createdBy}${activity.completed ? ' is-completed' : ''}`); card.dataset.activityId=activity.id;
      const details=node('details','activity-details');
      const summary=node('summary','activity-row');
      const timing=activity.startTime ? `${activity.startTime}–${endOffset(activity)===1 ? '翌' : ''}${activity.endTime || '待確認'}` : '時間待確認';
      summary.append(node('span','row-time',timing),node('span','row-category category-badge',activity.category),node('span','row-title',activity.place),node('span',`row-actor actor-badge actor-${activity.createdBy}`,ACTOR_NAMES[activity.createdBy]));
      if (endOffset(activity)===1) summary.querySelector('.row-time').append(node('span','cross-day-badge','跨日 +1'));
      const content=node('div','activity-content');
      content.append(node('p','activity-date-range',`${DATES[activeDay]} ${activity.startTime || '時間待確認'} 至 ${endOffset(activity)===1 ? followingDate(DATES[activeDay]) : DATES[activeDay]} ${activity.endTime || '時間待確認'}（日本時間）`));
      content.append(node('h4','',activity.place));
      content.append(node('span',`actor-badge actor-${activity.updatedBy}`,`${ACTOR_NAMES[activity.updatedBy]}更新`));
      if (activity.notes) content.append(node('h5','','備註'),node('p','activity-notes',activity.notes));
      activity.fields.forEach(field=>content.append(node('h5','',field.label),node('p','',field.value)));
      const completedLabel=node('label','completed-toggle'),completed=node('input'); completed.type='checkbox'; completed.checked=activity.completed;completed.setAttribute('aria-label',`標記完成：${activity.place}`);
      completed.addEventListener('change',()=>{if(!allowed())return;activity.completed=completed.checked;activity.updatedBy=currentActor();changed();});completedLabel.append(completed,document.createTextNode('已完成'));content.append(completedLabel);
      const actions=node('div','activity-actions');
      const editButton=node('button','secondary-button','編輯');editButton.type='button';editButton.setAttribute('aria-label',`編輯活動：${activity.place}`);editButton.addEventListener('click',()=>{if(allowed())edit(activity);});
      const remove=node('button','danger-button','刪除');remove.type='button';remove.setAttribute('aria-label',`刪除活動：${activity.place}`);remove.addEventListener('click',()=>{if(!allowed())return;trip.days[activeDay]=trip.days[activeDay].filter(item=>item.id!==activity.id);if(editingId===activity.id)resetEditor();changed();});actions.append(editButton,remove);content.append(actions);
      const transfer=node('div','activity-transfer'),daySelect=node('select');daySelect.className='transfer-day';daySelect.setAttribute('aria-label',`目標日期：${activity.place}`);
      DATES.forEach((date,index)=>{const option=node('option','',`10 / ${21+index}`);option.value=String(index);daySelect.append(option);});daySelect.value=String(activeDay);
      transfer.append(daySelect);
      for (const copying of [false,true]) {
        const button=node('button','secondary-button',copying?'複製':'移動');button.type='button';button.dataset.action=copying?'copy':'move';button.setAttribute('aria-label',`${copying?'複製':'移動'}活動：${activity.place}`);
        button.addEventListener('click',()=>{
          if(!allowed())return;const target=Number(daySelect.value);
          if(!Number.isInteger(target)||target<0||target>4)return;
          if(!copying&&target===activeDay){toast('活動已在這個日期。');return;}
          if((copying||target!==activeDay)&&trip.days[target].length>=100){toast('每天最多 100 個活動。');return;}
          const candidate=structuredClone(trip),next={...structuredClone(activity),id:copying?newId():activity.id,createdBy:copying?currentActor():activity.createdBy,updatedBy:currentActor()};
          if(!copying)candidate.days[activeDay]=candidate.days[activeDay].filter(item=>item.id!==activity.id);
          candidate.days[target].push(next);try{trip=validateTrips([candidate])[0];}catch(error){toast(error.message);return;}
          if(editingId===activity.id&&!copying && $('#activity-date'))$('#activity-date').value=DATES[target];
          changed();toast(copying?'已複製活動。':'已移動活動。');
        });transfer.append(button);
      }
      content.append(transfer);details.append(summary,content);card.append(details);activities.append(card);
    });section.append(activities);list.append(section);
  });
  window.dispatchEvent(new CustomEvent('trip-planner-rendered',{detail:{activeDay,date:`2026-10-${21+activeDay}`,activityCount,completedCount,dayCounts:trip.days.map(day=>day.length)}}));
}
$('#activity-form').addEventListener('submit', event => {
  event.preventDefault(); if (!authorized()) return;
  const sourceDay=editingId ? trip.days.findIndex(day=>day.some(activity=>activity.id===editingId)) : -1;
  const old=sourceDay>=0 ? trip.days[sourceDay].find(activity=>activity.id===editingId) : null;
  if(editingId&&!old){toast('這個活動已不存在，請確認目前行程。');return;}
  if(!old) {
    try {
      if (!quickBatch || quickSource!==$('#activity-text').value) previewQuickEntry();
      const batch=quickBatch; if (!batch) throw new Error('請確認預覽後再新增。');
      const errors=batchErrors(batch);
      if(errors.length)throw new Error(errors.join('；'));
      if(!batch.entries.length)throw new Error('請至少輸入一筆活動。');
      const candidate=structuredClone(trip),actor=currentActor();
      for(const [index,entry] of batch.entries.entries()) {
        const day=DATES.indexOf(entry.date);
        if(day<0)throw new Error(`第 ${index+1} 筆：日期不在這次旅行範圍。`);
        if(candidate.days[day].length>=100)throw new Error(`第 ${index+1} 筆：${entry.date} 最多 100 個活動；整批尚未加入。`);
        candidate.days[day].push({id:newId(),startTime:entry.startTime || '',endTime:entry.endTime || '',endDayOffset:entry.endDayOffset || 0,period:periodFor(entry.startTime || ''),category:$('#activity-category').value,place:entry.place,shopping:'',notes:entry.notes || '',completed:false,createdBy:actor,updatedBy:actor,fields:[]});
      }
      const validated=validateTrips([candidate])[0];
      trip=validated;activeDay=DATES.indexOf(batch.entries[0].date);resetEditor();changed();closeEditor();toast(`已新增 ${batch.entries.length} 筆活動。`);
    } catch(error){
      toast(error.message);previewSummary();
      if ($('#quick-preview-status')) $('#quick-preview-status').textContent=`整批尚未加入；${error.message}`;
    }
    return;
  }
  const targetDay=DATES.indexOf($('#activity-date') ? $('#activity-date').value : DATES[activeDay]);
  if(targetDay<0){toast('請選擇這次旅行的日期。');return;}
  if(sourceDay!==targetDay&&trip.days[targetDay].length>=100){toast('每天最多 100 個活動。');return;}
  const activity={...old,startTime:$('#activity-start').value,endTime:$('#activity-end').value,endDayOffset:$('#activity-next-day')?.checked ? 1 : 0,period:periodFor($('#activity-start').value),category:$('#activity-category').value,place:$('#activity-place').value.trim(),shopping:'',notes:$('#activity-notes').value,updatedBy:currentActor(),fields:[...$('#custom-fields').children].map(row=>({label:row.children[0].value.trim(),value:row.children[1].value}))};
  if(!validTiming(activity)){toast('請確認有效起訖時間；跨日請勾選結束於翌日，未填時間可留待確認。');return;}
  const candidate=structuredClone(trip);candidate.days[sourceDay]=candidate.days[sourceDay].filter(item=>item.id!==editingId);candidate.days[targetDay].push(activity);
  try{trip=validateTrips([candidate])[0];}catch(error){toast(error.message);return;}
  activeDay=targetDay;resetEditor();changed();closeEditor();toast('活動已更新。');
});
$('#activity-text')?.addEventListener('input',previewQuickEntry);
$('#activity-date')?.addEventListener('change',updateEditorDate);
$('#activity-start').addEventListener('input',()=>{$('#activity-period').value=periodFor($('#activity-start').value);});
$('#activity-cancel').addEventListener('click',()=>{if(authorized()){resetEditor();closeEditor();}});
$('#add-custom-field').addEventListener('click', () => addField());
$('#export-trips').addEventListener('click', () => {
  if (!authorized()) return;
  const url=URL.createObjectURL(new Blob([JSON.stringify({version:2,trips:[trip]},null,2)],{type:'application/json'})); const link=node('a'); link.href=url; link.download='owen-winnie-fukuoka-20261021.json'; document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('#import-trips').addEventListener('click', () => { if(authorized()) $('#import-file').click(); });
function migrateLegacy(value) {
  if (value.version!==1||!Array.isArray(value.trips)||value.trips.length!==1) throw new Error('舊版匯入僅接受一份五天、2026-10-21 出發的行程。');
  const old=value.trips[0]; if(!old||old.startDate!=='2026-10-21'||old.dayCount!==5||!Array.isArray(old.days)||old.days.length!==5) throw new Error('舊版行程日期不符合這次旅行。');
  const next=emptyTrip(); next.days=old.days.map(day=> { if(!Array.isArray(day)) throw new Error('舊版每日活動格式不正確。'); return day.map(activity=> {
    if(!activity||!time(activity.time)||!text(activity.place,150)||!text(activity.notes,2000,true)) throw new Error('舊版活動時間或內容無法轉換，請確認備份。');
    return {id:newId(),startTime:activity.time,endTime:'',period:periodFor(activity.time),category:'自訂',place:activity.place,shopping:'',notes:activity.notes,completed:false,fields:[]};
  }); }); return validateTrips([next]);
}
$('#import-file').addEventListener('change', async event => {
  if(!authorized()) { event.target.value=''; return; }
  const file=event.target.files[0], generation=sessionGeneration; if(!file) return;
  try {
    if(file.size>5*1024*1024) throw new Error('請使用小於 5 MB 的 JSON 備份。');
    const value=JSON.parse(await file.text()); if(!authorized()||generation!==sessionGeneration) return;
    const imported=value.version===2?validateTrips(value.trips):migrateLegacy(value);
    if(!confirm('匯入會取代目前五天手帳，建議先匯出備份。確定繼續？')) return;
    if(!authorized()||generation!==sessionGeneration) return;
    trip=imported[0]; activeDay=0; resetEditor(); changed(); toast('已匯入手帳。');
  } catch(error) { if(authorized()&&generation===sessionGeneration) toast(error instanceof SyntaxError?'JSON 無法解析，原有資料未變更。':error.message); }
  finally { event.target.value=''; }
});
function lock({preserveDraft=false} = {}) {
  if (preserveDraft && session) preservedDraftKey=keyFor(session);
  if (!preserveDraft) {
    for (const key of new Set([session ? keyFor(session) : null,preservedDraftKey])) { if(key)try { sessionStorage.removeItem(key); } catch {} }
    preservedDraftKey=null;
  }
  sessionGeneration++; session=null; trip=null; activeDay=0;
  window.dispatchEvent(new CustomEvent('trip-planner-locked'));
  resetEditor(); $('#day-tabs').replaceChildren(); $('#activity-list').replaceChildren(); $('#day-summary').textContent=''; $('#storage-status').textContent=''; $('#sync-status').textContent=''; $('#account-email').textContent=''; $('#account-email').className='account-email'; $('#import-file').value=''; $('#toast').textContent=''; $('#toast').classList.remove('visible'); clearTimeout(toast.timer);
  if ($('#day-progress')) $('#day-progress').textContent=''; if ($('#editor-date')) $('#editor-date').textContent='';
  $('#private-app').hidden=true; $('#private-app').inert=true; $('#auth-screen').hidden=false;
}
async function unlock() {
  lock({preserveDraft:true}); const generation=sessionGeneration;
  if (!window.TripAuth || typeof window.TripAuth.requireMembership!=='function') throw new Error('登入驗證尚未準備完成。');
  const identity=await window.TripAuth.requireMembership();
  if (generation!==sessionGeneration) throw new Error('登入狀態已變更，請重新登入。');
  const userId=identity?.userId || identity?.id;
  const email=typeof identity?.email==='string'?identity.email.toLowerCase():'';
  if (typeof userId!=='string'||!userId||identity.scope!==SCOPE||!email.endsWith('@gmail.com')||!['owen','winnie'].includes(identity.actor)) throw new Error('此 Google 帳號未獲授權使用共同空間。');
  session={userId,email,scope:SCOPE,actor:identity.actor}; trip=emptyTrip(); let restoredDraft=false;
  if(preservedDraftKey && preservedDraftKey!==keyFor(session)) { try { sessionStorage.removeItem(preservedDraftKey); } catch {} }
  preservedDraftKey=null;
  $('#account-email').textContent=`${ACTOR_NAMES[session.actor]} · ${email}`;
  $('#account-email').className=`account-email actor-${session.actor}`;
  try { const raw=sessionStorage.getItem(keyFor(session)); if(raw) { const value=JSON.parse(raw); if(value.version!==2) throw new Error('version'); trip=validateTrips(value.trips)[0]; restoredDraft=true; } $('#storage-status').textContent='本次登入暫存已就緒；請從雲端載入共同手帳。'; }
  catch { $('#storage-status').textContent='登入暫存無法讀取，請從雲端載入或匯入備份。'; }
  render();
  return { restoredDraft };
}

function addImportedDraft(draft) {
  requireAuth();
  if (!draft || draft.confirmed !== true) throw new Error('請確認日期、時段及起訖時間後再加入。');
  const dates = ['2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25'];
  const day = dates.indexOf(draft.date);
  if (day < 0) throw new Error('請選擇這次旅行的日期。');
  if (!['morning','afternoon','noon','evening'].includes(draft.period)) throw new Error('請確認活動時段。');
  if (!time(draft.startTime)||!time(draft.endTime)||draft.endTime<=draft.startTime) throw new Error('請確認起訖時間；結束須晚於開始，跨日請分開填寫。');
  if (trip.days[day].length>=100) throw new Error('每天最多 100 個活動。');
  let source;
  try { source = new URL(draft.sourceUrl); } catch { throw new Error('來源連結格式不正確。'); }
  if (source.protocol!=='https:'||source.username||source.password||source.href.length>1000) throw new Error('來源連結格式不正確。');
  const activity = { id:newId(), startTime:draft.startTime,endTime:draft.endTime,period:periodFor(draft.startTime),category:draft.category,place:draft.place,shopping:draft.shopping || '',notes:draft.notes || '',completed:false,createdBy:currentActor(),updatedBy:currentActor(),fields:[{label:'匯入來源',value:source.href}] };
  const candidate=structuredClone(trip); candidate.days[day].push(activity);
  trip=validateTrips([candidate])[0]; activeDay=day; resetEditor(); changed();
  window.dispatchEvent(new CustomEvent('trip:activity-added'));
}
function addImportedDrafts(drafts) {
  requireAuth();
  if (!Array.isArray(drafts) || !drafts.length || drafts.length > 50) throw new Error('一次請選擇 1 至 50 筆匯入草稿。');
  const candidate=structuredClone(trip), keys=new Set(candidate.days.flat().flatMap(activity=>activity.fields.filter(field=>field.label==='匯入識別').map(field=>field.value)));
  const ids=[];
  for (const [index,draft] of drafts.entries()) {
    if (!draft || draft.confirmed!==true) throw new Error(`第 ${index+1} 筆請先確認來源、日期與時間；整批尚未加入。`);
    const day=DATES.indexOf(draft.date);
    if (day<0) throw new Error(`第 ${index+1} 筆請選擇旅行日期；整批尚未加入。`);
    const timing={startTime:draft.startTime || '',endTime:draft.endTime || '',endDayOffset:draft.endDayOffset ?? 0};
    if(!validTiming(timing)) throw new Error(`第 ${index+1} 筆時間不正確；跨日須明確確認，整批尚未加入。`);
    if(timing.endDayOffset===1 && draft.crossDayConfirmed!==true) throw new Error(`第 ${index+1} 筆請確認結束於翌日；整批尚未加入。`);
    if(!text(draft.importKey,120) || !/^[a-zA-Z0-9_-]+$/.test(draft.importKey)) throw new Error('匯入識別不完整，請重新整理結果。');
    if(keys.has(draft.importKey)) throw new Error(`第 ${index+1} 筆已加入過，請取消勾選重複項目；整批尚未加入。`);
    keys.add(draft.importKey);
    if(candidate.days[day].length>=100) throw new Error(`第 ${index+1} 筆超過每日 100 筆上限；整批尚未加入。`);
    const fields=[{label:'匯入識別',value:draft.importKey}];
    if(!Array.isArray(draft.sources) || draft.sources.length>10) throw new Error('來源格式不正確。');
    for(const source of draft.sources) {
      if(typeof source !== 'string' || source.length>1000) throw new Error('來源格式不正確。');
      if(source.startsWith('https://')) { const url=new URL(source);if(url.username || url.password) throw new Error('來源連結不可包含帳密。'); }
      fields.push({label:'匯入來源',value:source});
    }
    const activity={id:newId(),...timing,period:periodFor(timing.startTime),category:draft.category,place:draft.place,shopping:'',notes:draft.notes || '',completed:false,createdBy:currentActor(),updatedBy:currentActor(),fields};
    candidate.days[day].push(activity);ids.push(activity.id);
  }
  const validated=validateTrips([candidate])[0];
  trip=validated;activeDay=DATES.indexOf(drafts[0].date);resetEditor();changed();
  window.dispatchEvent(new CustomEvent('trip:activity-added'));
  return {count:ids.length,ids};
}
window.TripPlanner=Object.freeze({ unlock,lock,startActivity,addImportedDraft,addImportedDrafts,getTrips:()=>{requireAuth();return structuredClone([trip]);},validateTrips,replaceTrips:(trips,{silent=false}={})=>{requireAuth();const validated=validateTrips(trips);trip=validated[0];if(!silent)activeDay=0;changed({silent});} });
lock();
})();
