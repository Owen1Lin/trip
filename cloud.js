/* Optional Supabase sync. All untrusted content is rendered with textContent. */
(() => {
  const panel = document.querySelector('#cloud-panel');
  if (!panel) return;
  const config = window.TRIP_CLOUD_CONFIG || {};
  const sessionKey = 'trip-cloud-session-v1';
  let session = null;
  let busy = false;
  let status;
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function validConfig() {
    try {
      const u = new URL(config.url);
      let publicKey = typeof config.publishableKey === 'string' && config.publishableKey.startsWith('sb_publishable_');
      if (typeof config.publishableKey === 'string' && config.publishableKey.startsWith('eyJ')) {
        const part = config.publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
        publicKey = payload.role === 'anon';
      }
      return u.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(u.hostname) && u.pathname === '/' &&
        !u.username && !u.password && !u.search && !u.hash && publicKey;
    } catch { return false; }
  }
  function message(text) { if (status) status.textContent = text; }
  function remember(value) {
    session = value;
    try { value ? localStorage.setItem(sessionKey, JSON.stringify(value)) : localStorage.removeItem(sessionKey); }
    catch { message('瀏覽器無法保存登入狀態，關閉頁面後請重新登入。'); }
  }
  async function request(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(config.url.replace(/\/$/, '') + path, {
        method, signal: controller.signal,
        headers: { apikey: config.publishableKey, 'Content-Type': 'application/json',
          ...(auth && session ? { Authorization: `Bearer ${session.access_token}` } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { throw new Error('雲端回應格式不正確。'); }
      if (!response.ok) {
        if (response.status === 401) throw new Error('登入已失效，請重新登入。');
        if (response.status === 429) throw new Error('請求過於頻繁，請稍後再試。');
        throw new Error(`雲端操作失敗（${response.status}）。請確認專案、Email 設定及資料表 RLS。`);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('連線逾時，請檢查網路後重試。');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function normalizeSession(data) {
    if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || !data.user?.id) throw new Error('登入資訊不完整，請重新登入。');
    return { access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: Number(data.expires_at) || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
      user: { id: data.user.id, email: data.user.email || '' } };
  }
  async function ensureSession() {
    if (!session) throw new Error('請先登入。');
    if (session.expires_at < Date.now() / 1000 + 60) {
      remember(normalizeSession(await request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: session.refresh_token }, auth: false
      })));
    }
    const user = await request('/auth/v1/user');
    if (user.id !== session.user.id) { remember(null); throw new Error('登入資訊不一致，請重新登入。'); }
  }
  async function perform(task) {
    if (busy) return;
    busy = true;
    panel.querySelectorAll('button').forEach(b => b.disabled = true);
    message('處理中…');
    try { await task(); }
    catch (error) { message(error instanceof TypeError ? '無法連線至雲端，請確認網路與專案設定。' : error.message); }
    finally { busy = false; panel.querySelectorAll('button').forEach(b => b.disabled = false); }
  }
  function button(text, action, primary = false) {
    const node = el('button', text, primary ? 'primary-button' : 'secondary-button');
    node.type = 'button'; node.addEventListener('click', () => perform(action)); return node;
  }
  async function remoteSnapshot() {
    await ensureSession();
    const rows = await request(`/rest/v1/trip_snapshots?user_id=eq.${encodeURIComponent(session.user.id)}&select=trips,updated_at`);
    if (!Array.isArray(rows)) throw new Error('行程資料格式不正確。');
    return rows[0] || null;
  }
  function render() {
    panel.replaceChildren();
    const card = el('div', '', 'cloud-card');
    card.append(el('h3', '讓旅程，跟著你走'), el('p', '登入同一個帳號，在不同裝置手動上傳或下載行程。收藏僅存於本機。', 'cloud-note'));
    status = el('p', '', 'cloud-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    if (!validConfig()) {
      card.append(el('p', '目前使用本機儲存。雲端同步尚未啟用：需先建立 Supabase 專案、套用資料表與權限，再填入 cloud-config.js 的公開設定。', 'storage-note'));
      const docs = el('a', '查看上線與雲端設定說明 ↗', 'text-link');
      docs.href = 'https://github.com/Owen1Lin/trip/blob/main/DEPLOYMENT.md';
      docs.target = '_blank'; docs.rel = 'noopener noreferrer'; card.append(docs);
    } else if (!session) {
      const form = el('form', '', 'cloud-form');
      const label = el('label', 'Email'); label.htmlFor = 'cloud-email';
      const email = el('input'); email.id = 'cloud-email'; email.type = 'email'; email.required = true;
      email.maxLength = 254; email.autocomplete = 'email'; email.placeholder = 'you@example.com';
      const send = el('button', '寄送登入連結', 'primary-button'); send.type = 'submit';
      form.append(label, email, send);
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        perform(async () => {
          const redirect = new URL(location.href); redirect.hash = ''; redirect.search = '';
          await request(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirect.href)}`, { method: 'POST', auth: false,
            body: { email: email.value.trim(), create_user: true } });
          message('登入信已寄出，請在同一瀏覽器開啟連結。若有六位驗證碼，也可在下方輸入。');
        });
      });
      const verifyForm = el('form', '', 'cloud-form');
      const tokenLabel = el('label', 'Email 驗證碼（若信中提供）'); tokenLabel.htmlFor = 'cloud-code';
      const token = el('input'); token.id = 'cloud-code'; token.inputMode = 'numeric'; token.pattern = '[0-9]{6,8}';
      token.maxLength = 8; token.required = true; token.autocomplete = 'one-time-code';
      const verify = el('button', '驗證登入', 'secondary-button'); verify.type = 'submit';
      verifyForm.append(tokenLabel, token, verify);
      verifyForm.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity() || !verifyForm.reportValidity()) return;
        perform(async () => {
          remember(normalizeSession(await request('/auth/v1/verify', { method: 'POST', auth: false,
            body: { email: email.value.trim(), token: token.value.trim(), type: 'email' } })));
          render(); message('已登入，可以上傳或下載行程。');
        });
      });
      card.append(form, verifyForm);
    } else {
      card.append(el('p', `已登入：${session.user.email}`, 'cloud-note'));
      const actions = el('div', '', 'cloud-actions');
      actions.append(button('上傳行程', async () => {
        const trips = window.TripPlanner?.getTrips();
        if (!Array.isArray(trips)) throw new Error('行程工具尚未就緒。');
        const previous = await remoteSnapshot();
        if (previous && !confirm('上傳會以目前裝置的行程取代帳號雲端快照。確認已備份其他裝置的行程後再繼續？')) { message('已取消上傳。'); return; }
        if (previous) {
          const rows = await request(`/rest/v1/trip_snapshots?user_id=eq.${encodeURIComponent(session.user.id)}&updated_at=eq.${encodeURIComponent(previous.updated_at)}`, {
            method: 'PATCH', body: { trips }, headers: { Prefer: 'return=representation' }
          });
          if (!Array.isArray(rows) || rows.length !== 1) throw new Error('其他裝置已更新行程。請先下載最新資料，確認後再上傳。');
        } else {
          await request('/rest/v1/trip_snapshots', { method: 'POST', body: { user_id: session.user.id, trips } });
        }
        message('行程已上傳。其他裝置登入後，按「下載行程」取得這份快照。');
      }, true), button('下載行程', async () => {
        const remote = await remoteSnapshot();
        if (!remote) { message('雲端還沒有行程，請先從另一裝置上傳。'); return; }
        if (!window.TripPlanner) throw new Error('行程工具尚未就緒。');
        window.TripPlanner.validateTrips(remote.trips);
        if (!confirm('下載將取代目前瀏覽器的所有行程。請先使用 JSON 匯出備份。確定下載？')) { message('已取消下載。'); return; }
        window.TripPlanner.replaceTrips(remote.trips);
        message('已下載雲端行程，請到行程工作區查看。');
      }), button('登出', async () => {
        try { await request('/auth/v1/logout', { method: 'POST' }); }
        finally { remember(null); render(); message('已登出；目前瀏覽器的本機行程仍保留。'); }
      }));
      card.append(actions, el('p', '行程採手動快照同步，不會自動合併。上傳或下載前建議先匯出備份。', 'cloud-note'));
    }
    card.append(status); panel.append(card);
  }
  async function init() {
    if (validConfig()) {
      try {
        const stored = JSON.parse(localStorage.getItem(sessionKey) || 'null');
        if (stored) session = normalizeSession(stored);
      } catch { session = null; }
      const hash = new URLSearchParams(location.hash.slice(1));
      if (hash.has('access_token') || hash.has('error')) {
        history.replaceState(null, '', location.pathname + location.search + '#cloud-sync');
        if (hash.has('access_token')) {
          try {
            session = { access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'), expires_at: Date.now()/1000 + Number(hash.get('expires_in') || 3600) };
            const user = await request('/auth/v1/user');
            remember(normalizeSession({ ...session, user }));
          } catch { remember(null); render(); message('登入連結無效或已過期，請重新寄送。'); return; }
        } else { render(); message('登入連結未完成驗證，請重新寄送。'); return; }
      }
    }
    render();
  }
  init();
})();
