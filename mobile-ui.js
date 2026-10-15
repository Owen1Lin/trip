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
  let focusFrame = 0;
  function updateKeyboardState() {
    const viewport = window.visualViewport;
    const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
    // Keep layout stable while focus moves to a checkbox or the submit button.
    // The viewport expanding, rather than blur, signals keyboard dismissal.
    const keyboard = editor.open && viewport && Math.abs((viewport.scale || 1) - 1) < 0.05 && layoutHeight - viewport.height >= 120;
    if (keyboard) document.documentElement.dataset.editorKeyboard = 'open';
    else document.documentElement.removeAttribute('data-editor-keyboard');
  }
  function textareaCaret(control) {
    const style = getComputedStyle(control), rect = control.getBoundingClientRect();
    const mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    for (const property of ['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','lineHeight','textTransform','textIndent','tabSize','wordBreak','direction','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth']) mirror.style[property] = style[property];
    Object.assign(mirror.style, { position:'fixed', left:'-100000px', top:'0', width:`${control.clientWidth + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0)}px`, height:'auto', minHeight:'0', maxHeight:'none', boxSizing:'border-box', borderStyle:'solid', whiteSpace:'pre-wrap', overflowWrap:'break-word', visibility:'hidden', pointerEvents:'none' });
    mirror.textContent = control.value.slice(0, control.selectionStart ?? control.value.length);
    const marker = document.createElement('span'); marker.textContent = '\u200b'; mirror.append(marker);
    editor.append(mirror);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
    let y;
    try { y = marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top; }
    finally { mirror.remove(); }
    return { y, lineHeight };
  }
  function keepEditorFocusVisible() {
    focusFrame = 0;
    if (!editor.open || !unlocked()) return;
    const control = document.activeElement;
    if (!editor.contains(control) || !control.matches('input, textarea, select') || !control.getClientRects().length) return;
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
    const sheet = editor.getBoundingClientRect();
    const header = editor.querySelector('.editor-topbar');
    const headerRect = header?.getBoundingClientRect();
    const actions = editor.querySelector('.activity-form > .planner-actions');
    const actionRect = actions?.getBoundingClientRect();
    let top = Math.max(sheet.top, viewportTop) + 10;
    let bottom = Math.min(sheet.bottom, viewportBottom) - 10;
    if (headerRect && getComputedStyle(header).position === 'sticky') top = Math.max(top, headerRect.bottom + 10);
    if (actionRect && getComputedStyle(actions).position === 'sticky' && actionRect.top < bottom && actionRect.bottom > top) bottom = Math.min(bottom, actionRect.top - 10);
    if (bottom <= top + 20) return;
    let rect = control.getBoundingClientRect(), targetTop = rect.top, targetBottom = rect.bottom;
    if (control.matches('textarea')) {
      const { y, lineHeight } = textareaCaret(control);
      // Keep the composing line visible inside the textarea, then move only
      // the dialog to reveal that line. Never replace text or selection: IME
      // owns those, and a long textarea need not fit in the keyboard viewport.
      const paddingTop = parseFloat(getComputedStyle(control).paddingTop) || 0;
      const caretTop = y - control.scrollTop;
      const caretBottom = caretTop + lineHeight;
      const innerBottom = control.clientHeight - paddingTop;
      if (caretBottom > innerBottom) control.scrollTop += caretBottom - innerBottom;
      else if (caretTop < paddingTop) control.scrollTop -= paddingTop - caretTop;
      rect = control.getBoundingClientRect();
      targetTop = Math.max(rect.top, rect.top + y - control.scrollTop - lineHeight);
      targetBottom = Math.min(rect.bottom, rect.top + y - control.scrollTop + lineHeight * 2);
    }
    // A tolerance prevents fractional Safari viewport updates from causing
    // perpetual tiny scrolls. Ordinary user scrolling does not call this.
    if (targetBottom > bottom + 2) editor.scrollTop += Math.max(0, Math.min(targetBottom - bottom, targetTop - top));
    else if (targetTop < top - 2) editor.scrollTop -= top - targetTop;
  }
  function scheduleFocusVisibility() {
    updateKeyboardState();
    if (focusFrame) return;
    focusFrame = requestAnimationFrame(keepEditorFocusVisible);
  }

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
    document.documentElement.removeAttribute('data-editor-keyboard');
    if (focusFrame) { cancelAnimationFrame(focusFrame); focusFrame = 0; }
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
    scheduleFocusVisibility();
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
  for (const event of ['focusin', 'focusout', 'input', 'select', 'compositionend']) editor.addEventListener(event, scheduleFocusVisibility);
  document.addEventListener('selectionchange', () => { if (editor.open && editor.contains(document.activeElement)) scheduleFocusVisibility(); });
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
    scheduleFocusVisibility();
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
