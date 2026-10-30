(function () {
  'use strict';
  const entries = window.FoundationExperiments ??= {};
  const folders = [
    {name:'SEE', asset:'assets/folders/see.webp', first:1},
    {name:'FACE', asset:'assets/folders/face.webp', first:2},
    {name:'CUT', asset:'assets/folders/cut.webp', first:4},
    {name:'GROW', asset:'assets/folders/grow.webp', first:5}
  ];
  const folderForStep = [-1,0,1,1,2,3];
  const stepOf = c => Math.max(0,Math.min(5,Math.round(c.state.step)));
  const image = (asset, cls) => `<img class="${cls}" src="${asset}" alt="" draggable="false">`;
  function render(c) {
    const t=c.source.texts;
    const pieces=folders.map((folder,i)=>`<button type="button" class="mf-folder mf-folder-${i}" data-mf-folder="${i}" aria-label="Open ${folder.name} folder" aria-expanded="false" aria-controls="mfQuestion" style="--folder-index:${i}">${image(folder.asset,'mf-folder-back')}${image(folder.asset,'mf-folder-front')}</button>`).reverse().join('');
    const sheets=t.slice(3).map((copy,i)=>`<div class="mf-sheet" data-mf-sheet="${i+1}" aria-hidden="true"><span class="mf-sheet-number er-hidden-heading" aria-hidden="true">${c.pad(i+1)} / 05</span><p class="mf-question">${c.esc(copy)}</p></div>`).join('');
    const tabs=folders.map((folder,i)=>`<button type="button" class="mf-tab mf-tab-${i}" data-mf-folder="${i}" aria-label="Open ${folder.name} folder" aria-expanded="false" aria-controls="mfQuestion"><span>${folder.name}</span><i aria-hidden="true">↗</i></button>`).join('');
    return `<section class="scene experiment mf-archive" aria-labelledby="sceneTitle" data-mf-scene data-mf-step="0">
      <header class="mf-head"><div><p class="mf-overline er-hidden-heading">${c.esc(c.source.kicker)}</p><h1 id="sceneTitle">${c.esc(c.source.title)}</h1></div><button type="button" class="mf-close" data-mf-close disabled aria-label="Close the folder and return to the archive">← CLOSE</button></header>
      <div class="mf-body"><div class="mf-field" data-no-swipe>
        <figure class="mf-portrait"><img src="assets/people/mitch-ford-couch.webp" alt="Mitch Ford sitting on the purple Ruined couch in the desert beneath a wide, cloud-filled sky." draggable="false"></figure>
        <div class="mf-folders" aria-label="Story folders">${pieces}</div>
        <div class="mf-paper-dock" id="mfQuestion" role="region" aria-label="Selected story question" aria-live="polite" aria-atomic="true">${sheets}</div>
        <div class="mf-face-pages" data-mf-face-pages hidden aria-label="FACE folder sheets"><button type="button" data-mf-page="2" aria-label="First FACE sheet: ${c.esc(t[4])}" aria-pressed="false">01</button><span aria-hidden="true">/</span><button type="button" data-mf-page="3" aria-label="Second FACE sheet: ${c.esc(t[5])}" aria-pressed="false">02 <span aria-hidden="true">↗</span></button></div>
      </div><nav class="mf-tabs" aria-label="Open a story folder">${tabs}</nav></div>
    </section>`;
  }
  function bind(c) {
    c.root.querySelectorAll('[data-mf-folder]').forEach(button=>button.addEventListener('click',()=>{
      const folder=Number(button.dataset.mfFolder);
      c.set({step:folders[folder].first});
    }));
    c.root.querySelectorAll('[data-mf-page]').forEach(button=>button.addEventListener('click',()=>c.set({step:Number(button.dataset.mfPage)})));
    c.root.querySelector('[data-mf-close]').addEventListener('click',()=>{
      const selected=folderForStep[stepOf(c)];
      c.set({step:0});
      c.root.querySelector(`.mf-tab[data-mf-folder="${selected}"]`)?.focus({preventScroll:true});
    });
    c.root.querySelector('[data-mf-scene]').addEventListener('keydown',event=>{
      if(event.key==='Escape'&&stepOf(c)>0){
        event.preventDefault();event.stopPropagation();
        const selected=folderForStep[stepOf(c)];
        c.set({step:0});
        c.root.querySelector(`.mf-tab[data-mf-folder="${selected}"]`).focus({preventScroll:true});
      }
    });
  }
  function paint(c) {
    const step=stepOf(c), selected=folderForStep[step], scene=c.root.querySelector('[data-mf-scene]');
    scene.dataset.mfStep=String(step);scene.dataset.mfSelected=String(selected);
    scene.classList.toggle('is-open',step>0);
    c.root.querySelectorAll('[data-mf-folder]').forEach(button=>{
      const active=Number(button.dataset.mfFolder)===selected;
      button.classList.toggle('is-selected',active);
      button.setAttribute('aria-expanded',String(active));
      button.setAttribute('aria-label',`${active?'Selected':'Open'} ${folders[Number(button.dataset.mfFolder)].name} folder`);
    });
    c.root.querySelectorAll('[data-mf-sheet]').forEach(sheet=>{
      const active=Number(sheet.dataset.mfSheet)===step;
      sheet.classList.toggle('is-selected',active);
      sheet.setAttribute('aria-hidden',String(!active));
    });
    c.root.querySelector('.mf-portrait').setAttribute('aria-hidden',String(step>0));
    c.root.querySelector('[data-mf-close]').disabled=step===0;
    c.root.querySelector('[data-mf-face-pages]').hidden=selected!==1;
    c.root.querySelectorAll('[data-mf-page]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.mfPage)===step)));
  }
  entries[15]={
    defaults:{step:0},ranges:{step:[0,5]},render,bind,paint,
    canAdvance(c,delta){const step=stepOf(c);return delta>0?step<5:delta<0?step>0:false;},
    advance(c,delta){const step=stepOf(c);if(!delta||(delta>0?step===5:step===0))return false;c.set({step:step+(delta>0?1:-1)});return true;}
  };
  window.FoundationFoldersAudit={folderForStep:[...folderForStep],folders:folders.map(({name,first})=>({name,first}))};
})();
