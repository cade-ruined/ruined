(function () {
  'use strict';
  const tornadoSource = 'assets/video/tornado.mp4';
  const records = new Map();
  const previousCleanup = window.cleanupFoundation;
  const previousMotion = window.onFoundationMotion;
  let sequence = 0;
  let stage = null;
  let observer = null;
  let motion = false;
  let suspended = false;
  let continuation = null;

  window.FoundationStormMarkup = function (movingFigure = false) {
    const id = `foundationStormVideo${++sequence}`;
    const poster = movingFigure ? 'assets/figma/storm.webp' : 'assets/figma/frame-1163-357.webp';
    const foreground = movingFigure ? 'assets/moving-fear/landscape-clean.png' : 'assets/figma/meadow-figure.webp';
    return `<figure class="foundation-storm${movingFigure ? ' foundation-storm--moving' : ''}" data-foundation-storm aria-label="A woman in a meadow facing mountains and a tornado." data-no-swipe>
      <img class="foundation-storm-poster" src="${poster}" alt="" draggable="false">
      <video id="${id}" class="foundation-storm-video" data-foundation-video src="${tornadoSource}" muted playsinline loop preload="metadata" disablepictureinpicture disableremoteplayback aria-hidden="true"></video>
      <img class="foundation-storm-foreground" src="${foreground}" alt="" draggable="false">
      ${movingFigure ? '<div class="foundation-storm-person" data-fear-person aria-hidden="true"><img src="assets/moving-fear/woman-cutout.png" alt="" draggable="false"></div>' : ''}
    </figure>`;
  };

  function connected(record) {
    return !record.disposed && record.figure.isConnected && stage?.contains(record.figure);
  }
  function shouldPlay(record) {
    return !suspended && connected(record) && !document.hidden && !record.blocked && !record.failed && motion;
  }
  function paint(record) {
    const playing = !record.video.paused && !record.video.ended;
    const restoring = record.restorePending && shouldPlay(record);
    const active = playing || record.pending || restoring;
    const loading = (record.pending || restoring) && !record.hasFrame;
    record.figure.classList.toggle('has-video-frame', record.hasFrame);
    record.figure.dataset.playback = loading ? 'loading' : active ? 'playing' : 'paused';
  }
  function clearFrameRequest(record) {
    if (record.frameRequest !== null && record.video.cancelVideoFrameCallback) record.video.cancelVideoFrameCallback(record.frameRequest);
    record.frameRequest = null;
  }
  function pause(record) {
    record.attempt += 1;
    record.pending = false;
    clearFrameRequest(record);
    if (!record.video.paused) record.video.pause();
    paint(record);
  }
  function revealFrame(record) {
    if (!connected(record) || record.video.readyState < 2 || record.video.paused || !shouldPlay(record)) return;
    record.hasFrame = true;
    paint(record);
  }
  function waitForFrame(record) {
    if (record.hasFrame || record.frameRequest !== null) return;
    if (record.video.requestVideoFrameCallback) {
      record.frameRequest = record.video.requestVideoFrameCallback(() => {
        record.frameRequest = null;
        revealFrame(record);
      });
    }
    // Older browsers reveal only after playback has advanced a decoded frame.
    else if (record.video.currentTime > 0) revealFrame(record);
  }
  function play(record) {
    if (!shouldPlay(record) || record.restorePending || record.pending || !record.video.paused) { paint(record); return; }
    const attempt = ++record.attempt;
    record.pending = true;
    record.video.muted = true;
    record.video.defaultMuted = true;
    record.video.playsInline = true;
    let promise;
    try { promise = record.video.play(); }
    catch (_) { record.pending = false; record.blocked = true; paint(record); return; }
    paint(record);
    Promise.resolve(promise).then(() => {
      if (record.attempt !== attempt || !shouldPlay(record)) {
        if (!shouldPlay(record) && !record.video.paused) record.video.pause();
        return;
      }
      record.pending = false;
      waitForFrame(record);
      paint(record);
    }).catch(() => {
      if (record.attempt !== attempt) return;
      record.pending = false;
      record.blocked = true;
      paint(record);
    });
  }
  function finishRestore(record) {
    record.restorePending = false;
    record.restoring = false;
    // A paused remount shows the restored decoded frame, never the clip's opening frame.
    if (record.resumeFrame && record.video.readyState >= 2 && connected(record)) record.hasFrame = true;
  }
  function restore(record) {
    if (!record.restorePending) return true;
    if (!connected(record) || record.restoring || record.video.readyState < 1) return false;
    const duration = record.video.duration;
    const target = Number.isFinite(duration) && duration > 0 ? record.resumeTime % duration : record.resumeTime;
    if (Math.abs(record.video.currentTime - target) < .02 && record.video.readyState >= 2) {
      finishRestore(record);
      return true;
    }
    record.restoring = true;
    try { record.video.currentTime = target; }
    catch (_) { record.restoring = false;record.restorePending = false; }
    return !record.restorePending;
  }
  function sync(record) {
    if (!restore(record)) {paint(record);return;}
    if (shouldPlay(record)) play(record);
    else pause(record);
  }
  function attach(figure) {
    const video = figure.querySelector('[data-foundation-video]');
    if (!video) return;
    const slide = String(document.body?.dataset.slide || '');
    const resume = continuation?.slide === slide ? continuation : null;
    continuation = null;
    const resumeTime = Number.isFinite(resume?.time) ? Math.max(0, resume.time) : 0;
    const record = {figure, video, slide, blocked:resume?.blocked === true, failed:false, pending:false, hasFrame:false, disposed:false, attempt:0, frameRequest:null, listeners:[], resumeTime, resumeFrame:resume?.hasFrame === true, restorePending:resumeTime > 0 || resume?.hasFrame === true, restoring:false};
    video.muted = true; video.defaultMuted = true; video.playsInline = true; video.loop = true;
    const listen = (target, name, handler) => {target.addEventListener(name, handler);record.listeners.push(() => target.removeEventListener(name, handler));};
    listen(video, 'playing', () => { if (!shouldPlay(record)) pause(record); else {waitForFrame(record);paint(record);} });
    listen(video, 'pause', () => paint(record));
    listen(video, 'loadedmetadata', () => sync(record));
    listen(video, 'seeked', () => {if (record.restoring) {finishRestore(record);sync(record);}});
    listen(video, 'timeupdate', () => { if (!video.requestVideoFrameCallback) waitForFrame(record); });
    listen(video, 'error', () => {record.failed = true;record.hasFrame = false;record.restoring = false;pause(record);});
    records.set(figure, record);
    sync(record);
  }
  function detach(record) {
    record.disposed = true;
    pause(record);
    record.listeners.forEach(remove => remove());
    records.delete(record.figure);
  }
  function reconcile() {
    if (!stage || suspended) return;
    for (const record of records.values()) if (!connected(record)) {
      if (record.slide === String(document.body?.dataset.slide || '')) continuation = {slide:record.slide,time:record.restorePending ? record.resumeTime : record.video.currentTime,hasFrame:record.hasFrame || record.resumeFrame,blocked:record.blocked};
      detach(record);
    }
    stage.querySelectorAll('[data-foundation-storm]').forEach(figure => {if (!records.has(figure)) attach(figure);});
    for (const record of records.values()) sync(record);
  }
  function boot() {
    stage = document.querySelector('#stage');
    if (!stage) return;
    motion = typeof window.deck?.motion === 'boolean' ? window.deck.motion : motion;
    observer = new MutationObserver(reconcile);
    observer.observe(stage, {childList:true, subtree:true});
    reconcile();
  }
  window.cleanupFoundation = function () {
    suspended = true;
    continuation = null;
    for (const record of [...records.values()]) detach(record);
    return previousCleanup?.();
  };
  window.onFoundationMotion = function (enabled) {
    previousMotion?.(enabled);
    motion = enabled === true;
    for (const record of records.values()) {
      if (motion) {
        record.blocked = false;
        if (record.failed) {record.failed = false;record.video.load();}
      }
      sync(record);
    }
  };
  document.addEventListener('visibilitychange', () => {for (const record of records.values()) sync(record);});
  document.addEventListener('foundations:slidechange', () => {suspended = false;reconcile();});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
