/* Google login and a private, shared Supabase travel document. */
(() => {
  const config = window.TRIP_CLOUD_CONFIG || {};
  const scope = 'owen-winnie-20261021';
  const legacySessionKey = 'trip-google-session-v2';
  const projectHost = (()=>{try{return new URL(config.url).hostname;}catch{return 'unconfigured';}})();
  const sessionKey = `trip-google-session-v3-${projectHost}-${scope}`;
  const revisionKey = identity => `trip-shared-base-v2-${scope}-${identity.id}`;
  const screen = document.querySelector('#auth-screen');
  const panel = document.querySelector('#auth-panel');
  const app = document.querySelector('#private-app');
  if (!screen || !panel || !app) return;
  const restoring = document.querySelector('#auth-restoring');
  let session = null, member = null, revision = null, busy = false, generation = 0, refreshInFlight = null;
  let authStatus, storageNotice = '', persistentSession = false;
  let membershipFlight = null, verifiedContext = null, initialLoading = false;
  let dirty = false, changeVersion = 0, reminderState = 'idle', reminderError = '', successTimer = null;
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
    if (internal) publishSyncState();
  }
  function syncState() {
    const text = app.hidden ? '' : document.querySelector('#sync-status')?.textContent || '';
    const status = app.hidden ? 'idle' : reminderState === 'saving' ? 'saving'
      : reminderState === 'error' ? 'error' : dirty ? 'dirty'
      : reminderState === 'saved' || text.includes('共同行程已儲存') ? 'saved'
      : text.includes('已載入') ? 'loaded' : 'idle';
    return { dirty, busy: busy || initialLoading, status, message: text };
  }
  function publishSyncState() {
    window.dispatchEvent(new CustomEvent('trip-sync-state', { detail: syncState() }));
  }
  window.TripSync = Object.freeze({ getState: syncState });
  function renderSaveReminder() {
    const reminder = document.querySelector('#save-reminder');
    const status = document.querySelector('#save-reminder-status');
    const state = reminderState === 'saving' ? 'saving' : dirty ? (reminderState === 'error' ? 'error' : 'dirty') : reminderState;
    if (reminder) {
      reminder.hidden = app.hidden || !['dirty','saving','saved','error'].includes(state);
      reminder.dataset.state = state;
    }
    if (status) status.textContent = app.hidden ? '' : state === 'saving' ? '正在儲存…'
      : state === 'error' ? `${reminderError} 尚未儲存的修改仍保留。`
      : state === 'dirty' ? '有未同步的修改，記得儲存。'
      : state === 'saved' ? (document.querySelector('#activity-text')?.value.trim()
        ? '儲存成功；輸入文字請先新增才會保存。' : '儲存成功') : '';
    document.querySelectorAll('#cloud-save, #save-now, #cloud-load').forEach(button => { button.disabled = busy || initialLoading || app.hidden; });
    publishSyncState();
  }
  function clearSuccessNotice() { clearTimeout(successTimer); successTimer = null; }
  function showRestoring() {
    app.hidden = true; app.inert = true;
    screen.hidden = Boolean(restoring);
    if (restoring) restoring.hidden = false;
  }
  function showStorageNotice() {
    let notice=document.querySelector('#auth-storage-notice');
    if(!storageNotice){notice?.remove();return;}
    if(!notice){notice=element('p','','save-status');notice.id='auth-storage-notice';notice.setAttribute('role','status');app.prepend(notice);}
    notice.textContent=storageNotice;
  }
  function clearTabCredentials() {
    for (const key of [sessionKey, legacySessionKey]) { try { sessionStorage.removeItem(key); } catch {} }
  }
  function readStoredSession({ migrate = false } = {}) {
    let raw;
    try { raw = localStorage.getItem(sessionKey); if (raw) persistentSession = true; } catch {}
    if (!raw) { try { raw = sessionStorage.getItem(sessionKey) || (migrate ? sessionStorage.getItem(legacySessionKey) : null); } catch {} }
    if (!raw) return null;
    try { return validSession(JSON.parse(raw)); } catch { throw rejected('登入資訊不完整，請重新登入。'); }
  }
  function remember(value) {
    session = value;
    if (!value) {
      persistentSession = false; storageNotice = '';
      try { localStorage.removeItem(sessionKey); } catch {}
      clearTabCredentials(); showStorageNotice(); return;
    }
    try {
      localStorage.setItem(sessionKey, JSON.stringify(value)); persistentSession = true; storageNotice = ''; clearTabCredentials();
    } catch {
      persistentSession = false;
      storageNotice = '瀏覽器無法持續記住登入；目前僅此分頁有效，關閉後可能需要重新登入。';
      try { sessionStorage.setItem(sessionKey, JSON.stringify(value)); sessionStorage.removeItem(legacySessionKey); } catch {}
    }
    showStorageNotice();
  }
  function tokenUser(value) {
    try { const part=value.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'); return JSON.parse(atob(part.padEnd(Math.ceil(part.length/4)*4,'='))).sub; } catch { return null; }
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
      if (path === '/auth/v1/token?grant_type=refresh_token' && response.status === 400) throw rejected('登入已失效，請重新使用 Google 登入。');
      if (response.status === 401) throw rejected('登入已失效，請重新使用 Google 登入。');
      if (response.status === 403) throw rejected('這個帳號尚未獲准使用專屬空間。');
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { throw new Error('服務回應格式異常，請稍後再試。'); }
      if (!response.ok) {
        if (path === '/functions/v1/link-import' && response.status === 404) throw new Error('Supabase 尚未部署 link-import 公開連結匯入服務，請通知歐文完成部署。');
        if (path === '/functions/v1/link-import' && response.status === 422) throw new Error('平台限制或此連結沒有可讀取的公開資料，請核對原始連結後手動填寫。');
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
    if (!refreshInFlight) {
      const attempt = generation;
      const refresh = async () => {
        if (attempt !== generation || !session) throw rejected('登入狀態已變更，請重新登入。');
        const latest = readStoredSession();
        if (latest) {
          if (tokenUser(latest) !== tokenUser(session)) { session=latest; throw Object.assign(new Error('登入帳號已變更，請重新連線確認身份。'),{accountChanged:true}); }
          session = latest;
        } else if (persistentSession) throw rejected('已在其他分頁登出，請重新登入。');
        if (session.expires_at > Date.now() / 1000 + 60) return;
        let token = session.refresh_token;
        for (let retry = 0; retry < 2; retry++) {
          let data;
          try {
            data = await request('/auth/v1/token?grant_type=refresh_token', { method:'POST',body:{refresh_token:token},auth:false });
          } catch (error) {
            if (attempt !== generation) throw rejected('登入狀態已變更，請重新登入。');
            // Without Web Locks, give another tab's in-flight rotation a short
            // chance to publish its token before treating an old token as revoked.
            if (!navigator.locks?.request && error.denied && !retry) {
              for (let wait=0;wait<5;wait++) {
                const current=readStoredSession();
                if (current && current.refresh_token!==token) break;
                await new Promise(resolve=>setTimeout(resolve,150));
                if (attempt!==generation) throw rejected('登入狀態已變更，請重新登入。');
              }
            }
            const rotated = readStoredSession();
            if (!retry && rotated && rotated.refresh_token !== token && tokenUser(rotated) === tokenUser(session)) {
              session=rotated;
              if (rotated.expires_at > Date.now()/1000+60) return;
              token=rotated.refresh_token; continue;
            }
            throw error;
          }
          if (attempt !== generation || !session) throw rejected('已登出，請重新登入。');
          const stored = readStoredSession();
          if (!stored && persistentSession) throw rejected('已在其他分頁登出，請重新登入。');
          if (stored && stored.refresh_token !== token) {
            if (tokenUser(stored) !== tokenUser(session)) { session=stored; throw Object.assign(new Error('登入帳號已變更，請重新連線確認身份。'),{accountChanged:true}); }
            session=stored;
            if(stored.expires_at>Date.now()/1000+60)return;
            if(!retry){token=stored.refresh_token;continue;}
            throw new Error('其他分頁正在更新登入，請重新連線。');
          }
          const refreshed=validSession({...data,expires_at:Date.now()/1000+Number(data.expires_in || 3600)});
          if(tokenUser(refreshed)!==tokenUser(session)) { remember(refreshed); throw Object.assign(new Error('登入帳號已變更，請重新連線確認身份。'),{accountChanged:true}); }
          remember(refreshed); return;
        }
      };
      let flight;
      flight = (navigator.locks?.request ? navigator.locks.request(`${sessionKey}-refresh`, refresh) : refresh()).finally(() => { if(refreshInFlight===flight)refreshInFlight=null; });
      refreshInFlight=flight;
    }
    await refreshInFlight;
  }
  function requireMembership() {
    if (verifiedContext && verifiedContext.generation === generation && session && tokenUser(session) === verifiedContext.identity.id) {
      return Promise.resolve({ ...verifiedContext.identity });
    }
    if (membershipFlight?.generation === generation) return membershipFlight.promise;
    const flight = { generation, promise: null };
    flight.promise = verifyMembership().finally(() => { if (membershipFlight === flight) membershipFlight = null; });
    membershipFlight = flight;
    return flight.promise;
  }
  async function verifyMembership() {
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
      if (attempt === generation && (error.denied || error.accountChanged)) lock(error.message, { forget: Boolean(error.denied), ...(error.accountChanged ? {preserveDraft:false}: {}) });
      throw error;
    }
  }
  async function importPublicLink({ url, model }) {
    const attempt = generation;
    try {
      await requireMembership();
      if (attempt !== generation) throw rejected('登入狀態已變更，請重新登入。');
      const result = await request('/functions/v1/link-import', { method: 'POST', body: { url, model }, timeoutMs: 50000 });
      if (attempt !== generation) throw rejected('登入狀態已變更，請重新登入。');
      return result;
    } catch (error) {
      if (error.denied && attempt === generation) lock(error.message);
      throw error;
    }
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
    panel.append(button);
    if (session) {
      const reconnect=element('button','重新連線','secondary-button');reconnect.type='button';reconnect.id='auth-reconnect';
      reconnect.addEventListener('click',async()=>{reconnect.disabled=true;await connect();if(reconnect.isConnected)reconnect.disabled=false;});panel.append(reconnect);
    }
    panel.append(authStatus);
  }
  function lock(text = '', { forget = true, preserveDraft = !forget } = {}) {
    generation++; app.hidden = true; app.inert = true; screen.hidden = false;
    if (restoring) restoring.hidden = true;
    refreshInFlight=null;
    membershipFlight=null; verifiedContext=null; initialLoading=false; busy=false;
    clearSuccessNotice(); dirty=false; changeVersion=0; reminderState='idle'; reminderError='';
    window.TripPlanner?.lock({preserveDraft});
    if ((forget || !preserveDraft) && member) { try { sessionStorage.removeItem(revisionKey(member)); } catch {} }
    if (forget) remember(null);
    if(forget || !preserveDraft)member = null;
    revision = null;
    const email = document.querySelector('#account-email');
    if (email) { email.textContent = ''; email.classList.remove('actor-owen', 'actor-winnie'); }
    renderLogin([text,storageNotice].filter(Boolean).join(' '));
    renderSaveReminder();
  }
  async function sharedSnapshot({ verified = false } = {}) {
    if (!verified) await requireMembership();
    const rows = await request(`/rest/v1/shared_trip_snapshots?scope=eq.${scope}&select=trips,updated_at,updated_by`);
    if (!Array.isArray(rows) || rows.length > 1) throw new Error('共享行程格式異常，請通知歐文。');
    return rows[0] || null;
  }
  async function openPrivateSpace() {
    const attempt = generation;
    const identity = await requireMembership();
    if (attempt !== generation || !session) throw rejected('已登出，請重新登入。');
    const context = { generation: attempt, identity };
    verifiedContext = context;
    let restored;
    try { restored = await window.TripPlanner.unlock(); }
    finally { if (verifiedContext === context) verifiedContext = null; }
    if (attempt !== generation || !session) throw rejected('已登出，請重新登入。');
    try { revision = sessionStorage.getItem(revisionKey(member)); } catch { revision = null; }
    const initialTrips = window.TripPlanner.getTrips();
    const initialVersion = changeVersion;
    dirty = Boolean(restored?.restoredDraft) && initialTrips.some(trip => trip.days.some(day => day.length));
    reminderState = dirty ? 'dirty' : 'idle';
    initialLoading = true;
    const email = document.querySelector('#account-email');
    email.textContent = `${member.displayName} · ${member.email}`;
    email.classList.remove('actor-owen', 'actor-winnie'); email.classList.add(`actor-${member.actor}`);
    if (restoring) restoring.hidden = true;
    screen.hidden = true; app.hidden = false; app.inert = false;
    message('正在載入共同手帳；可以先編輯本頁，載入後不會覆蓋你的新修改。', true);
    renderSaveReminder();
    const snapshot = await sharedSnapshot({ verified: true });
    if (attempt !== generation || !session) throw rejected('已登出，請重新登入。');
    let keptDraft = false;
    if (snapshot) {
      const validated = window.TripPlanner.validateTrips(snapshot.trips);
      const sameBaseline = JSON.stringify(initialTrips) === JSON.stringify(validated);
      keptDraft = changeVersion !== initialVersion || (Boolean(restored?.restoredDraft) && !sameBaseline);
      if (!keptDraft) {
        window.TripPlanner.replaceTrips(snapshot.trips, { silent: true });
        setRevision(snapshot.updated_at);
      } else if (sameBaseline) setRevision(snapshot.updated_at);
      dirty = keptDraft && JSON.stringify(window.TripPlanner.getTrips()) !== JSON.stringify(validated);
    } else {
      setRevision(null);
      dirty = window.TripPlanner.getTrips().some(trip => trip.days.some(day => day.length));
      keptDraft = dirty;
    }
    keptDraft = dirty;
    initialLoading = false; reminderState = dirty ? 'dirty' : 'idle'; renderSaveReminder();
    message(keptDraft ? '已保留這個頁面的未同步草稿。若另一位有新修改，請先匯出備份，再載入共同手帳。'
      : snapshot ? '已載入我們的共同行程。修改後請儲存。' : '先安排想去的地方，再儲存到我們的共同行程。', true);
    if (storageNotice) message(`${document.querySelector('#sync-status').textContent} ${storageNotice}`,true);
  }
  async function perform(task) {
    if (busy || initialLoading || !session || app.hidden) return;
    busy = true;
    renderSaveReminder();
    const attempt = generation;
    try { await task(attempt); }
    catch (error) {
      if (error.denied && attempt === generation) lock(error.message);
      else if (attempt === generation) {
        reminderState='error'; reminderError=error.message;
        message(error.message, true); renderSaveReminder();
      }
    } finally {
      if (attempt === generation) { busy = false; renderSaveReminder(); }
    }
  }
  function save() { return perform(async attempt => {
    clearSuccessNotice(); reminderState='saving'; reminderError=''; renderSaveReminder();
    message('正在儲存我們的行程…', true); await requireMembership();
    if (attempt !== generation || !session) return;
    const trips = window.TripPlanner.getTrips(); window.TripPlanner.validateTrips(trips);
    const submittedVersion = changeVersion;
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
    dirty = changeVersion !== submittedVersion;
    reminderState = dirty ? 'dirty' : 'saved';
    const unsubmittedText = Boolean(document.querySelector('#activity-text')?.value.trim());
    message(dirty ? '本次送出的行程已儲存，但還有尚未同步的新修改，請再次儲存。'
      : `共同行程已儲存。另一位載入共同手帳即可看到修改。${unsubmittedText ? ' 輸入文字請先新增才會保存。' : ''}`, true);
    renderSaveReminder();
    if (!dirty) successTimer = setTimeout(() => {
      if (attempt === generation && !dirty && reminderState === 'saved') { reminderState='idle'; renderSaveReminder(); }
    }, unsubmittedText ? 5000 : 3000);
  }); }
  document.querySelector('#cloud-save').addEventListener('click', save);
  document.querySelector('#save-now')?.addEventListener('click', save);
  document.querySelector('#cloud-load').addEventListener('click', () => perform(async attempt => {
    if (!confirm('載入共同手帳會取代此頁面尚未儲存的修改。建議先匯出備份，確定繼續？')) return;
    const loadingVersion = changeVersion;
    const snapshot = await sharedSnapshot(); if (attempt !== generation || !session) return;
    if (changeVersion !== loadingVersion) throw new Error('載入期間你又修改了行程，已保留新修改，沒有覆蓋。請先儲存或匯出備份，再重新載入。');
    if (!snapshot) throw new Error('還沒有共享行程，請先儲存一次。');
    window.TripPlanner.validateTrips(snapshot.trips); window.TripPlanner.replaceTrips(snapshot.trips, { silent: true });
    clearSuccessNotice(); dirty=false; reminderState='idle'; reminderError='';
    setRevision(snapshot.updated_at); message('已載入最新的共同行程。', true);
    renderSaveReminder();
  }));
  document.querySelector('#sign-out').addEventListener('click', async () => {
    if (!session || !confirm('確定登出？尚未儲存的修改將清除，請先儲存或匯出備份。')) return;
    const token = session.access_token; lock('已登出。再次使用時，請以 Google 登入。');
    try { await request('/auth/v1/logout?scope=local', { method: 'POST', auth: false, headers: { Authorization: `Bearer ${token}` } }); }
    catch { /* Local logout is immediate, including when the network is unavailable. */ }
  });
  window.addEventListener('trip-planner-changed', () => {
    if (member && session && !app.hidden) {
      changeVersion++; dirty=true; clearSuccessNotice();
      if (reminderState !== 'saving') reminderState='dirty';
      if (!busy) message('有尚未同步的修改，完成後請儲存。', true);
      renderSaveReminder();
    }
  });
  async function connect() {
    const attempt=generation;
    showRestoring();
    message('正在確認登入狀態…');
    try { await openPrivateSpace(); }
    catch(error) { if(attempt===generation)lock(error.message,{forget:Boolean(error.denied)}); }
  }
  window.addEventListener('storage',event=>{
    if (event.key!==sessionKey && event.key!==null) return;
    if (event.key===null || event.newValue===null) {
      session=null;persistentSession=false;clearTabCredentials();lock('已在其他分頁登出。',{forget:false,preserveDraft:false});return;
    }
    let next;try { next=readStoredSession();if(!next)throw new Error('Missing session'); } catch { lock('登入資料已變更，請重新登入。');return; }
    if (!session || tokenUser(next)!==tokenUser(session)) {
      lock('其他分頁已變更登入帳號，請重新連線確認身份。',{forget:false,preserveDraft:false});session=next;persistentSession=true;renderLogin('其他分頁已變更登入帳號，請重新連線確認身份。');
    } else { session=next;persistentSession=true; }
  });
  window.addEventListener('pageshow',event=>{if(event.persisted && session){lock('正在重新確認登入狀態…',{forget:false});connect();}});
  async function init() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const callback = hash.has('access_token') || hash.has('error') || hash.has('error_description');
    if (callback) history.replaceState(null, '', location.pathname + location.search);
    renderLogin('正在確認登入狀態…'); app.hidden = true; app.inert = true;
    try {
      // Choose the neutral restoring shell before waiting for another tab's
      // refresh lock. Cached credentials alone never reveal private content.
      if (callback || readStoredSession({ migrate: true })) showRestoring();
      if (callback && hash.has('access_token')) {
        remember(validSession({ access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token'),expires_at:Date.now()/1000+Number(hash.get('expires_in') || 3600) }));
      } else if (callback) { lock('Google 登入未完成，請再試一次。');return; }
      else {
        const restore=()=>{const restored=readStoredSession({migrate:true});if(restored){if(persistentSession){session=restored;clearTabCredentials();}else remember(restored);}};
        if(navigator.locks?.request)await navigator.locks.request(`${sessionKey}-refresh`,restore);else restore();
      }
      if (!session) { lock();return; }
      await connect();
    } catch(error) { lock(error.message,{forget:Boolean(error.denied) || error instanceof SyntaxError}); }
  }
  init();
})();
