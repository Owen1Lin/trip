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
const newId = () => crypto.randomUUID();
const authorized = () => session !== null;
function requireAuth() { if (!authorized()) throw new Error('請先以獲授權的 Google 帳號登入。'); }
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('visible'), 3500); }
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function text(value, max, optional = false) { return typeof value === 'string' && value.length <= max && (optional || value.trim().length > 0); }
function time(value) { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validateTrips(trips) {
  const fail = () => { throw new Error('資料格式不正確：僅接受這份福岡＆九州五日手帳的有效備份。'); };
  if (!Array.isArray(trips) || trips.length !== 1) fail();
  const input = trips[0];
  if (!input || input.id !== 'fukuoka-20261021' || input.startDate !== '2026-10-21' || input.dayCount !== 5 || !Array.isArray(input.days) || input.days.length !== 5) fail();
  const ids = new Set();
  const days = input.days.map(day => {
    if (!Array.isArray(day) || day.length > 100) fail();
    return day.map(activity => {
      if (!activity || typeof activity.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(activity.id) || ids.has(activity.id) || !(activity.startTime === '' || time(activity.startTime)) || !(activity.endTime === '' || time(activity.endTime)) || (activity.endTime !== '' && (!activity.startTime || activity.endTime <= activity.startTime)) || !['morning','afternoon','pending','noon','evening'].includes(activity.period) || !CATEGORIES.includes(activity.category) || !text(activity.place, 150) || !text(activity.shopping, 2000, true) || !text(activity.notes, 2000, true) || typeof activity.completed !== 'boolean' || !Array.isArray(activity.fields) || activity.fields.length > 20) fail();
      if (!Object.hasOwn(ACTOR_NAMES, attribution(activity.createdBy)) || !Object.hasOwn(ACTOR_NAMES, attribution(activity.updatedBy))) fail();
      ids.add(activity.id);
      const fields = activity.fields.map(field => { if (!field || !text(field.label, 60) || !text(field.value, 1000, true)) fail(); return { label: field.label.trim(), value: field.value }; });
      return { id: activity.id, startTime: activity.startTime, endTime: activity.endTime, period: periodFor(activity.startTime), category: activity.category, place: activity.place.trim(), shopping: activity.shopping, notes: activity.notes, completed: activity.completed, fields, createdBy: attribution(activity.createdBy), updatedBy: attribution(activity.updatedBy) };
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
  editingId = null; $('#activity-form').reset(); $('#custom-fields').replaceChildren();
  $('#activity-start').value = ''; $('#activity-end').value = '';
  if ($('#activity-date')) $('#activity-date').value=DATES[activeDay];
  updateEditorDate();
  if ($('#quick-preview')) $('#quick-preview').textContent='';
  setEditorMode(false);
  $('#activity-form-title').textContent = '新增活動'; $('#activity-submit').textContent = '新增'; $('#activity-cancel').hidden = true;
}
function previewQuickEntry() {
  if (!authorized() || !$('#quick-preview')) return;
  const input=$('#activity-text')?.value || '';
  if (!input.trim()) { $('#quick-preview').textContent='未寫日期採目前選取日期；時間可稍後補充。'; return; }
  try {
    if (!window.TripQuickEntry?.parse) throw new Error('文字解析尚未準備完成，請重新整理頁面。');
    const parsed=window.TripQuickEntry.parse(input,{date:DATES[activeDay]});
    $('#quick-preview').textContent=parsed.errors.length ? parsed.errors.join('；') : [parsed.place,parsed.date,parsed.startTime,parsed.endTime ? `至 ${parsed.endTime}` : '',...new Set(parsed.pending)].filter(Boolean).join(' · ');
  } catch(error) { $('#quick-preview').textContent=error.message; }
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
  for (const [id, value] of Object.entries({ start: activity.startTime, end: activity.endTime, period: periodFor(activity.startTime), category: activity.category, place: activity.place, shopping: activity.shopping, notes: activity.notes })) $(`#activity-${id}`).value = value;
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
      const timing=activity.startTime ? `${activity.startTime} — ${activity.endTime || '待確認'}` : '時間待確認';
      summary.append(node('span','row-time',timing),node('span','row-category category-badge',activity.category),node('span','row-title',activity.place),node('span',`row-actor actor-badge actor-${activity.createdBy}`,ACTOR_NAMES[activity.createdBy]));
      const content=node('div','activity-content');
      content.append(node('h4','',activity.place));
      content.append(node('span',`actor-badge actor-${activity.updatedBy}`,`${ACTOR_NAMES[activity.updatedBy]}更新`));
      if (activity.shopping) content.append(node('h5','','購物清單'),node('p','activity-shopping',activity.shopping));
      if (activity.notes) content.append(node('h5','','注意事項'),node('p','activity-notes',activity.notes));
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
  let targetDay=activeDay,activity;
  if(old) {
    targetDay=DATES.indexOf($('#activity-date') ? $('#activity-date').value : DATES[activeDay]);
    activity={...old,startTime:$('#activity-start').value,endTime:$('#activity-end').value,period:periodFor($('#activity-start').value),category:$('#activity-category').value,place:$('#activity-place').value.trim(),shopping:$('#activity-shopping').value,notes:$('#activity-notes').value,updatedBy:currentActor(),fields:[...$('#custom-fields').children].map(row=>({label:row.children[0].value.trim(),value:row.children[1].value}))};
  } else {
    try {
      if(!window.TripQuickEntry?.parse)throw new Error('文字解析尚未準備完成，請重新整理頁面。');
      const parsed=window.TripQuickEntry.parse($('#activity-text').value,{date:DATES[activeDay]});
      if(parsed.errors.length)throw new Error(parsed.errors.join('；'));
      targetDay=DATES.indexOf(parsed.date);
      activity={id:newId(),startTime:parsed.startTime || '',endTime:parsed.endTime || '',period:periodFor(parsed.startTime || ''),category:$('#activity-category').value,place:parsed.place,shopping:'',notes:'',completed:false,createdBy:currentActor(),updatedBy:currentActor(),fields:[]};
    } catch(error){toast(error.message);previewQuickEntry();return;}
  }
  if(targetDay<0){toast('請選擇這次旅行的日期。');return;}
  if((!old||sourceDay!==targetDay)&&trip.days[targetDay].length>=100){toast('每天最多 100 個活動。');return;}
  if(!(activity.startTime===''||time(activity.startTime))||!(activity.endTime===''||time(activity.endTime))||(activity.endTime!==''&&(!activity.startTime||activity.endTime<=activity.startTime))){toast('結束時間必須晚於開始時間；可留空待確認，跨日請分兩天填寫。');return;}
  const candidate=structuredClone(trip);
  if(old)candidate.days[sourceDay]=candidate.days[sourceDay].filter(item=>item.id!==editingId);
  candidate.days[targetDay].push(activity);
  try{trip=validateTrips([candidate])[0];}catch(error){toast(error.message);return;}
  const edited=Boolean(editingId);activeDay=targetDay;resetEditor();changed();closeEditor();toast(edited?'活動已更新。':'活動已加入。');
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
window.TripPlanner=Object.freeze({ unlock,lock,startActivity,addImportedDraft,getTrips:()=>{requireAuth();return structuredClone([trip]);},validateTrips,replaceTrips:(trips,{silent=false}={})=>{requireAuth();const validated=validateTrips(trips);trip=validated[0];if(!silent)activeDay=0;changed({silent});} });
lock();
})();
