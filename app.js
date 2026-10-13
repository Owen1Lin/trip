const destinations = [
  { id: 'kyoto', name: '京都', english: 'KYOTO', country: '日本', region: '日本', image: 'photo-1493976040374-85c8e12f0c0e', description: '在古寺與巷弄之間，遇見日式生活的細緻。', tags: '文化散策 · 古都風情', season: '春季賞櫻、秋季賞楓；旺季建議提早安排住宿。', days: ['抵達京都，散步鴨川與先斗町。', '清晨拜訪清水寺，探索二年坂與三年坂。', '走訪嵐山竹林與河畔，留時間坐下喝茶。', '伏見稻荷與宇治，體驗抹茶文化。', '逛錦市場，帶著喜歡的味道回家。'] },
  { id: 'tainan', name: '台南', english: 'TAINAN', country: '台灣', region: '台灣', image: 'photo-1470004914212-05527e49370b', description: '用一場巷弄散步，嚐遍古城的溫暖日常。', tags: '在地美食 · 老屋時光', season: '秋冬天氣較適合散步；夏季注意防曬與補水。', days: ['從國華街出發，走訪赤崁樓與神農街。', '安平老街、安平樹屋，傍晚到海邊看夕陽。', '孔廟與周邊巷弄散策，挑一間老屋咖啡店。'] },
  { id: 'bali', name: '峇里島', english: 'BALI', country: '印尼', region: '東南亞', image: 'photo-1537996194471-e657df975ab4', description: '讓海風與綠意，重新找回生活的步調。', tags: '海島度假 · 自然療癒', season: '通常 5 至 9 月較乾燥；出發前確認天氣與入境規定。', days: ['抵達後在海邊休息，欣賞日落。', '前往烏布，探索稻田與在地工藝。', '選擇海灘散步或瑜珈體驗。', '安排一個自由日，依天氣彈性調整。'] },
  { id: 'hualien', name: '花蓮', english: 'HUALIEN', country: '台灣', region: '台灣', image: 'photo-1464822759023-fed622ff2c3b', description: '向山海走去，把忙碌留在城市裡。', tags: '山海風景 · 慢活旅行', season: '全年可安排；山區與步道請先確認開放狀態及天氣。', days: ['市區散步，走訪文創園區與在地店家。', '到七星潭與海岸欣賞風景，避免接近危險浪區。', '依最新開放資訊選擇步道，或安排市區文化體驗。'] },
  { id: 'paris', name: '巴黎', english: 'PARIS', country: '法國', region: '歐洲', image: 'photo-1502602898657-3e91760cbb34', description: '從街角咖啡到塞納河畔，收藏城市的浪漫。', tags: '藝術人文 · 城市漫遊', season: '春秋適合步行；熱門博物館建議提前預約。', days: ['塞納河畔散步，認識城市街區。', '預約羅浮宮，午後走訪杜樂麗花園。', '探索蒙馬特與小型藝廊。', '挑一間咖啡店，享受沒有行程的午後。'] },
  { id: 'chiangmai', name: '清邁', english: 'CHIANG MAI', country: '泰國', region: '東南亞', image: 'photo-1512553353614-82a7370096dc', description: '寺院、山林與市集，藏著北泰的自在靈魂。', tags: '文化體驗 · 市集探索', season: '11 至 2 月通常較涼爽；乾季出發前注意空氣品質。', days: ['走訪古城寺院，認識在地文化。', '參加料理課程，探索傳統市場。', '安排山林或咖啡店之旅，依空氣品質調整。'] }
];
const articles = {
  slow: { title: '少排一點行程，多留一點空白', paragraphs: ['每天選一個真正想去的地方，其他時間留給途中遇見的風景。比起把景點全部打勾，找到自己的節奏更能讓旅行留下記憶。', '把住宿安排在交通方便的街區，減少來回移動。試著用步行認識附近的麵包店、市場與公園，讓你暫時成為城市的居民。', '預留天氣、體力與心情的彈性。下雨時走進博物館，疲倦時停下喝杯茶，改變計畫也可以是旅途的一部分。'] },
  packing: { title: '輕裝出發：你的旅行打包清單', paragraphs: ['出發前確認護照效期、簽證與目的地入境規定。保存交通與住宿資訊的離線備份，記下保險及緊急聯絡方式。', '衣物以能互相搭配、適合當地氣候為原則。帶上舒適的鞋、輕便雨具、水壺及個人藥品；電子用品確認插座規格與航空公司電池規定。', '把每天需要用的物品放在容易取用的位置。出門前再檢查證件、付款工具、手機與必要藥物，其他物品依實際需求精簡。'] },
  local: { title: '跟著當地人的腳步，重新認識旅行', paragraphs: ['從早晨的市場開始，觀察當地人如何挑選食材、享用早餐。選擇清楚標價的店家，學幾句簡單的問候語，往往就能開啟一段交流。', '拜訪小型書店、工藝店與社區展覽，了解一座城市的不同面貌。拍攝人物前先詢問，尊重宗教場所、私人空間與當地習慣。', '支持在地經營的服務，選擇負責任的體驗。帶走自己的垃圾，避免干擾野生動物，讓喜歡的地方也能被下一位旅人好好看見。'] }
};
const grid = document.querySelector('#destination-grid');
const search = document.querySelector('#search');
const dialog = document.querySelector('#detail-dialog');
let region = '全部';
let query = '';
let favorites;
try { const stored = JSON.parse(localStorage.getItem('trip-favorites') || '[]'); favorites = new Set(Array.isArray(stored) ? stored.filter(id => destinations.some(d => d.id === id)) : []); } catch { favorites = new Set(); }
const imageUrl = d => `assets/${d.image}.jpg`;
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 2400); }
function render() {
  const matches = destinations.filter(d => (region === '全部' || d.region === region) && `${d.name} ${d.english} ${d.country} ${d.tags}`.toLowerCase().includes(query.toLowerCase()));
  grid.innerHTML = matches.map(d => `<article class="destination-card"><button class="save-destination" data-save="${d.id}" aria-label="${favorites.has(d.id) ? '取消收藏' : '收藏'}${d.name}" aria-pressed="${favorites.has(d.id)}">${favorites.has(d.id) ? '♥' : '♡'}</button><button class="destination-open" data-destination="${d.id}" aria-label="探索${d.name}"><div class="destination-image"><img src="${imageUrl(d)}" alt="${d.name}旅行靈感風景" loading="lazy"><span class="country-label">${d.country}</span></div><div class="destination-meta"><h3>${d.name}<span>${d.english}</span></h3><span aria-hidden="true">↗</span></div><p>${d.description}</p><span class="tags">${d.tags}</span></button></article>`).join('');
  document.querySelector('#result-count').textContent = `${matches.length} 個目的地`;
  document.querySelector('#empty-state').hidden = matches.length !== 0;
  document.querySelector('#saved-count').textContent = favorites.size;
}
function showDialog(content) { document.querySelector('#dialog-content').innerHTML = content; if (!dialog.open) dialog.showModal(); }
function showDestination(id) {
  const d = destinations.find(d => d.id === id); if (!d) return;
  showDialog(`<img class="dialog-image" src="${imageUrl(d)}" alt="${d.name}旅行靈感風景"><div class="dialog-body"><p class="eyebrow">${d.country} / ${d.english}</p><h2>${d.name}，你的下一站</h2><p>${d.description}</p><h3>推薦旅行時間</h3><p>${d.season}</p><h3>${d.days.length} 天行程靈感</h3><ol>${d.days.map(day => `<li>${day}</li>`).join('')}</ol><p>以上為自助旅行參考路線，非預訂商品。圖片為旅行氛圍示意；開放時間、交通與入境規定請以官方最新資訊為準。</p><button class="primary-button" data-apply-trip="${d.id}">套用參考行程</button> <button class="secondary-button" data-save="${d.id}">${favorites.has(d.id) ? '取消收藏' : '收藏這個目的地'}</button></div>`);
}
function showSaved() {
  const items = destinations.filter(d => favorites.has(d.id));
  showDialog(`<div class="dialog-body"><p class="eyebrow">YOUR TRAVEL WISHLIST</p><h2>我的收藏</h2>${items.length ? `<p>把心動的地方，留給下一段旅途。</p><div class="saved-list">${items.map(d => `<button class="saved-item" data-destination="${d.id}"><img src="${imageUrl(d, 200)}" alt=""><div>${d.name}<span>${d.country} · ${d.tags}</span></div></button>`).join('')}</div>` : '<p>還沒有收藏的目的地。點選目的地卡片的愛心，就能把喜歡的地方留在這裡。</p>'}<p>收藏會保存在目前瀏覽器，不會跨裝置同步。</p></div>`);
}
function toggleSave(id) {
  if (!destinations.some(d => d.id === id)) return;
  favorites.has(id) ? favorites.delete(id) : favorites.add(id);
  let persisted = true;
  try { localStorage.setItem('trip-favorites', JSON.stringify([...favorites])); } catch { persisted = false; }
  render();
  if (dialog.open) showDestination(id);
  toast(persisted ? (favorites.has(id) ? '已加入你的旅途收藏' : '已取消收藏') : '已更新收藏；瀏覽器無法儲存，重新整理後將不保留');
}
function runSearch(value) { query = value.trim(); search.value = query; region = '全部'; updateFilters(); render(); document.querySelector('#destinations').scrollIntoView({ behavior: 'smooth' }); }
function updateFilters() { document.querySelectorAll('[data-region]').forEach(b => { const active = b.dataset.region === region; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); }); }
document.querySelector('#search-form').addEventListener('submit', e => { e.preventDefault(); runSearch(search.value); });
search.addEventListener('input', () => { if (!search.value && query) runSearch(''); });
document.querySelector('#reset-search').addEventListener('click', () => runSearch(''));
document.querySelector('#show-saved').addEventListener('click', showSaved);
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } });
document.addEventListener('click', e => {
  const button = e.target.closest('button'); if (!button) return;
  if (button.dataset.save) toggleSave(button.dataset.save);
  else if (button.dataset.destination) showDestination(button.dataset.destination);
  else if (button.dataset.journey) showDestination(button.dataset.journey);
  else if (button.dataset.search) runSearch(button.dataset.search);
  else if (button.dataset.region) { region = button.dataset.region; updateFilters(); render(); }
  else if (button.dataset.article) { const article = articles[button.dataset.article]; showDialog(`<div class="dialog-body"><p class="eyebrow">TRIP JOURNAL</p><h2>${article.title}</h2>${article.paragraphs.map(p => `<p>${p}</p>`).join('')}</div>`); }
});
document.querySelector('#year').textContent = new Date().getFullYear();
render();

