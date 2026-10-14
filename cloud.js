/* Google login and a private, shared Supabase travel document. */
(() => {
  const config = window.TRIP_CLOUD_CONFIG || {};
  const scope = 'owen-winnie-20261021';
  const sessionKey = 'trip-google-session-v2';
  const revisionKey = identity => `trip-shared-base-v2-${scope}-${identity.id}`;
  const screen = document.querySelector('#auth-screen');
  const panel = document.querySelector('#auth-panel');
  const app = document.querySelector('#private-app');
  if (!screen || !panel || !app) return;
  let session = null, member = null, revision = null, busy = false, generation = 0, refreshInFlight = null;
  let authStatus;
  const rejected = text => Object.assign(new Error(text), { denied: true });
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function validConfig() {
    try {
      const url = new URL(config.url);
      let publicKey = typeof config.publishableKey === 'string' && config.publishableKey.startsWith('sb_publishable_');
      if (config.publishableKey?.startsWith('eyJ')) {
        const part = config.publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        publicKey = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '='))).role === 'anon';
      }
      return url.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
        && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password && publicKey;
    } catch { return false; }
  }
  function message(text, internal = false) {
    const target = internal ? document.querySelector('#sync-status') : authStatus;
    if (target) target.textContent = text;
  }
  function remember(value) {
    session = value;
    try { value ? sessionStorage.setItem(sessionKey, JSON.stringify(value)) : sessionStorage.removeItem(sessionKey); }
    catch { /* Current tab remains usable; a new visit needs login. */ }
  }
  function setRevision(value) {
    revision = value;
    if (!member) return;
    try { value ? sessionStorage.setItem(revisionKey(member), value) : sessionStorage.removeItem(revisionKey(member)); }
    catch { /* A missing baseline will safely prevent overwriting an existing snapshot. */ }
  }
  function validSession(data) {
    if (!data || typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string'
      || !data.refresh_token || !Number.isFinite(Number(data.expires_at))) throw rejected('登入資訊不完整，請重新登入。');
    return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Number(data.expires_at) };
  }
  async function request(path, { method = 'GET', body, auth = true, headers = {}, timeoutMs = 20000 } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(config.url.replace(/\/$/, '') + path, {
        method, signal: controller.signal,
        headers: { apikey: config.publishableKey, 'Content-Type': 'application/json',
          ...(auth && session ? { Authorization: `Bearer ${session.access_token}` } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { throw new Error('服務回應格式異常，請稍後再試。'); }
      if (!response.ok) {
        if (response.status === 401) throw rejected('登入已失效，請重新使用 Google 登入。');
        if (response.status === 403) throw rejected('這個帳號尚未獲准使用專屬空間。');
        if (response.status === 404) throw new Error('專屬空間尚未完成設定，請通知歐文。');
        if (response.status === 409) throw new Error('共同行程已更新，請先載入最新內容，再合併修改。');
        if (response.status === 429) throw new Error('請稍等一下，再重試這個操作。');
        throw new Error(`暫時無法完成操作（${response.status}），請稍後再試。`);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('連線逾時，請檢查網路後重試。');
      if (error instanceof TypeError) throw new Error('目前無法連線，請檢查網路後重試。');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function refreshSession() {
    if (!session) throw rejected('請先使用 Google 登入。');
    if (session.expires_at > Date.now() / 1000 + 60) return;
    if (!refreshInFlight) {
      const attempt = generation, token = session.refresh_token;
      refreshInFlight = request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: token }, auth: false
      }).then(data => {
        if (attempt !== generation) throw rejected('已登出，請重新登入。');
        remember(validSession({ ...data, expires_at: Date.now() / 1000 + Number(data.expires_in || 3600) }));
      }).finally(() => { refreshInFlight = null; });
    }
    await refreshInFlight;
  }
  async function requireMembership() {
    if (!session || !validConfig()) throw rejected('請先使用 Google 登入。');
    const attempt = generation;
    try {
      await refreshSession();
      const user = await request('/auth/v1/user');
      const email = user?.email?.toLowerCase();
      let claims;
      try {
        const part = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
      } catch { throw rejected('登入資訊不完整，請重新使用 Google 登入。'); }
      const oauth = Array.isArray(claims.amr) && claims.amr.some(entry => entry.method === 'oauth');
      if (!user?.id || !/^[^@\s]+@gmail\.com$/.test(email || '') || !oauth || claims.sub !== user.id
        || !user.email_confirmed_at || !Array.isArray(user.identities)
        || !user.identities.some(i => i.provider === 'google' && i.identity_data?.email?.toLowerCase() === email)) {
        throw rejected('請使用獲邀請的 Gmail 帳號，透過 Google 登入。');
      }
      const members = await request('/rest/v1/private_trip_members?select=email,display_name,actor');
      if (!Array.isArray(members) || members.length !== 1 || members[0].email !== email
        || !['owen', 'winnie'].includes(members[0].actor)) throw rejected('這個 Gmail 尚未獲准使用專屬空間。');
      if (attempt !== generation) throw rejected('已登出，請重新登入。');
      member = { id: user.id, email, scope, actor: members[0].actor, displayName: members[0].display_name };
      return { ...member };
    } catch (error) {
      if (error.denied && attempt === generation) lock(error.message);
      throw error;
    }
  }
  async function importPublicLink({ url, model }) {
    const attempt = generation;
    await requireMembership();
    if (attempt !== generation) throw rejected('登入狀態已變更，請重新登入。');
    const result = await request('/functions/v1/link-import', { method: 'POST', body: { url, model }, timeoutMs: 50000 });
    if (attempt !== generation) throw rejected('登入狀態已變更，請重新登入。');
    return result;
  }
  window.TripAuth = Object.freeze({ requireMembership, importPublicLink });
  function renderLogin(text = '') {
    panel.replaceChildren();
    const button = element('button', '使用 Google 帳號登入', 'google-sign-in');
    button.type = 'button'; button.id = 'google-sign-in'; button.disabled = !validConfig();
    button.addEventListener('click', async () => {
      if (!validConfig()) { message('登入服務尚未完成設定，請通知歐文。'); return; }
      button.disabled = true; message('正在前往 Google 登入…');
      try {
        const settings = await request('/auth/v1/settings', { auth: false });
        if (!settings?.external?.google) throw new Error('Google 登入服務尚未啟用，請通知歐文。');
        const redirect = new URL(location.href); redirect.hash = ''; redirect.search = '';
        const url = new URL(config.url.replace(/\/$/, '') + '/auth/v1/authorize');
        url.searchParams.set('provider', 'google'); url.searchParams.set('redirect_to', redirect.href);
        url.searchParams.set('prompt', 'select_account');
        location.assign(url.href);
      } catch (error) { message(error.message); button.disabled = false; }
    });
    authStatus = element('p', text || (!validConfig() ? '登入服務尚未設定，請通知歐文。' : ''), 'auth-status');
    authStatus.setAttribute('role', 'status'); authStatus.setAttribute('aria-live', 'polite');
    panel.append(button, authStatus);
  }
  function lock(text = '') {
    generation++; app.hidden = true; app.inert = true; screen.hidden = false;
    window.TripPlanner?.lock();
    if (member) { try { sessionStorage.removeItem(revisionKey(member)); } catch { /* Storage can be disabled. */ } }
    remember(null); member = null; revision = null;
    const email = document.querySelector('#account-email');
    if (email) { email.textContent = ''; email.classList.remove('actor-owen', 'actor-winnie'); }
    renderLogin(text);
  }
  async function sharedSnapshot() {
    await requireMembership();
    const rows = await request(`/rest/v1/shared_trip_snapshots?scope=eq.${scope}&select=trips,updated_at,updated_by`);
    if (!Array.isArray(rows) || rows.length > 1) throw new Error('共享行程格式異常，請通知歐文。');
    return rows[0] || null;
  }
  async function openPrivateSpace() {
    const attempt = generation;
    await requireMembership(); const restored = await window.TripPlanner.unlock();
    try { revision = sessionStorage.getItem(revisionKey(member)); } catch { revision = null; }
    const snapshot = await sharedSnapshot();
    if (attempt !== generation || !session) throw rejected('已登出，請重新登入。');
    let keptDraft = false;
    if (snapshot) {
      const validated = window.TripPlanner.validateTrips(snapshot.trips);
      const local = window.TripPlanner.getTrips();
      keptDraft = Boolean(restored?.restoredDraft) && JSON.stringify(local) !== JSON.stringify(validated);
      if (!keptDraft) {
        window.TripPlanner.replaceTrips(snapshot.trips);
        setRevision(snapshot.updated_at);
      }
    }
    const email = document.querySelector('#account-email');
    email.textContent = `${member.displayName} · ${member.email}`;
    email.classList.remove('actor-owen', 'actor-winnie'); email.classList.add(`actor-${member.actor}`);
    screen.hidden = true; app.hidden = false; app.inert = false;
    message(keptDraft ? '已保留這個頁面的未同步草稿。若另一位有新修改，請先匯出備份，再載入共同手帳。'
      : snapshot ? '已載入我們的共同行程。修改後請儲存到雲端。' : '先安排想去的地方，再儲存到我們的共同行程。', true);
  }
  async function perform(task) {
    if (busy || !session || app.hidden) return;
    busy = true;
    document.querySelectorAll('#cloud-save, #cloud-load').forEach(b => b.disabled = true);
    const attempt = generation;
    try { await task(attempt); }
    catch (error) {
      if (error.denied && attempt === generation) lock(error.message);
      else if (attempt === generation) message(error.message, true);
    } finally {
      busy = false; document.querySelectorAll('#cloud-save, #cloud-load').forEach(b => b.disabled = false);
    }
  }
  document.querySelector('#cloud-save').addEventListener('click', () => perform(async attempt => {
    message('正在儲存我們的行程…', true); await requireMembership();
    const trips = window.TripPlanner.getTrips(); window.TripPlanner.validateTrips(trips);
    const rows = revision
      ? await request(`/rest/v1/shared_trip_snapshots?scope=eq.${scope}&updated_at=eq.${encodeURIComponent(revision)}`, {
        method: 'PATCH', body: { trips }, headers: { Prefer: 'return=representation' }
      })
      : await request('/rest/v1/shared_trip_snapshots', {
        method: 'POST', body: { scope, trips }, headers: { Prefer: 'return=representation' }
      });
    if (attempt !== generation || !session) return;
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('另一位已更新行程。請先匯出備份，再載入共同手帳，合併修改後重新儲存。');
    setRevision(rows[0].updated_at);
    message('共同行程已儲存。另一位載入共同手帳即可看到修改。', true);
  }));
  document.querySelector('#cloud-load').addEventListener('click', () => perform(async attempt => {
    if (!confirm('載入共同手帳會取代此頁面尚未儲存的修改。建議先匯出備份，確定繼續？')) return;
    const snapshot = await sharedSnapshot(); if (attempt !== generation || !session) return;
    if (!snapshot) throw new Error('還沒有共享行程，請先儲存一次。');
    window.TripPlanner.validateTrips(snapshot.trips); window.TripPlanner.replaceTrips(snapshot.trips);
    setRevision(snapshot.updated_at); message('已載入最新的共同行程。', true);
  }));
  document.querySelector('#sign-out').addEventListener('click', async () => {
    if (!session || !confirm('確定登出？尚未儲存到雲端的修改將清除，請先儲存或匯出備份。')) return;
    const token = session.access_token; lock('已登出。再次使用時，請以 Google 登入。');
    try { await request('/auth/v1/logout?scope=local', { method: 'POST', auth: false, headers: { Authorization: `Bearer ${token}` } }); }
    catch { /* Local logout is immediate, including when the network is unavailable. */ }
  });
  window.addEventListener('trip-planner-changed', () => {
    if (member && session && !app.hidden && !busy) message('有尚未同步的修改，完成後請儲存到雲端。', true);
  });
  async function init() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const callback = hash.has('access_token') || hash.has('error') || hash.has('error_description');
    if (callback) history.replaceState(null, '', location.pathname + location.search);
    renderLogin('正在確認登入狀態…'); app.hidden = true; app.inert = true;
    try {
      if (callback && hash.has('access_token')) {
        remember(validSession({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'),
          expires_at: Date.now() / 1000 + Number(hash.get('expires_in') || 3600) }));
      } else if (callback) { lock('Google 登入未完成，請再試一次。'); return; }
      else { try { const raw = sessionStorage.getItem(sessionKey); if (raw) session = validSession(JSON.parse(raw)); } catch { session = null; } }
      if (!session) { lock(); return; }
      await openPrivateSpace();
    } catch (error) { lock(error.message); }
  }
  init();
})();
