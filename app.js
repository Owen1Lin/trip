'use strict';
(() => {
const $ = selector => document.querySelector(selector);
const SCOPE = 'owen-winnie-20261021';
const keyFor = identity => `trip-private-session-v2-${SCOPE}-${identity.userId}`;
const ACTOR_NAMES = { owen: '歐文', winnie: '溫妮', unknown: '未署名' };
const attribution = value => value === undefined ? 'unknown' : value;
const currentActor = () => session.actor;
const PERIODS = { morning: '上午', noon: '中午', evening: '晚上' };
const CATEGORIES = ['景點', '購物', '美食', '交通', '住宿', '自訂'];
const emptyTrip = () => ({ id: 'fukuoka-20261021', name: '福岡＆九州五日旅行', destination: '福岡＆九州', startDate: '2026-10-21', dayCount: 5, days: [[], [], [], [], []] });
let session = null, trip = null, activeDay = 0, editingId = null;
let sessionGeneration = 0;
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
      if (!activity || typeof activity.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(activity.id) || ids.has(activity.id) || !time(activity.startTime) || !time(activity.endTime) || activity.endTime <= activity.startTime || !Object.hasOwn(PERIODS, activity.period) || !CATEGORIES.includes(activity.category) || !text(activity.place, 150) || !text(activity.shopping, 2000, true) || !text(activity.notes, 2000, true) || typeof activity.completed !== 'boolean' || !Array.isArray(activity.fields) || activity.fields.length > 20) fail();
      if (!Object.hasOwn(ACTOR_NAMES, attribution(activity.createdBy)) || !Object.hasOwn(ACTOR_NAMES, attribution(activity.updatedBy))) fail();
      ids.add(activity.id);
      const fields = activity.fields.map(field => { if (!field || !text(field.label, 60) || !text(field.value, 1000, true)) fail(); return { label: field.label.trim(), value: field.value }; });
      return { id: activity.id, startTime: activity.startTime, endTime: activity.endTime, period: activity.period, category: activity.category, place: activity.place.trim(), shopping: activity.shopping, notes: activity.notes, completed: activity.completed, fields, createdBy: attribution(activity.createdBy), updatedBy: attribution(activity.updatedBy) };
    });
  });
  return [{ ...emptyTrip(), days }];
}
function persist() {
  requireAuth();
  try { sessionStorage.setItem(keyFor(session), JSON.stringify({ version: 2, trips: [trip] })); $('#storage-status').textContent = '已暫存於本次登入；登出會清除暫存，共同手帳請儲存到雲端。'; }
  catch { $('#storage-status').textContent = '瀏覽器無法儲存。請儲存到雲端或匯出備份，避免遺失。'; }
  window.dispatchEvent(new CustomEvent('trip-planner-changed'));
}
function resetEditor() {
  editingId = null; $('#activity-form').reset(); $('#custom-fields').replaceChildren();
  $('#activity-form-title').textContent = '新增活動'; $('#activity-submit').textContent = '＋ 加入當天'; $('#activity-cancel').hidden = true;
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
  editingId = activity.id;
  for (const [id, value] of Object.entries({ start: activity.startTime, end: activity.endTime, period: activity.period, category: activity.category, place: activity.place, shopping: activity.shopping, notes: activity.notes })) $(`#activity-${id}`).value = value;
  $('#custom-fields').replaceChildren(); activity.fields.forEach(field => addField(field.label, field.value));
  $('#activity-form-title').textContent = '編輯活動'; $('#activity-submit').textContent = '儲存修改'; $('#activity-cancel').hidden = false; $('#activity-place').focus();
}
function changed() { persist(); render(); }
function render() {
  if (!authorized()) return;
  const generation = sessionGeneration;
  const allowed = () => authorized() && generation === sessionGeneration;
  $('#day-tabs').replaceChildren();
  for (let index = 0; index < 5; index++) {
    const button = node('button', 'day-tab', `10 / ${21 + index} · 第 ${index + 1} 天`); button.type = 'button'; button.setAttribute('aria-pressed', String(index === activeDay));
    button.addEventListener('click', () => { if (!allowed()) return; activeDay = index; resetEditor(); render(); $('#day-tabs').children[index].focus(); }); $('#day-tabs').append(button);
  }
  const weekdays = ['三', '四', '五', '六', '日']; $('#day-summary').textContent = `10 月 ${21 + activeDay} 日 · 星期${weekdays[activeDay]}`;
  const list = $('#activity-list'); list.replaceChildren();
  Object.entries(PERIODS).forEach(([period, title]) => {
    const section = node('section', 'period-section'); section.dataset.period = period;
    const heading = node('h3', 'period-heading', title); section.append(heading);
    const activities = node('div', 'period-list');
    const sorted = trip.days[activeDay].filter(activity => activity.period === period).sort((a,b) => a.startTime.localeCompare(b.startTime));
    if (!sorted.length) activities.append(node('p', 'empty-state', '留點空白，等我們一起填上。'));
    sorted.forEach(activity => {
      const card = node('article', `activity-card actor-${activity.createdBy}${activity.completed ? ' is-completed' : ''}`); card.dataset.activityId = activity.id;
      const timing = node('div', 'activity-time', `${activity.startTime} — ${activity.endTime}`);
      const content = node('div', 'activity-content'); content.append(node('span', 'category-badge', activity.category), node('h4', '', activity.place));
      const actorMeta = node('div', 'actor-meta'); actorMeta.append(node('span', `actor-badge actor-${activity.createdBy}`, `${ACTOR_NAMES[activity.createdBy]}建立`), node('span', `actor-badge actor-${activity.updatedBy}`, `${ACTOR_NAMES[activity.updatedBy]}更新`)); content.append(actorMeta);
      if (activity.shopping) { content.append(node('h5', '', '購物清單'), node('p', 'activity-shopping', activity.shopping)); }
      if (activity.notes) { content.append(node('h5', '', '注意事項'), node('p', 'activity-notes', activity.notes)); }
      activity.fields.forEach(field => { content.append(node('h5', '', field.label), node('p', '', field.value)); });
      const completedLabel = node('label', 'completed-toggle'); const completed = node('input'); completed.type = 'checkbox'; completed.checked = activity.completed; completed.setAttribute('aria-label', `標記完成：${activity.place}`);
      completed.addEventListener('change', () => { if (!allowed()) return; activity.completed = completed.checked; activity.updatedBy = currentActor(); changed(); }); completedLabel.append(completed, document.createTextNode('已完成')); content.append(completedLabel);
      const actions = node('div', 'activity-actions');
      const editButton = node('button', 'secondary-button', '編輯'); editButton.type = 'button'; editButton.setAttribute('aria-label', `編輯活動：${activity.place}`); editButton.addEventListener('click', () => { if (allowed()) edit(activity); });
      const remove = node('button', 'danger-button', '刪除'); remove.type = 'button'; remove.setAttribute('aria-label', `刪除活動：${activity.place}`); remove.addEventListener('click', () => { if (!allowed()) return; trip.days[activeDay] = trip.days[activeDay].filter(item => item.id !== activity.id); if (editingId === activity.id) resetEditor(); changed(); }); actions.append(editButton, remove);
      const transfer = node('div', 'activity-transfer');
      const daySelect = node('select'); daySelect.setAttribute('aria-label', `目標日期：${activity.place}`); daySelect.className = 'transfer-day';
      for(let index=0;index<5;index++) { const option = node('option', '', `10 / ${21+index}`); option.value = String(index); daySelect.append(option); } daySelect.value = String(activeDay);
      const periodSelect = node('select'); periodSelect.className = 'transfer-period'; periodSelect.setAttribute('aria-label', `目標時段：${activity.place}`); Object.entries(PERIODS).forEach(([value,label]) => { const option=node('option','',label); option.value=value; periodSelect.append(option); }); periodSelect.value=activity.period;
      for (const copying of [false,true]) {
        const button=node('button','secondary-button',copying?'複製':'移動'); button.type='button'; button.dataset.action=copying?'copy':'move'; button.setAttribute('aria-label', `${copying?'複製':'移動'}活動：${activity.place}`);
        button.addEventListener('click',()=> { if(!allowed()) return; const target=Number(daySelect.value); const targetPeriod=periodSelect.value;
          if (!Number.isInteger(target)||target<0||target>4||!Object.hasOwn(PERIODS,targetPeriod)) return;
          if (!copying&&target===activeDay&&targetPeriod===activity.period) { toast('活動已在這個日期與時段。'); return; }
          if ((copying||target!==activeDay)&&trip.days[target].length>=100) { toast('每天最多 100 個活動。'); return; }
          const next={...structuredClone(activity),id:copying?newId():activity.id,period:targetPeriod,createdBy:copying?currentActor():activity.createdBy,updatedBy:currentActor()};
          if (!copying) trip.days[activeDay]=trip.days[activeDay].filter(item=>item.id!==activity.id);
          trip.days[target].push(next); if(editingId===activity.id) resetEditor(); changed(); toast(copying?'已複製活動。':'已移動活動。');
        }); transfer.append(button);
      }
      transfer.prepend(daySelect,periodSelect); content.append(transfer); card.append(timing,content,actions); activities.append(card);
    }); section.append(activities); list.append(section);
  });
}
$('#activity-form').addEventListener('submit', event => {
  event.preventDefault(); if (!authorized()) return;
  const old = editingId ? trip.days[activeDay].find(activity => activity.id === editingId) : null;
  if (editingId && !old) { resetEditor(); toast('這個活動已不存在。'); return; }
  if (!editingId && trip.days[activeDay].length >= 100) { toast('每天最多 100 個活動。'); return; }
  const activity = { id: editingId || newId(), startTime: $('#activity-start').value, endTime: $('#activity-end').value, period: $('#activity-period').value, category: $('#activity-category').value, place: $('#activity-place').value.trim(), shopping: $('#activity-shopping').value, notes: $('#activity-notes').value, completed: old?.completed || false, createdBy: old?.createdBy || currentActor(), updatedBy: currentActor(), fields: [...$('#custom-fields').children].map(row => ({ label: row.children[0].value.trim(), value: row.children[1].value })) };
  if (!time(activity.startTime)||!time(activity.endTime)||activity.endTime<=activity.startTime) { toast('結束時間必須晚於開始時間，跨日活動請分兩天填寫。'); return; }
  const candidate = structuredClone(trip); const index = candidate.days[activeDay].findIndex(item=>item.id===editingId);
  if (editingId) candidate.days[activeDay][index]=activity; else candidate.days[activeDay].push(activity);
  try { trip = validateTrips([candidate])[0]; } catch(error) { toast(error.message); return; }
  const edited=Boolean(editingId); resetEditor(); changed(); toast(edited?'活動已更新。':'活動已加入。');
});
$('#activity-cancel').addEventListener('click', () => { if (authorized()) resetEditor(); });
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
    if(!activity||!time(activity.time)||activity.time>='23:00'||!text(activity.place,150)||!text(activity.notes,2000,true)) throw new Error('舊版活動時間或內容無法轉換，請確認備份。');
    const hour=Number(activity.time.slice(0,2)); return {id:newId(),startTime:activity.time,endTime:`${String(hour+1).padStart(2,'0')}${activity.time.slice(2)}`,period:hour<12?'morning':hour<17?'noon':'evening',category:'自訂',place:activity.place,shopping:'',notes:activity.notes,completed:false,fields:[]};
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
function lock() {
  if (session) { try { sessionStorage.removeItem(keyFor(session)); } catch {} }
  sessionGeneration++; session=null; trip=null; activeDay=0;
  window.dispatchEvent(new CustomEvent('trip-planner-locked'));
  resetEditor(); $('#day-tabs').replaceChildren(); $('#activity-list').replaceChildren(); $('#day-summary').textContent=''; $('#storage-status').textContent=''; $('#sync-status').textContent=''; $('#account-email').textContent=''; $('#account-email').className='account-email'; $('#import-file').value=''; $('#toast').textContent=''; $('#toast').classList.remove('visible'); clearTimeout(toast.timer);
  $('#private-app').hidden=true; $('#private-app').inert=true; $('#auth-screen').hidden=false;
}
async function unlock() {
  lock(); const generation=sessionGeneration;
  if (!window.TripAuth || typeof window.TripAuth.requireMembership!=='function') throw new Error('登入驗證尚未準備完成。');
  const identity=await window.TripAuth.requireMembership();
  if (generation!==sessionGeneration) throw new Error('登入狀態已變更，請重新登入。');
  const userId=identity?.userId || identity?.id;
  const email=typeof identity?.email==='string'?identity.email.toLowerCase():'';
  if (typeof userId!=='string'||!userId||identity.scope!==SCOPE||!email.endsWith('@gmail.com')||!['owen','winnie'].includes(identity.actor)) throw new Error('此 Google 帳號未獲授權使用共同空間。');
  session={userId,email,scope:SCOPE,actor:identity.actor}; trip=emptyTrip(); let restoredDraft=false;
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
  if (!Object.hasOwn(PERIODS,draft.period)) throw new Error('請確認活動時段。');
  if (!time(draft.startTime)||!time(draft.endTime)||draft.endTime<=draft.startTime) throw new Error('請確認起訖時間；結束須晚於開始，跨日請分開填寫。');
  if (trip.days[day].length>=100) throw new Error('每天最多 100 個活動。');
  let source;
  try { source = new URL(draft.sourceUrl); } catch { throw new Error('來源連結格式不正確。'); }
  if (source.protocol!=='https:'||source.username||source.password||source.href.length>1000) throw new Error('來源連結格式不正確。');
  const activity = { id:newId(), startTime:draft.startTime,endTime:draft.endTime,period:draft.period,category:draft.category,place:draft.place,shopping:draft.shopping || '',notes:draft.notes || '',completed:false,createdBy:currentActor(),updatedBy:currentActor(),fields:[{label:'匯入來源',value:source.href}] };
  const candidate=structuredClone(trip); candidate.days[day].push(activity);
  trip=validateTrips([candidate])[0]; activeDay=day; resetEditor(); changed();
}
window.TripPlanner=Object.freeze({ unlock,lock,addImportedDraft,getTrips:()=>{requireAuth();return structuredClone([trip]);},validateTrips,replaceTrips:trips=>{requireAuth();const validated=validateTrips(trips);trip=validated[0];activeDay=0;resetEditor();changed();} });
lock();
})();
