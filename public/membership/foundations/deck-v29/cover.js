(function () {
  'use strict';
  const entries = window.FoundationExperiments ??= {};
  const philosophy = entries[1];
  if (!philosophy) return;

  function phase(c) { return c.state.phase >= .5 ? 1 : 0; }
  function show(c, value) { c.set({phase:value,context:0}); }

  entries[1] = {
    defaults:{...philosophy.defaults,phase:0},
    ranges:{...philosophy.ranges,phase:[0,1]},
    render(c) {
      const front = `<section class="scene cv-front" data-cover-front aria-labelledby="coverTitle">
        <img class="cv-photo" src="assets/figma/couch.webp" alt="" draggable="false">
        <div class="cv-top">
          <div class="cv-brand-row"><img class="cv-wordmark" src="assets/brand/ruined-wordmark.svg" alt="Ruined" draggable="false"></div>
          <h1 id="coverTitle">FOUNDATIONS</h1>
        </div>
        <span class="cv-number" aria-hidden="true">01</span>
        <div class="cv-bottom"><p class="cv-invitation">AFTER THE FEAR.</p><button class="cv-enter" data-cover-enter>ENTER <span aria-hidden="true">↗</span></button></div>
      </section>`;
      return `<div class="cv-opening" data-cover-phase="0">${front}<div class="cv-philosophy" data-cover-philosophy hidden>${philosophy.render(c)}</div></div>`;
    },
    bind(c) {
      philosophy.bind?.(c);
      c.root.querySelector('[data-cover-enter]').addEventListener('click',()=>show(c,1));
    },
    paint(c) {
      const value=phase(c), opening=c.root.querySelector('.cv-opening');
      const front=c.root.querySelector('[data-cover-front]'), statement=c.root.querySelector('[data-cover-philosophy]');
      const changed=Number(opening.dataset.coverPhase)!==value;
      const focused=document.activeElement;
      const focusWillHide=focused?.closest?.(value ? '[data-cover-front]' : '[data-cover-philosophy]');
      philosophy.paint?.(c);
      front.hidden=value===1;front.inert=value===1;
      statement.hidden=value===0;statement.inert=value===0;
      opening.dataset.coverPhase=String(value);
      if(changed){
        c.root.scrollTop=0;c.root.scrollLeft=0;
        if(focusWillHide)c.root.focus({preventScroll:true});
      }
    },
    canAdvance(c, delta) { return delta>0 ? phase(c)===0 : delta<0&&phase(c)===1; },
    advance(c, delta) {
      if(delta>0&&phase(c)===0){show(c,1);return true;}
      if(delta<0&&phase(c)===1){show(c,0);return true;}
      return false;
    },
    dispose(c) { philosophy.dispose?.(c); }
  };
  window.FoundationCoverAudit={slide:1,phases:{cover:0,philosophy:1},enter:'[data-cover-enter]'};
})();
