(function () {
  'use strict';
  const entries = window.FoundationExperiments ??= {};
  const image = (src, cls) => `<img class="${cls}" src="${src}" alt="" draggable="false">`;
  const core = c => `<p class="ph-core">${c.esc(c.source.texts[2])}</p>`;
  const head = c => `<header class="ph-head"><div class="er-hidden-heading"><p class="ph-overline">${c.esc(c.source.kicker)}</p><h1 id="sceneTitle">${c.esc(c.source.title)}</h1></div><button class="ph-context-open" data-ph-context aria-label="More about ${c.esc(c.source.title)}">MORE ↗</button></header>`;
  const context = (c, indexes) => `<aside class="ph-context" data-ph-context-panel hidden role="region" aria-label="${c.esc(c.source.title)} — context"><p class="ph-context-core">${c.esc(c.source.texts[2])}</p><div class="ph-context-copy" tabindex="0" role="region" aria-label="Supporting context">${indexes.map(i => `<p>${c.esc(c.source.texts[i])}</p>`).join('')}</div><button data-ph-context-close>← BACK</button></aside>`;
  const section = (c, cls, body, contextIndexes, scenery = '') => `<section class="scene experiment ph-scene ${cls}" aria-labelledby="sceneTitle" data-no-swipe>${scenery}${head(c)}<div class="ph-body" data-ph-main>${body}</div>${context(c, contextIndexes)}</section>`;
  function bindContext(c) {
    const open = c.root.querySelector('[data-ph-context]');
    const close = c.root.querySelector('[data-ph-context-close]');
    open.addEventListener('click', () => { c.set({context:1}); close.focus({preventScroll:true}); });
    close.addEventListener('click', () => { c.set({context:0}); open.focus({preventScroll:true}); });
    c.root.querySelector('.ph-scene').addEventListener('keydown', event => {
      if (event.key === 'Escape' && c.state.context) { event.preventDefault(); c.set({context:0}); open.focus({preventScroll:true}); }
    });
  }
  function paintContext(c) {
    const showing = c.state.context >= .5;
    c.root.querySelector('[data-ph-context-panel]').hidden = !showing;
    c.root.querySelector('[data-ph-main]').inert = showing;
    c.root.querySelector('.ph-head').inert = showing;
  }
  function press(c, selector, value, key) {
    c.root.querySelectorAll(selector).forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset[key]) === value)));
  }

  entries[1] = {
    defaults:{context:0}, ranges:{context:[0,1]},
    render(c) {
      return section(c, 'ph-identity', `<div class="ph-identity-statement">${core(c)}</div>`, [4], image('assets/figma/couch.webp','ph-cover-photo'));
    },
    bind:bindContext, paint:paintContext
  };

  entries[2] = {
    defaults:{context:0,cause:0,change:0}, ranges:{context:[0,1],cause:[0,1],change:[0,1]},
    render(c) {
      const t=c.source.texts;
      const diagram=`<div class="ph-plan-field" data-ph-plan data-cause="0" data-changed="false"><svg viewBox="0 0 1000 260" preserveAspectRatio="none" aria-hidden="true"><path class="ph-plan-original" d="M60 180H940"/><path class="ph-plan-live" data-ph-plan-line d="M60 180H940"/><path class="ph-plan-branch" data-ph-plan-branch d="M520 180H940"/><rect class="ph-plan-obstacle" data-ph-obstacle x="495" y="30" width="72" height="145"/><circle class="ph-plan-start" cx="60" cy="180" r="13"/><circle class="ph-plan-end" data-ph-plan-end cx="940" cy="180" r="18"/><path class="ph-plan-choice" data-ph-plan-choice d="M500 205L540 180L500 155"/></svg></div>`;
      const controls=`<div class="ph-controls ph-plan-controls"><button data-ph-cause="0" aria-pressed="false">${c.esc(t[4])}</button><button data-ph-cause="1" aria-pressed="false">${c.esc(t[6])}</button><button class="ph-reset" data-ph-plan-reset aria-label="Reset the plan">↺</button></div>`;
      return section(c,'ph-change',core(c)+diagram+controls,[3]);
    },
    bind(c) {
      bindContext(c);
      c.root.querySelectorAll('[data-ph-cause]').forEach(button => button.addEventListener('click',()=>c.set({cause:Number(button.dataset.phCause),change:1})));
      c.root.querySelector('[data-ph-plan-reset]').addEventListener('click',()=>c.set({change:0}));
    },
    paint(c) {
      paintContext(c);
      const cause=Math.round(c.state.cause), changed=c.state.change>=.5;
      const paths=changed?(cause===0?['M60 180H420Q450 180 450 210V225H625V105H940','M520 180H940',105]:['M60 180H485Q520 180 555 145L700 55H940','M520 180H940',55]):['M60 180H940','M520 180H940',180];
      const field=c.root.querySelector('[data-ph-plan]');field.dataset.cause=String(cause);field.dataset.changed=String(changed);
      c.root.querySelector('[data-ph-plan-line]').setAttribute('d',paths[0]);
      c.root.querySelector('[data-ph-plan-branch]').setAttribute('d',paths[1]);
      c.root.querySelector('[data-ph-plan-end]').setAttribute('cy',String(paths[2]));
      c.root.querySelectorAll('[data-ph-cause]').forEach(button=>button.setAttribute('aria-pressed',String(changed&&Number(button.dataset.phCause)===cause)));
    }
  };

  const arrangements=[[[95,35,0],[95,108,0],[95,181,0],[95,254,0]],[[80,30,0],[330,60,90],[80,285,0],[70,60,90]]];
  entries[3] = {
    defaults:{context:0,arrangement:0}, ranges:{context:[0,1],arrangement:[0,1]},
    render(c) {
      const material=`<div class="ph-intact-field"><svg viewBox="0 0 400 340" role="img" aria-label="Four intact pieces can make two different arrangements"><defs><pattern id="ph-intact-material" patternUnits="userSpaceOnUse" width="400" height="340"><image href="assets/photoshop/polymailer-black.webp" width="400" height="340" preserveAspectRatio="xMidYMid slice"/></pattern></defs>${arrangements[0].map((_,i)=>`<rect class="ph-intact-piece" data-ph-piece="${i}" width="210" height="38" fill="url(#ph-intact-material)"/>`).join('')}</svg></div>`;
      return section(c,'ph-intact',`<div class="ph-intact-composition">${core(c)}${material}</div><div class="ph-controls ph-intact-controls"><button data-ph-arrangement="0" aria-pressed="true">AS IT IS</button><span aria-hidden="true">↔</span><button data-ph-arrangement="1" aria-pressed="false">ANOTHER WAY</button></div>`,[3]);
    },
    bind(c) {
      bindContext(c);
      c.root.querySelectorAll('[data-ph-arrangement]').forEach(button=>button.addEventListener('click',()=>c.set({arrangement:Number(button.dataset.phArrangement)})));
    },
    paint(c) {
      paintContext(c);const value=Math.round(c.state.arrangement);
      c.root.querySelectorAll('[data-ph-piece]').forEach(piece=>{const [x,y,angle]=arrangements[value][Number(piece.dataset.phPiece)];piece.style.transform=`translate(${x}px, ${y}px) rotate(${angle}deg)`;});
      press(c,'[data-ph-arrangement]',value,'phArrangement');
    }
  };

  entries[4] = {
    defaults:{context:0,direction:0}, ranges:{context:[0,1],direction:[0,1]},
    render(c) {
      const material='<div class="ph-purpose-material" aria-hidden="true"></div>'+image('assets/photoshop/straps-bracket.webp','ph-purpose-straps');
      return section(c,'ph-purpose',`${core(c)}<div class="ph-controls ph-purpose-controls"><button data-ph-direction="0" aria-pressed="true">${c.esc(c.source.texts[5])}</button><button data-ph-direction="1" aria-pressed="false">${c.esc(c.source.texts[6])} <span aria-hidden="true">↗</span></button></div>`,[3,4],material);
    },
    bind(c) {
      bindContext(c);
      c.root.querySelectorAll('[data-ph-direction]').forEach(button=>button.addEventListener('click',()=>c.set({direction:Number(button.dataset.phDirection)})));
    },
    paint(c) {
      paintContext(c);const value=Math.round(c.state.direction);
      c.root.querySelector('.ph-purpose').style.setProperty('--ph-direction',String(value));
      press(c,'[data-ph-direction]',value,'phDirection');
    }
  };

  const outerPieces=[[30,28],[340,45],[28,278],[368,275],[205,320]];
  const innerArrangements=[[[155,110],[240,145],[185,225]],[[160,100],[160,164],[160,228]],[[145,210],[205,150],[265,90]]];
  entries[5] = {
    defaults:{context:0,principle:0,shape:0}, ranges:{context:[0,1],principle:[0,2],shape:[0,2]},
    render(c) {
      const t=c.source.texts;
      const controls=`<div class="ph-controls ph-principle-controls">${[4,6,8].map((i,n)=>`<button data-ph-principle="${n}" aria-pressed="${n===0}">${c.esc(t[i])}</button>`).join('')}</div>`;
      const graphic=`<div class="ph-principle-field" data-ph-principle-field data-principle="0"><svg viewBox="0 0 450 380" role="img" aria-label="Some parts of the composition can be influenced while the surrounding circumstances remain"><rect class="ph-influence-boundary" x="110" y="60" width="215" height="245"/><g class="ph-circumstances">${outerPieces.map(([x,y])=>`<rect x="${x}" y="${y}" width="42" height="42"/>`).join('')}</g><g class="ph-influence-pieces">${innerArrangements[0].map((_,i)=>`<rect data-ph-owned="${i}" width="42" height="42"/>`).join('')}</g></svg><button class="ph-shape-button" data-ph-shape hidden>SHAPE IT ↗</button></div>`;
      return section(c,'ph-principles',`${core(c)}${controls}<div class="ph-principle-composition">${graphic}<p class="ph-principle-definition" data-ph-definition>${c.esc(t[5])}</p></div>`,[3]);
    },
    bind(c) {
      bindContext(c);
      c.root.querySelectorAll('[data-ph-principle]').forEach(button=>button.addEventListener('click',()=>{const principle=Number(button.dataset.phPrinciple);c.set({principle,...(principle===2&&c.state.shape===0?{shape:1}:{})});}));
      c.root.querySelector('[data-ph-shape]').addEventListener('click',()=>c.set({shape:(Math.round(c.state.shape)+1)%3}));
    },
    paint(c) {
      paintContext(c);const principle=Math.round(c.state.principle), shape=principle===2?Math.round(c.state.shape):0;
      c.root.querySelector('[data-ph-principle-field]').dataset.principle=String(principle);
      c.root.querySelector('[data-ph-definition]').textContent=c.source.texts[5+principle*2];
      c.root.querySelector('[data-ph-shape]').hidden=principle!==2;
      c.root.querySelectorAll('[data-ph-owned]').forEach(piece=>{const [x,y]=innerArrangements[shape][Number(piece.dataset.phOwned)];piece.style.transform=`translate(${x}px, ${y}px)`;});
      press(c,'[data-ph-principle]',principle,'phPrinciple');
    }
  };

  entries[7] = {
    defaults:{context:0}, ranges:{context:[0,1]},
    render(c) {
      const statements=c.source.texts[2].match(/[^.!?]+[.!?]*/g)?.map(x=>x.trim())??[c.source.texts[2]];
      return section(c,'ph-authors',`<p class="ph-authors-statement">${statements.map(sentence=>`<span>${c.esc(sentence)}</span>`).join(' ')}</p><div class="ph-authors-rule" aria-hidden="true"><i></i><i></i><i></i></div>`,[3,4]);
    },
    bind:bindContext, paint:paintContext
  };

  window.FoundationPhilosophyAudit={ids:[1,2,3,4,5,7],arrangements,innerArrangements,outerPieces};
})();
