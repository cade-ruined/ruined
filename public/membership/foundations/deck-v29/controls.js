(function () {
  'use strict';

  const CHANNEL_NAME = 'ruined-foundations01-sequence-v27';
  const MOTION_KEY = 'ruined-foundations01-motion';
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const presenter = new URLSearchParams(location.search).get('presenter') === '1';
  const sender = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let current = 0;
  let initialized = false;
  let channel = null;
  let touch = null;
  let presenterLinkTimer = null;
  let interactionSyncDepth = 0;
  let manualMotion = null;
  let motion = !media.matches;

  try {
    const preference = localStorage.getItem(MOTION_KEY);
    if (preference === 'on' || preference === 'off') manualMotion = preference === 'on';
  } catch (_) { /* Storage can be disabled in private or local-file contexts. */ }
  if (manualMotion !== null) motion = manualMotion && !media.matches;

  const $ = selector => document.querySelector(selector);
  const order = () => window.FOUNDATIONS_ORDER ?? window.FOUNDATIONS.map((_,i)=>i+1);
  const sourceIndex = position => order()[position] - 1;
  const slides = () => order().map(number=>window.FOUNDATIONS[number-1]);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const title = slide => String(slide?.title || slide?.heading || 'Untitled slide');
  const pad = value => String(value).padStart(2, '0');

  function sourceValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(sourceValue).filter(text => text !== '').join('\n\n');
    if (typeof value === 'object') {
      if ('text' in value) return sourceValue(value.text);
      if ('value' in value) return sourceValue(value.value);
      return Object.values(value).map(sourceValue).filter(text => text !== '').join('\n\n');
    }
    return String(value);
  }

  function exactSource(slide) {
    return sourceValue(slide?.sourceTexts ?? slide?.texts ?? slide?.sourceText ??
      slide?.source ?? slide?.exactText ?? slide?.body ?? '');
  }

  function indexFromHash() {
    const match = /^#slide-(\d+)$/i.exec(location.hash);
    return match ? Number(match[1]) - 1 : 0;
  }

  function send(message) {
    try { channel?.postMessage({ ...message, sender }); } catch (_) { /* Navigation remains local. */ }
  }

  function interactionValue(value) {
    if (!value || typeof value !== 'object') return null;
    if(value.experiment && typeof value.experiment==='object'){
      const entries=Object.entries(value.experiment);
      if(entries.length>0&&entries.length<=16&&entries.every(([key,v])=>/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(key)&&typeof v==='number'&&Number.isFinite(v)))return {experiment:Object.fromEntries(entries)};
      return null;
    }
    if (Number.isInteger(value.step) && value.step >= 0) return { step: value.step };
    if (typeof value.slider === 'number' && Number.isFinite(value.slider)) return { slider: value.slider, phase: value.phase === 1 ? 1 : 0 };
    return null;
  }

  function currentInteraction() {
    return interactionValue(window.getFoundationInteraction?.());
  }

  function applyInteraction(value) {
    const interaction = interactionValue(value);
    if (!interaction || typeof window.applyFoundationInteraction !== 'function') return;
    interactionSyncDepth += 1;
    try { window.applyFoundationInteraction(interaction); }
    finally { interactionSyncDepth -= 1; }
    refreshNavigation();
  }

  function interactionChanged(event) {
    if (event.detail?.slide !== sourceIndex(current)) return;
    const value = interactionValue(event.detail?.value);
    refreshNavigation();
    if (value && interactionSyncDepth === 0) send({ type: 'interaction', index: current, value });
  }

  function canNavigate(delta) {
    if (window.canAdvanceFoundation?.(delta) === true) return true;
    return delta < 0 ? current > 0 : current < slides().length - 1;
  }

  function navigate(delta) {
    const direction = delta < 0 ? -1 : 1;
    if (window.advanceFoundation?.(direction) === true) {
      refreshNavigation();
      return;
    }
    go(current + direction);
  }

  function setHash(index, replace = false) {
    const hash = `#slide-${pad(index + 1)}`;
    if (location.hash === hash) return;
    try {
      history[replace ? 'replaceState' : 'pushState'](null, '', `${location.pathname}${location.search}${hash}`);
    } catch (_) {
      if (replace) location.replace(hash);
      else location.hash = hash;
    }
  }

  function refreshSource() {
    const slide = slides()[current];
    if ($('#sourceTitle')) $('#sourceTitle').textContent = title(slide);
    if ($('#sourceText')) $('#sourceText').textContent = exactSource(slide);
  }

  function refreshPresenter() {
    if (!presenter || !$('#presenterPanel')) return;
    const all = slides();
    const slide = all[current];
    const next = all[current + 1];
    $('#presenterPanel').innerHTML = `
      <div class="presenter-heading"><span>FOUNDATIONS 01 / PRESENTER</span><span>${pad(current + 1)} / ${pad(all.length)}</span></div>
      <div class="presenter-nav"><button id="presenterPrevious"${!canNavigate(-1) ? ' disabled' : ''}>← Previous</button><button id="presenterNext"${!canNavigate(1) ? ' disabled' : ''}>Next →</button></div>
      <section class="presenter-current"><p class="presenter-label">CURRENT SLIDE</p><h1>${esc(title(slide))}</h1><div class="presenter-source">${esc(exactSource(slide))}</div>${slide?.notesStatus==='philosophy_revision_v9'&&slide.notes?`<p class="presenter-label">FACILITATOR NOTES</p><div class="presenter-source">${esc(slide.notes)}</div>`:''}</section>
      <section class="presenter-up-next"><p class="presenter-label">UP NEXT</p><h2>${next ? esc(title(next)) : 'End of Foundations 01'}</h2>${next ? `<div class="presenter-next-source">${esc(exactSource(next))}</div>` : ''}</section>`;
    $('#presenterPanel').querySelectorAll('.presenter-source,.presenter-next-source').forEach(element => {
      element.style.whiteSpace = 'pre-wrap';
    });
  }

  function refreshNavigation() {
    const length = slides().length;
    if ($('#counter')) $('#counter').textContent = `${pad(current + 1)} / ${pad(length)}`;
    if ($('#previous')) $('#previous').disabled = !canNavigate(-1);
    if ($('#next')) $('#next').disabled = !canNavigate(1);
    if ($('#progressFill')) {
      $('#progressFill').style.width = `${(current + 1) / length * 100}%`;
      $('#progressFill').setAttribute('aria-valuenow', String(current + 1));
      $('#progressFill').setAttribute('aria-valuemax', String(length));
    }
    document.querySelectorAll('[data-slide-go]').forEach(element => {
      const active = Number(element.dataset.slideGo) === current;
      element.classList.toggle('active', active);
      if (active) element.setAttribute('aria-current', 'step');
      else element.removeAttribute('aria-current');
    });
    if ($('#announcer')) $('#announcer').textContent = `Slide ${current + 1} of ${length}: ${title(slides()[current])}`;
    if ($('#presenterOpen')?.tagName === 'A') $('#presenterOpen').href = presenterUrl().href;
    refreshSource();
    refreshPresenter();
  }

  function go(index, options = {}) {
    if (!slides().length || typeof window.renderFoundation !== 'function') return;
    const numeric = Number(index);
    if (!Number.isFinite(numeric)) return;
    const next = Math.max(0, Math.min(slides().length - 1, Math.trunc(numeric)));
    const changed = next !== current || !initialized;
    if (!changed && !options.force) return;
    window.cleanupFoundation?.();
    current = next;
    initialized = true;
    document.body.dataset.slide = pad(sourceIndex(current) + 1);
    document.body.dataset.position = pad(current + 1);
    const stage = $('#stage');
    if (stage) {
      stage.innerHTML = window.renderFoundation(sourceIndex(current));
      stage.scrollTop = 0;
      stage.scrollLeft = 0;
      if (!stage.hasAttribute('tabindex')) stage.tabIndex = -1;
      if (options.focus !== false && !presenter) {
        try { stage.focus({ preventScroll: true }); } catch (_) { stage.focus(); }
      }
    }
    interactionSyncDepth += 1;
    try { window.bindFoundation?.(sourceIndex(current)); }
    finally { interactionSyncDepth -= 1; }
    refreshNavigation();
    if (options.hash !== false) setHash(current, options.replace === true);
    if (options.broadcast !== false) send({ type: 'go', index: current, value: currentInteraction() });
    document.dispatchEvent(new CustomEvent('foundations:slidechange', { detail: { index: current, sourceIndex:sourceIndex(current) } }));
  }

  function applyMotion() {
    document.body.classList.toggle('still', !motion);
    const button = $('#motionToggle');
    if (button) {
      button.textContent = motion ? 'MOTION ON' : 'MOTION OFF';
      button.setAttribute('aria-pressed', String(motion));
      button.setAttribute('aria-label', motion ? 'Turn motion off' : 'Turn motion on');
    }
    window.onFoundationMotion?.(motion);
  }

  function toggleMotion() {
    manualMotion = !motion;
    motion = manualMotion && !media.matches;
    try { localStorage.setItem(MOTION_KEY, manualMotion ? 'on' : 'off'); } catch (_) { /* Optional preference. */ }
    applyMotion();
  }

  function handleMotionPreference(event) {
    motion = event.matches ? false : manualMotion !== false;
    applyMotion();
  }

  function showDialog(selector) {
    const dialog = $(selector);
    if (!dialog) return;
    document.querySelectorAll('dialog[open]').forEach(open => { if (open !== dialog) open.close(); });
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }

  function presenterUrl() {
    const url = new URL(location.href);
    url.searchParams.set('presenter', '1');
    url.hash = `slide-${pad(current + 1)}`;
    return url;
  }

  function openPresenter() {
    if (presenter) return;
    const url = presenterUrl();
    let tab = null;
    try { tab = window.open(url.href, 'ruined-foundations01-presenter'); } catch (_) { /* Show the direct link below. */ }
    if (tab) {
      try { tab.focus(); } catch (_) { /* The browser may manage tab focus itself. */ }
    }
    showPresenterFallback(url);
  }

  function showPresenterFallback(url) {
    const toast = $('#toast');
    if (toast) {
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = 'If no tab opened, open presenter here ↗';
      link.style.textDecoration = 'underline';
      toast.replaceChildren(link);
      toast.style.pointerEvents = 'auto';
      toast.dataset.presenterFallback = 'true';
      clearTimeout(presenterLinkTimer);
      presenterLinkTimer = setTimeout(() => {
        if (toast.dataset.presenterFallback) {
          toast.replaceChildren();
          toast.style.removeProperty('pointer-events');
          delete toast.dataset.presenterFallback;
        }
        presenterLinkTimer = null;
      }, 15000);
    }
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    } catch (_) { /* Browser fullscreen controls remain available. */ }
  }

  function click(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const close = target.closest('[data-close]');
    if (close) {
      const dialog = close.closest('dialog');
      if (dialog?.close) dialog.close();
      else dialog?.removeAttribute('open');
      return;
    }
    const jump = target.closest('[data-slide-go]');
    if (jump) {
      event.preventDefault();
      jump.closest('dialog')?.close();
      go(Number(jump.dataset.slideGo));
      return;
    }
    const button = target.closest('button,a');
    if (!button || button.disabled) return;
    switch (button.id) {
      case 'previous': case 'presenterPrevious': navigate(-1); break;
      case 'next': case 'presenterNext': navigate(1); break;
      case 'home': go(0); break;
      case 'indexOpen': showDialog('#indexDialog'); break;
      case 'sourceOpen': refreshSource(); showDialog('#sourceDialog'); break;
      case 'presenterOpen':
        if (button.tagName === 'A') {
          const url = presenterUrl();
          button.href = url.href;
          showPresenterFallback(url);
          return;
        }
        openPresenter(); break;
      case 'motionToggle': toggleMotion(); break;
      case 'fullscreen': fullscreen(); break;
      default: return;
    }
    event.preventDefault();
  }

  function keyboard(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input,textarea,select,button,a,[contenteditable=""],[contenteditable="true"],[role="slider"]')) return;
    if (document.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    if (!['arrowright', 'arrowleft', 'arrowdown', 'arrowup', ' ', 'pagedown', 'pageup', 'home', 'end', 'i', 'n', 'p', 'f', 'm'].includes(key)) return;
    if ((key === 'arrowup' || key === 'arrowdown') && $('#stage')?.scrollHeight > $('#stage')?.clientHeight + 2) return;
    event.preventDefault();
    switch (key) {
      case 'arrowright': case 'arrowdown': case 'pagedown': navigate(1); break;
      case ' ': navigate(event.shiftKey ? -1 : 1); break;
      case 'arrowleft': case 'arrowup': case 'pageup': navigate(-1); break;
      case 'home': go(0); break;
      case 'end': go(slides().length - 1); break;
      case 'i': showDialog('#indexDialog'); break;
      case 'n': refreshSource(); showDialog('#sourceDialog'); break;
      case 'p': openPresenter(); break;
      case 'f': fullscreen(); break;
      case 'm': toggleMotion(); break;
    }
  }

  function touchStart(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (event.touches.length !== 1 || target?.closest('input,button,a,select,textarea,[contenteditable],[role="slider"],[data-no-swipe]')) {
      touch = null;
      return;
    }
    touch = { x: event.touches[0].clientX, y: event.touches[0].clientY, time: Date.now() };
  }

  function touchEnd(event) {
    if (!touch || !event.changedTouches.length) return;
    const start = touch;
    touch = null;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Date.now() - start.time < 1200 && Math.abs(dx) > 85 && Math.abs(dx) > Math.abs(dy) * 1.8 && Math.abs(dy) < 70) {
      navigate(dx < 0 ? 1 : -1);
    }
  }

  function receive(event) {
    const message = event.data;
    if (!message || message.sender === sender) return;
    if (message.type === 'hello' && !presenter) {
      send({ type: 'state', index: current, value: currentInteraction(), recipient: message.sender });
      return;
    }
    if (message.recipient && message.recipient !== sender) return;
    if (!Number.isInteger(message.index) || message.index < 0 || message.index >= slides().length) return;
    if (message.type === 'interaction') {
      if (message.index === current) applyInteraction(message.value);
      return;
    }
    if ((message.type === 'go' || message.type === 'state') &&
      (!message.recipient || message.recipient === sender)) {
      go(message.index, { broadcast: false, replace: true, focus: false });
      if (message.index === current) applyInteraction(message.value);
    }
  }

  function boot() {
    document.body.classList.toggle('presenter', presenter);
    if ($('#chapterList')) {
      $('#chapterList').innerHTML = slides().map((slide, index) =>
        `<a href="#slide-${pad(index + 1)}" data-slide-go="${index}"><span>${pad(index + 1)}</span><strong>${esc(title(slide))}</strong><span aria-hidden="true">↗</span></a>`
      ).join('');
    }
    document.addEventListener('click', click);
    document.addEventListener('keydown', keyboard);
    document.addEventListener('foundations:interaction', interactionChanged);
    $('#stage')?.addEventListener('touchstart', touchStart, { passive: true });
    $('#stage')?.addEventListener('touchend', touchEnd, { passive: true });
    $('#stage')?.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
    document.querySelectorAll('dialog').forEach(dialog => {
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      });
    });
    window.addEventListener('hashchange', () => go(indexFromHash(), { replace: true, broadcast: true }));
    window.addEventListener('popstate', () => go(indexFromHash(), { replace: true, broadcast: true }));
    if (media.addEventListener) media.addEventListener('change', handleMotionPreference);
    else media.addListener(handleMotionPreference);
    applyMotion();
    go(indexFromHash(), { replace: true, broadcast: false, focus: false });
    try {
      if ('BroadcastChannel' in window) {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.addEventListener('message', receive);
        if (presenter) send({ type: 'hello' });
      }
    } catch (_) { channel = null; }
    window.addEventListener('pagehide', event => {
      clearTimeout(presenterLinkTimer);
      window.cleanupFoundation?.();
      if (!event.persisted) channel?.close();
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted) go(current, { force: true, broadcast: false, focus: false, replace: true });
    });
  }

  window.deck = {
    go,
    goSource(index) {const position=order().indexOf(Number(index)+1);if(position>=0)go(position);},
    navigate,
    get current() { return current; },
    get motion() { return motion; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
