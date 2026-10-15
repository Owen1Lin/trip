/* View navigation and an accessible activity sheet; application data stays in TripPlanner. */
(() => {
  'use strict';
  const app = document.querySelector('#private-app');
  const editor = document.querySelector('#activity-editor');
  if (!app || !editor) return;
  const syncIndicator = document.querySelector('#sync-indicator');
  const syncStatus = document.querySelector('#sync-status');
  const views = new Set(['itinerary', 'link-import', 'sync']);
  let currentView = 'itinerary';
  let editorOpener = null;
  let resumableDraft = false;
  let pendingCloseEvents = 0;
  let currentSyncState = null;

  function unlocked() { return !app.hidden && !app.inert; }
  function updateSyncIndicator(forceNeutral = false) {
    if (!syncIndicator) return;
    const sync = !forceNeutral && unlocked() ? window.TripSync?.getState?.() || currentSyncState : null;
    const source = !forceNeutral && unlocked() ? sync?.message || syncStatus?.textContent.trim() || '' : '';
    let state = 'neutral', label = '共同手帳';
    if (sync?.status === 'saving') {
      state = 'saving'; label = '儲存中';
    } else if (sync?.dirty || /尚未同步|未同步草稿/.test(source)) {
      state = 'dirty'; label = '有未同步變更';
    } else if (source.includes('正在儲存')) {
      state = 'saving'; label = '儲存中';
    } else if (source.includes('共同行程已儲存')) {
      state = 'saved'; label = '已儲存';
    } else if (source.includes('已載入最新')) {
      state = 'loaded'; label = '已載入雲端';
    }
    syncIndicator.dataset.state = state;
    const labelElement = syncIndicator.querySelector('.sync-indicator-label') || syncIndicator;
    labelElement.textContent = label;
    const description = source || '查看共同手帳同步狀態';
    syncIndicator.title = description;
    syncIndicator.setAttribute('aria-label', description);
  }
  function updateNavigation() {
    app.querySelectorAll('[data-nav]').forEach(button => {
      const selected = editor.open ? button.dataset.nav === 'add' : button.dataset.nav === currentView;
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
  function finishClose(options = {}) {
    document.body.classList.remove('mobile-editor-open');
    document.documentElement.removeAttribute('data-mobile-editor');
    if (!options.preserveDraft) resumableDraft = false;
    updateNavigation();
    const opener = editorOpener;
    editorOpener = null;
    if (options.restoreFocus !== false && unlocked()) {
      const target = opener?.isConnected && !opener.closest('[hidden]')
        ? opener : app.querySelector(`[data-nav="${currentView}"]`);
      target?.focus({ preventScroll: true });
    }
  }
  function closeEditor(options = {}) {
    if (!options.preserveView) currentView = 'itinerary';
    app.querySelectorAll('[data-app-view]').forEach(panel => { panel.hidden = panel.dataset.appView !== currentView; });
    if (editor.open) {
      pendingCloseEvents++;
      editor.close();
    }
    // Native dialog close events are queued. Finish synchronously so sign-out
    // immediately removes sheet state, and consume its event without reopening it.
    finishClose(options);
  }
  function showView(view, options = {}) {
    if (!views.has(view) || !unlocked()) return false;
    currentView = view;
    if (editor.open) closeEditor({ preserveDraft: true, preserveView: true, restoreFocus: false });
    app.querySelectorAll('[data-app-view]').forEach(panel => { panel.hidden = panel.dataset.appView !== view; });
    updateNavigation();
    if (options.focus) {
      const panel = app.querySelector(`[data-app-view="${view}"]`);
      const heading = options.focus === 'day'
        ? panel?.querySelector('#day-summary') : panel?.querySelector('h1, h2');
      if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
    }
    // Each destination opens at its entrance. Changing visibility preserves the
    // forms, but the previous page's long scroll position must not carry over.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    return true;
  }
  function openEditor(options = {}) {
    if (!unlocked()) return false;
    if (!editor.open) {
      editorOpener = options.opener || document.activeElement;
      try { editor.showModal(); } catch { editorOpener = null; return false; }
    }
    resumableDraft = true;
    document.body.classList.add('mobile-editor-open');
    document.documentElement.dataset.mobileEditor = 'open';
    updateNavigation();
    const editing = !editor.querySelector('#activity-detail-fields')?.hidden;
    const focusOrder = editing
      ? ['#activity-place', '#activity-date', '#activity-category']
      : ['#activity-category', '#activity-text'];
    const focusTarget = focusOrder.map(selector => editor.querySelector(selector))
      .find(control => control && !control.disabled && !control.closest('[hidden], [inert]') && control.getClientRects().length);
    focusTarget?.focus({ preventScroll: true });
    return true;
  }
  function startActivity(opener) {
    if (!unlocked()) return;
    if (resumableDraft) { openEditor({ opener }); return; }
    window.TripPlanner?.startActivity(opener?.dataset.period);
  }
  app.addEventListener('click', event => {
    const button = event.target.closest('[data-nav], [data-open-view], [data-open-editor], [data-close-editor]');
    if (!button || !app.contains(button) || !unlocked()) return;
    if (button.matches('[data-close-editor]')) {
      closeEditor({ preserveDraft: true });
    } else if (button.matches('[data-open-editor]') || button.dataset.nav === 'add') {
      startActivity(button);
    } else {
      showView(button.dataset.openView || button.dataset.nav, { focus: true });
    }
  });
  editor.addEventListener('cancel', event => {
    event.preventDefault();
    closeEditor({ preserveDraft: true });
  });
  editor.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !editor.open) return;
    const controls = [...editor.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter(control => control.tabIndex >= 0 && !control.disabled && !control.closest('[hidden], [inert]') && control.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); editor.focus(); return; }
    // Wrap only at the sheet's boundaries, leaving time inputs' internal
    // keyboard navigation and ordinary movement between fields native.
    if (event.shiftKey && (document.activeElement === first || document.activeElement === editor)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === editor)) {
      event.preventDefault(); first.focus();
    }
  });
  editor.addEventListener('close', () => {
    // A previous queued close event must not change a sheet reopened meanwhile.
    if (pendingCloseEvents > 0) { pendingCloseEvents--; return; }
    if (!editor.open) finishClose({ preserveDraft: true });
  });
  function reset() {
    closeEditor({ restoreFocus: false });
    editorOpener = null;
    resumableDraft = false;
    updateSyncIndicator(true);
  }
  window.addEventListener('trip-planner-locked', reset);
  window.addEventListener('trip-sync-state', event => { currentSyncState = event.detail; updateSyncIndicator(); });
  window.addEventListener('trip:activity-added', () => {
    closeEditor({ restoreFocus: false });
    showView('itinerary', { focus: 'day' });
  });
  new MutationObserver(() => {
    if (!unlocked()) reset();
    updateSyncIndicator();
  }).observe(app, { attributes: true, attributeFilter: ['hidden', 'inert'] });
  if (syncStatus) new MutationObserver(() => updateSyncIndicator()).observe(syncStatus, { childList: true, characterData: true, subtree: true });
  function updateViewport() {
    const viewport = window.visualViewport;
    document.documentElement.style.setProperty('--mobile-viewport-height', `${Math.round(viewport?.height || window.innerHeight)}px`);
    const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
    const bottomGap = viewport ? Math.max(0, layoutHeight - (viewport.offsetTop + viewport.height)) : 0;
    document.documentElement.style.setProperty('--mobile-viewport-bottom-gap', `${Math.round(bottomGap)}px`);
  }
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('scroll', updateViewport);
  window.addEventListener('resize', updateViewport);
  updateViewport();
  const api = Object.freeze({ openEditor, closeEditor, showView });
  window.TripMobileUI = api;
  window.TripMobile = api;
  reset();
})();