// The planner uses a versioned, validated local-only document. User text is
// always rendered through textContent, never interpolated into HTML.
const PLANNER_KEY = 'trip-planner-v1';
const MAX_TRIPS = 30;
let planner = { version: 1, trips: [], activeTripId: null };
let activeDay = 0;
let editingActivityId = null;
const $ = selector => document.querySelector(selector);
const newId = () => crypto.randomUUID();
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2100-12-31') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validText(value, max, optional = false) {
  return typeof value === 'string' && value.length <= max && (optional || value.trim().length > 0);
}
function validatePlanner(value) {
  const fail = () => { throw new Error('備份格式不正確，請選擇由旅途匯出的 JSON 檔案。'); };
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
  if (!value || value.version !== 1 || !Array.isArray(value.trips) || value.trips.length > MAX_TRIPS) fail();
  const ids = new Set();
  const trips = value.trips.map(trip => {
    if (!trip || !validId(trip.id) || ids.has(trip.id) || !validText(trip.name, 80) || !validText(trip.destination, 100) || !validDate(trip.startDate) || !Number.isInteger(trip.dayCount) || trip.dayCount < 1 || trip.dayCount > 30 || !Array.isArray(trip.days) || trip.days.length !== trip.dayCount) fail();
    ids.add(trip.id);
    const activityIds = new Set();
    const days = trip.days.map(day => {
      if (!Array.isArray(day) || day.length > 100) fail();
      return day.map(activity => {
        if (!activity || !validId(activity.id) || activityIds.has(activity.id) || typeof activity.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(activity.time) || !validText(activity.place, 150) || !validText(activity.notes, 1000, true)) fail();
        activityIds.add(activity.id);
        return { id: activity.id, time: activity.time, place: activity.place.trim(), notes: activity.notes };
      });
    });
    return { id: trip.id, name: trip.name.trim(), destination: trip.destination.trim(), startDate: trip.startDate, dayCount: trip.dayCount, days };
  });
  if (value.activeTripId !== null && !ids.has(value.activeTripId)) fail();
  return { version: 1, trips, activeTripId: value.activeTripId };
}
function storageMessage(message) { $('#storage-status').textContent = message; }
function resetActivityEditor() {
  editingActivityId = null; $('#activity-form').reset();
  $('#activity-form-title').textContent = '新增當日活動';
  $('#activity-submit').textContent = '＋ 加入這一天';
  $('#activity-cancel').hidden = true;
}
function persistPlanner() {
  try {
    localStorage.setItem(PLANNER_KEY, JSON.stringify(planner));
    storageMessage('已儲存在目前瀏覽器。可匯出備份；不會跨裝置同步。');
  } catch {
    storageMessage('瀏覽器無法儲存：目前變更只在這個頁面，請匯出備份避免遺失。');
    toast('無法寫入瀏覽器儲存空間，請匯出備份');
  }
  window.dispatchEvent(new CustomEvent('trip-planner-changed'));
}
try {
  const raw = localStorage.getItem(PLANNER_KEY);
  if (raw) planner = validatePlanner(JSON.parse(raw));
} catch {
  storageMessage('瀏覽器資料無法讀取或格式不正確。原有資料尚未覆寫；新行程請先匯出備份。');
}
function activeTrip() { return planner.trips.find(trip => trip.id === planner.activeTripId); }
function dayDate(trip, index) {
  const date = new Date(`${trip.startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(date);
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function renderPlanner() {
  const trip = activeTrip();
  const list = $('#trip-list'); list.replaceChildren();
  if (!planner.trips.length) list.append(node('p', 'planner-hint', '還沒有行程，建立你的第一趟旅行。'));
  planner.trips.forEach(item => {
    const button = node('button', 'trip-item'); button.type = 'button';
    button.setAttribute('aria-current', String(item.id === planner.activeTripId));
    button.append(node('strong', '', item.name), node('span', '', `${item.destination} · ${item.dayCount} 天`));
    button.addEventListener('click', () => { planner.activeTripId = item.id; activeDay = 0; resetActivityEditor(); persistPlanner(); renderPlanner(); });
    list.append(button);
  });
  $('#planner-empty').hidden = Boolean(trip);
  $('#planner-active-content').hidden = !trip;
  $('#export-trips').disabled = !planner.trips.length;
  if (!trip) return;
  activeDay = Math.min(activeDay, trip.dayCount - 1);
  $('#active-trip-name').textContent = trip.name;
  $('#active-trip-destination').textContent = trip.destination;
  $('#active-trip-dates').textContent = `${trip.startDate} 出發 · ${trip.dayCount} 天 · ${trip.days.reduce((sum, day) => sum + day.length, 0)} 個活動`;
  const tabs = $('#day-tabs'); tabs.replaceChildren();
  trip.days.forEach((_, index) => {
    const button = node('button', 'day-tab', `第 ${index + 1} 天`); button.type = 'button';
    button.setAttribute('aria-pressed', String(index === activeDay));
    button.addEventListener('click', () => { activeDay = index; resetActivityEditor(); renderPlanner(); $('#day-tabs').children[index].focus(); });
    tabs.append(button);
  });
  $('#day-summary').textContent = `第 ${activeDay + 1} 天 · ${dayDate(trip, activeDay)}`;
  const activities = $('#activity-list'); activities.replaceChildren();
  const sorted = [...trip.days[activeDay]].sort((a, b) => a.time.localeCompare(b.time));
  if (!sorted.length) activities.append(node('p', 'planner-empty', '這一天還是空白。加上第一個想去的地方吧。'));
  sorted.forEach(activity => {
    const card = node('article', 'activity-card');
    const time = node('time', 'activity-time', activity.time); time.dateTime = activity.time;
    const content = node('div', 'activity-content'); content.append(node('h4', '', activity.place));
    if (activity.notes) content.append(node('p', '', activity.notes));
    const actions = node('div', 'activity-actions');
    const edit = node('button', 'secondary-button', '編輯'); edit.type = 'button'; edit.setAttribute('aria-label', `編輯活動：${activity.place}`);
    edit.addEventListener('click', () => {
      editingActivityId = activity.id; $('#activity-time').value = activity.time; $('#activity-place').value = activity.place; $('#activity-notes').value = activity.notes;
      $('#activity-form-title').textContent = '編輯當日活動'; $('#activity-submit').textContent = '儲存修改'; $('#activity-cancel').hidden = false; $('#activity-time').focus();
    });
    const remove = node('button', 'danger-button', '刪除'); remove.type = 'button'; remove.setAttribute('aria-label', `刪除活動：${activity.place}`);
    remove.addEventListener('click', () => { trip.days[activeDay] = trip.days[activeDay].filter(item => item.id !== activity.id); if (editingActivityId === activity.id) resetActivityEditor(); persistPlanner(); renderPlanner(); toast('已刪除活動'); });
    actions.append(edit, remove); card.append(time, content, actions); activities.append(card);
  });
}
function createTrip({ name, destination, startDate, dayCount, days }) {
  if (planner.trips.length >= MAX_TRIPS) { toast('最多可保存 30 個行程，請先匯出並刪除不需要的行程'); return false; }
  const trip = { id: newId(), name: name.trim(), destination: destination.trim(), startDate, dayCount, days: days || Array.from({ length: dayCount }, () => []) };
  try { validatePlanner({ version: 1, trips: [trip], activeTripId: trip.id }); } catch (error) { toast(error.message); return false; }
  planner.trips.push(trip); planner.activeTripId = trip.id; activeDay = 0;
  resetActivityEditor(); persistPlanner(); renderPlanner(); return true;
}
const today = new Date();
const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
$('#trip-start').value = localToday;
$('#trip-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#trip-name').value.trim(); const destination = $('#trip-destination').value.trim();
  if (!name || !destination) { toast('請輸入旅行名稱與目的地'); return; }
  if (createTrip({ name, destination, startDate: $('#trip-start').value, dayCount: Number($('#trip-days').value) })) {
    $('#trip-name').value = ''; $('#trip-destination').value = ''; toast('新行程已建立');
  }
});
$('#activity-form').addEventListener('submit', event => {
  event.preventDefault(); const trip = activeTrip(); if (!trip) return;
  const place = $('#activity-place').value.trim(); const time = $('#activity-time').value;
  if (!place || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { toast('請輸入有效的時間與活動名稱'); return; }
  if (!editingActivityId && trip.days[activeDay].length >= 100) { toast('每天最多安排 100 個活動'); return; }
  const editing = editingActivityId;
  const activity = { id: editing || newId(), time, place, notes: $('#activity-notes').value };
  if (editing) {
    const index = trip.days[activeDay].findIndex(item => item.id === editing);
    if (index < 0) { resetActivityEditor(); toast('活動已不存在，請重新新增'); return; }
    trip.days[activeDay][index] = activity;
  } else trip.days[activeDay].push(activity);
  resetActivityEditor(); persistPlanner(); renderPlanner(); $('#activity-time').focus(); toast(editing ? '活動已更新' : '已加入當日行程');
});
$('#activity-cancel').addEventListener('click', resetActivityEditor);
$('#delete-trip').addEventListener('click', () => {
  const trip = activeTrip(); if (!trip || !confirm(`刪除「${trip.name}」及所有活動？此操作無法復原，建議先匯出備份。`)) return;
  planner.trips = planner.trips.filter(item => item.id !== trip.id);
  planner.activeTripId = planner.trips[0]?.id || null; activeDay = 0; resetActivityEditor(); persistPlanner(); renderPlanner(); toast('已刪除行程');
});
$('#export-trips').addEventListener('click', () => {
  const data = new Blob([JSON.stringify(planner, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(data); const link = node('a');
  link.href = url; link.download = `trip-backup-${localToday}.json`; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast('已匯出行程備份');
});
$('#import-trips').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('備份檔案過大，請選擇小於 5 MB 的 JSON。');
    const imported = validatePlanner(JSON.parse(await file.text()));
    if (!imported.trips.length) throw new Error('這份備份沒有行程。');
    if (planner.trips.length + imported.trips.length > MAX_TRIPS) throw new Error('匯入後會超過 30 個行程，請先備份並刪除部分行程。');
    const trips = imported.trips.map(trip => ({ ...trip, id: newId(), days: trip.days.map(day => day.map(activity => ({ ...activity, id: newId() }))) }));
    planner.trips.push(...trips); planner.activeTripId = trips[0].id; activeDay = 0; resetActivityEditor(); persistPlanner(); renderPlanner(); toast(`已新增 ${trips.length} 個匯入行程`);
  } catch (error) { toast(error instanceof SyntaxError ? '無法解析 JSON，原有行程未變更。' : error.message); }
  finally { event.target.value = ''; }
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-apply-trip]'); if (!button) return;
  const destination = destinations.find(item => item.id === button.dataset.applyTrip); if (!destination) return;
  const days = destination.days.map(place => [{ id: newId(), time: '09:00', place, notes: '參考路線，請依實際交通、天氣與開放時間調整。' }]);
  if (createTrip({ name: `${destination.name}慢旅`, destination: destination.name, startDate: localToday, dayCount: days.length, days })) {
    dialog.close(); $('#planner').scrollIntoView({ behavior: 'smooth' }); toast('已建立參考行程，可繼續加入活動');
  }
});
renderPlanner();

window.TripPlanner = Object.freeze({
  getTrips: () => structuredClone(planner.trips),
  validateTrips: trips => validatePlanner({ version: 1, trips, activeTripId: trips?.[0]?.id || null }).trips,
  replaceTrips: trips => {
    const next = validatePlanner({ version: 1, trips, activeTripId: trips?.[0]?.id || null });
    planner = next; activeDay = 0; resetActivityEditor(); persistPlanner(); renderPlanner();
  }
});
