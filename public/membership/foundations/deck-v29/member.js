/* Member integration only. The approved presentation assets remain unchanged. */
(function () {
  'use strict';

  // This page is a member reader, not a synchronized presenter surface. Avoid
  // broadcasting slide interactions to other tabs or another signed-in account.
  class LocalOnlyChannel {
    addEventListener() {}
    removeEventListener() {}
    postMessage() {}
    close() {}
  }
  Object.defineProperty(window, 'BroadcastChannel', {
    configurable: true,
    writable: true,
    value: LocalOnlyChannel
  });

  const key = document.body.dataset.memberResumeKey;
  const slideCount = 23;
  const validPosition = value => Number.isInteger(value) && value >= 0 && value < slideCount;
  const initial = new URL(window.location.href);
  initial.searchParams.delete('presenter');
  const hashMatch = /^#slide-(\d{1,2})$/.exec(initial.hash);
  const explicitPosition = hashMatch ? Number(hashMatch[1]) - 1 : -1;

  if (!validPosition(explicitPosition) && key) {
    try {
      const stored = sessionStorage.getItem(key);
      const position = stored !== null && /^\d{1,2}$/.test(stored) ? Number(stored) : -1;
      if (validPosition(position)) initial.hash = `slide-${String(position + 1).padStart(2, '0')}`;
    } catch (_) { /* Reading the deck never depends on storage availability. */ }
  }
  if (initial.href !== window.location.href) {
    history.replaceState(null, '', `${initial.pathname}${initial.search}${initial.hash}`);
  }

  function memberIndexLinks() {
    document.querySelectorAll('a[data-slide-go]').forEach(function (link) {
      const index = Number(link.dataset.slideGo);
      if (validPosition(index)) {
        link.href = `/my/foundations/deck#slide-${String(index + 1).padStart(2, '0')}`;
      }
    });
  }

  // Store a position only. These values are never submitted as course completion
  // or mixed with answers, membership state, or the older Foundations path.
  document.addEventListener('foundations:slidechange', function (event) {
    // The source index is generated during controls boot, after this adapter.
    // Absolute member URLs also work when a link is copied or opened in a tab.
    memberIndexLinks();
    const index = event.detail?.index;
    if (!key || !validPosition(index)) return;
    try { sessionStorage.setItem(key, String(index)); } catch (_) { /* Optional resume. */ }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key.toLowerCase() !== 'p' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input,textarea,select,[contenteditable]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  function memberNavigation() {
    document.body.classList.add('member-deck');
    document.querySelector('#presenterOpen')?.remove();
    document.querySelector('#presenterPanel')?.remove();

    const returnLink = document.createElement('a');
    returnLink.className = 'member-return';
    returnLink.href = '/my/foundations';
    returnLink.textContent = '← My Foundations';
    const issue = document.querySelector('.masthead .issue');
    if (issue) issue.replaceWith(returnLink);
    else document.querySelector('.masthead')?.append(returnLink);

    const help = document.querySelector('.index-end p');
    if (help) help.textContent = '← → Navigate · I Index · N Slide text · M Motion';
    memberIndexLinks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', memberNavigation, { once: true });
  } else memberNavigation();
})();
