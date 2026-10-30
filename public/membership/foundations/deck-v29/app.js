(() => {
'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lines=s=>String(s??'').split('\n').filter(Boolean);
const br=s=>esc(s).replace(/\n/g,'<br>').replace(/≠/g,'<span class="math-symbol">≠</span>');
const img=(name,cls='',alt='')=>'<img class="'+cls+'" src="assets/figma/'+name+'.webp" alt="'+esc(alt)+'" draggable="false">';
const label=s=>'<p class="eyebrow">'+esc(s)+'</p>';
const title=(s,cls='')=>'<h1 id="sceneTitle" class="'+cls+'">'+br(s)+'</h1>';
const para=(s,cls='')=>'<p class="'+cls+'">'+br(s)+'</p>';
const foot=s=>'<p class="scene-foot">'+br(s)+'</p>';
const list=(a,cls='')=>'<ul class="'+cls+'">'+a.map(s=>'<li>'+br(s)+'</li>').join('')+'</ul>';
const head=t=>'<div class="scene-head">'+label(t[0])+title(t[1])+'</div>';
const section=(cls,html)=>'<section class="scene '+cls+'" aria-labelledby="sceneTitle">'+html+'</section>';
const bg=(name)=>img(name,'scene-image');
const pairs=(a)=>a.reduce((out,v,i)=>{if(i%2===0)out.push([v,a[i+1]]);return out;},[]);
const state={};
let interval=null;
let activeSlide=-1, distinctionStep=0, storyShare=28;
let remaining=600,deadline=0,running=false;
const stepButtons=(items,selected=0,cls='')=>'<div class="step-buttons '+cls+'">'+items.map((s,i)=>'<button data-step="'+i+'" aria-pressed="'+(i===selected)+'"><small>'+String(i+1).padStart(2,'0')+'</small><span>'+esc(s)+'</span></button>').join('')+'</div>';
function paperPair(t,a=2,cls=''){
 return '<div class="paper-pair '+cls+'"><article>'+label(t[a])+list(lines(t[a+1]))+'</article><article>'+label(t[a+2])+list(lines(t[a+3]))+'</article></div>';
}
function examples(t,index){
 const offset=index===23?1:0, choices=lines(t[4+offset]);
 return section('example paper',head(t)+(offset?para(t[2],'intro'): '')+'<div class="example-layout"><div class="event-sheet">'+label(t[2+offset])+'<h2 class="event-title">'+br(t[3+offset])+'</h2>'+img('archive-folders','folder-art')+'</div><div class="story-stack">'+label('POSSIBLE STORIES')+choices.map((s,i)=>'<button class="story-line" data-story="'+i+'" aria-pressed="false"><span>'+String(i+1).padStart(2,'0')+'</span><strong>'+esc(s)+'</strong><i>↗</i></button>').join('')+'<p class="interaction-note">SELECT A STORY TO BRING IT FORWARD</p></div></div>');
}
window.renderFoundation=function(index){
 const s=FOUNDATIONS[index],t=s.texts.filter(v=>!/^\d+$/.test(v)&&!['→','↓'].includes(v));
 const n=index+1;
 switch(n){
 case 1:return section('cover dark',bg('couch')+'<div class="cover-top">'+label('RU/NED / FOUNDATIONS 01')+title('FOUNDATIONS')+'<span class="cover-number" aria-hidden="true">01</span></div><div class="cover-bottom"><p class="hand">'+esc(t[2])+'</p><button class="text-action" data-go="1">BEGIN <span>↗</span></button></div>');
 case 2:return section('purpose paper',head(t)+'<div class="purpose-body"><article>'+label(t[2])+para(t[3])+'</article><span class="hand">+ </span><article>'+label(t[4])+para(t[5])+'</article></div>'+img('collage','purpose-art'));
 case 3:return section('route sage',head(t)+'<nav class="route-list" aria-label="Presentation chapters">'+[[3,'WHY RUINED'],[5,'WHAT “RUINED” MEANS'],[8,'WHY FOUNDATIONS'],[13,'A FOUNDER STORY'],[16,'EVENTS VS. STORIES'],[20,'YOUR RUINED TIMELINE + WHAT’S NEXT']].map((x,i)=>'<button data-go="'+x[0]+'"><span>0'+(i+1)+'</span><strong>'+x[1]+'</strong><i>↗</i></button>').join('')+'</nav>'+'<img class="route-stripes" src="assets/photoshop/straps-bracket.webp" alt="" draggable="false">');
 case 4:return section('origins dark',bg('black-texture')+head(t)+para(t[2],'origins-statement')+'<div class="word-field">'+t.slice(3).map((x,i)=>'<span style="--i:'+i+'">'+esc(x)+'</span>').join('')+'</div>');
 case 5:return section('thesis dark',bg('flowers')+'<div class="thesis-copy">'+label(t[0])+para(t[1],'subhead')+title(t[2],'quote-title')+foot(t[3])+'</div>');
 case 6:return section('definition paper',head(t)+paperPair(t)+'<span class="hand annotation">the story is not finished.</span>');
 case 7:return section('belong paper',head(t)+'<div class="belong-body">'+list(lines(t[2]))+'<aside>'+label(t[3])+para(t[4])+'</aside></div>'+img('frame-1167-366','botanical-art'));
 case 8:return section('fear dark',bg('doorway')+'<div class="fear-copy">'+head(t)+para(t.at(-1),'intro')+'</div><div class="fear-words">'+t.slice(2,-1).map((x,i)=>'<button data-fear="'+i+'" aria-pressed="false">'+esc(x)+'</button>').join('')+'</div>');
 case 9:return section('chapter chapter-foundations sage',bg('sage-paper')+'<img class="chapter-stripes" src="assets/photoshop/straps-bracket.webp" alt="" draggable="false">'+'<span class="chapter-index" aria-hidden="true">03</span>'+label('03 / FOUNDATIONS')+title(t[0]) +para(t[1],'chapter-copy'));
 case 10:return section('welcome paper',head(t)+'<div class="welcome-layout"><figure class="photo-print">'+img('couch','','A purple couch in an open desert landscape')+'<figcaption>RU/NED — FOUNDATIONS 01</figcaption></figure><div>'+'<h2 class="statement-title">'+br(t[2])+'</h2>'+foot(t[3])+'</div></div>');
 case 11:return section('community paper',head(t)+para(t[2],'community-equation')+'<div class="shared-words">'+t.slice(3).map((x,i)=>'<button data-shared="'+i+'" aria-pressed="false"><small>0'+(i+1)+'</small><strong>'+esc(x)+'</strong><span>+</span></button>').join('')+'</div>');
 case 12:return section('culture paper',head(t)+'<div class="culture-list">'+pairs(t.slice(2)).map((p,i)=>'<button data-culture="'+i+'" aria-pressed="false"><span>0'+(i+1)+'</span><strong>'+esc(p[0])+'</strong><em>'+esc(p[1])+'</em><i>↗</i></button>').join('')+'</div>');
 case 13:{
 const ps=pairs(t.slice(2,-1));return section('relationships sage',head(t)+'<div class="relationship-path">'+ps.map((p,i)=>'<button data-relationship="'+i+'" aria-pressed="'+(i===0)+'"><small>0'+(i+1)+'</small><strong>'+esc(p[0])+'</strong><span>'+esc(p[1])+'</span></button>').join('')+'</div>'+foot(t.at(-1)));
 }
 case 14:return section('founder dark',bg('doorway')+title(t[1]));
 case 15:return section('story paper',head(t)+'<div class="story-file">'+label(t[2])+list(t.slice(3),'story-prompts')+'</div>'+img('archive-folders','story-folder'));
 case 16:return section('timeline-intro paper',bg('falling-figure')+title(t[0]));
 case 17:{
 const ps=pairs(t.slice(2,-1));const sel=state[index]||0;
 return section('framework sage',head(t)+'<div class="framework-focus" aria-live="polite"><span class="framework-number" aria-hidden="true">'+String(sel+1).padStart(2,'0')+'</span><div><h2 id="frameworkWord">'+esc(ps[sel][0])+'</h2><p id="frameworkDescription">'+esc(ps[sel][1])+'</p></div></div>'+stepButtons(ps.map(p=>p[0]),sel)+foot(t.at(-1)));
 }
 case 18:return section('distinction paper', '<div class="comparison-heading">'+title(t[1])+label(t[0])+'</div><div id="distinctionContent"></div>');
 case 19:case 20:case 24:return examples(t,index);
 case 21:return section('exercise dark',bg('black-texture')+head(t)+'<div class="exercise-questions">'+lines(t[2]).map((x,i)=>x==='↓'?'<span class="hand down-arrow">↓</span>':'<p style="--i:'+i+'">'+esc(x)+'</p>').join('')+'</div>'+foot(t[3]));
 case 22:return section('categories paper',head(t)+para(t[2],'intro')+'<div class="category-cloud">'+t.slice(3,-1).map((x,i)=>'<button data-category="'+i+'" aria-pressed="false">'+esc(x)+'</button>').join('')+'</div>'+foot(t.at(-1)));
 case 23:return section('date sage','<div class="scene-head">'+title(t[1])+'</div>'+'<div class="date-field">'+label(t[2])+'<div class="date-type"><span>MONTH</span><i>/</i><span>YEAR</span></div><div class="date-rule"><i></i></div><p class="hand">close is good enough.</p></div>'+foot(t[3]));
 case 25:return section('meaning paper',head(t)+para(t[2],'intro')+paperPair(t,3));
 case 26:return section('then-now paper',head(t)+'<div class="then-now-controls"><button data-view="then" aria-pressed="true">THEN</button><button data-view="now" aria-pressed="false">NOW ↗</button></div><div class="time-sheet" id="timeSheet"><span class="sheet-corner">↗</span>'+label(t[2])+para(t[3])+'</div>'+foot(t[6]));
 case 27:return section('patterns dark',bg('black-texture')+head(t)+'<div class="pattern-lines">'+t.slice(2).map((x,i)=>'<button data-pattern="'+i+'" aria-pressed="false"><span>0'+(i+1)+'</span>'+esc(x)+'</button>').join('')+'</div>');
 case 28:return section('timer-scene dark',bg('blur')+title(t[1],'timer-title')+'<div class="timer-face" id="timerFace" role="timer" aria-label="Exercise timer">10:00</div><div class="timer-actions"><button id="timerToggle" class="text-action">START TIMER <span>▷</span></button><button id="timerReset">RESET ↺</button></div>');
 case 29:{
 const q=lines(t[2]),sel=state[index]||0;
 return section('reflection paper',head(t)+'<div class="reflection-focus"><span class="hand question-number">'+String(sel+1).padStart(2,'0')+'</span><h2 id="reflectionQuestion" aria-live="polite">'+esc(q[sel])+'</h2></div>'+stepButtons(q.map((_,i)=>'QUESTION '+(i+1)),sel,'reflection-steps')+foot(t[3]));
 }
 case 30:return section('chapter chapter-next sage',bg('sage-paper')+'<img class="chapter-stripes" src="assets/photoshop/straps-bracket.webp" alt="" draggable="false">'+'<span class="chapter-index" aria-hidden="true">05</span>'+title(t[0]));
 case 31:return section('review paper',head(t)+paperPair(t));
 case 32:return section('difference paper',bg('paper')+'<h1 id="sceneTitle" class="sr-only">Learning to see the difference</h1><div class="poem">'+t[0].split('\n\n').map((x,i)=>'<p style="--i:'+i+'">'+esc(x)+'</p>').join('')+'</div>');
 case 33:return section('finish paper',head(t)+'<div class="finish-layout"><article>'+label(t[2])+para(t[3])+'</article><article>'+label(t[4])+list(lines(t[5]))+'</article></div><p class="hand curious">'+esc(t[6])+'</p>');
 case 34:return section('outro dark',bg('frame-1163-357')+label(t[0])+title(t[1])+'<div class="outro-copy">'+para(t[2],'outro-statement')+para(t[3])+'</div><div class="outro-bottom"><p class="hand">'+esc(t[4])+'</p><button data-go="0" class="text-action">BACK TO THE BEGINNING <span>↺</span></button></div>');
 default:return section('paper',head(t)+list(t.slice(2)));
 }
};
function selectAll(selector,el){$$(selector).forEach(x=>x.setAttribute('aria-pressed',x===el?'true':'false'));}
function cut(el){if(window.deck?.motion)el.animate([{transform:'translate(-4px,3px) rotate(-.8deg)'},{transform:'translate(2px,-1px) rotate(.4deg)'},{transform:'none'}],{duration:260,easing:'steps(3,end)'});}
function timerText(){const v=running?Math.max(0,Math.ceil((deadline-Date.now())/1000)):remaining;return String(Math.floor(v/60)).padStart(2,'0')+':'+String(v%60).padStart(2,'0');}
function updateTimer(){if(running&&Date.now()>=deadline){running=false;remaining=0;clearInterval(interval);}const face=$('#timerFace');if(face){face.textContent=timerText();const seconds=running?Math.max(0,Math.ceil((deadline-Date.now())/1000)):remaining;face.style.setProperty('--time-elapsed',((600-seconds)/600*100)+'%');}const b=$('#timerToggle');if(b)b.innerHTML=(running?'PAUSE TIMER <span>Ⅱ</span>':remaining===0?'RESTART TIMER <span>↺</span>':'START TIMER <span>▷</span>');}
function emitInteraction(){document.dispatchEvent(new CustomEvent('foundations:interaction',{detail:{slide:17,value:{slider:storyShare,phase:distinctionStep}}}));}
function paintDistinction(){
 const t=FOUNDATIONS[17].texts;
 const host=$('#distinctionContent');if(!host)return;
 if(distinctionStep===1){host.innerHTML='<div class="distinction-coda"><p>'+br(t[6])+'</p></div><div class="comparison-bottom"><button class="compare-return" id="compareReturn">← EVENT / STORY</button><span class="panel-count">02 / 02</span></div>';$('#compareReturn').onclick=()=>{distinctionStep=0;paintDistinction();emitInteraction();};return;}
 host.innerHTML='<div class="comparison-stage" id="comparisonStage" data-no-swipe><article class="compare-panel event-panel">'+label(t[2])+'<p class="compare-phrase">WHAT ACTUALLY<br>HAPPENED.</p></article><article class="compare-panel story-panel">'+label(t[4])+'<p class="compare-phrase">WHAT I DECIDED<br>IT MEANT.</p></article><div class="compare-divider" aria-hidden="true"><span>↔</span></div></div><div class="comparison-controls"><div class="slider-labels"><span>EVENT</span><span>STORY</span></div><input id="eventStorySlider" type="range" min="8" max="92" step="1" value="'+storyShare+'" aria-label="Event and story balance" aria-valuetext="'+(100-storyShare)+' percent event, '+storyShare+' percent story"><span class="slider-hint">DRAG TO SHIFT THE BALANCE</span></div>';
 updateSplit();$('#eventStorySlider').oninput=e=>{storyShare=+e.currentTarget.value;updateSplit();emitInteraction();};
 const divider=$('.compare-divider');divider.onpointerdown=e=>{e.preventDefault();e.stopPropagation();divider.setPointerCapture(e.pointerId);};divider.onpointermove=e=>{if(!divider.hasPointerCapture(e.pointerId))return;const r=$('#comparisonStage').getBoundingClientRect();storyShare=Math.max(8,Math.min(92,Math.round(100-(e.clientX-r.left)/r.width*100)));updateSplit();emitInteraction();};divider.onpointerup=e=>{if(divider.hasPointerCapture(e.pointerId))divider.releasePointerCapture(e.pointerId);};
}
function updateSplit(){const panel=$('#comparisonStage');if(!panel)return;panel.style.setProperty('--story-share',storyShare+'%');panel.dataset.dominant=storyShare>55?'story':'event';panel.dataset.eventHidden=storyShare>70?'true':'false';panel.dataset.storyHidden=storyShare<30?'true':'false';const input=$('#eventStorySlider');if(input){input.value=storyShare;input.setAttribute('aria-valuetext',(100-storyShare)+' percent event, '+storyShare+' percent story');}}
window.getFoundationInteraction=()=>activeSlide===17?{slider:storyShare,phase:distinctionStep}:null;
window.applyFoundationInteraction=value=>{if(activeSlide!==17||!value)return;if(Number.isFinite(value.slider))storyShare=Math.max(8,Math.min(92,value.slider));if(value.phase===0||value.phase===1)distinctionStep=value.phase;paintDistinction();};
window.canAdvanceFoundation=delta=>activeSlide===17&&(delta>0?distinctionStep<1:distinctionStep>0);
window.advanceFoundation=delta=>{if(!window.canAdvanceFoundation(delta))return false;distinctionStep+=delta>0?1:-1;paintDistinction();emitInteraction();return true;};
window.cleanupFoundation=()=>{clearInterval(interval);interval=null;};
window.bindFoundation=function(index){
 activeSlide=index;if(index===17){distinctionStep=0;storyShare=28;paintDistinction();}
 const t=FOUNDATIONS[index].texts.filter(v=>!/^\d+$/.test(v)&&!['→','↓'].includes(v));
 $$('[data-go]').forEach(b=>b.onclick=()=>window.deck.goSource(Number(b.dataset.go)));
 ['fear','shared','culture','relationship','story','pattern'].forEach(kind=>$$('[data-'+kind+']').forEach(b=>b.onclick=()=>{selectAll('[data-'+kind+']',b);cut(b);}));
 $$('[data-category]').forEach(b=>b.onclick=()=>{b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')!=='true'?'true':'false');cut(b);});
 if(index===16){const ps=pairs(t.slice(2,-1));$$('[data-step]').forEach(b=>b.onclick=()=>{const i=+b.dataset.step;state[index]=i;selectAll('[data-step]',b);$('#frameworkWord').textContent=ps[i][0];$('#frameworkDescription').textContent=ps[i][1];$('.framework-number').textContent=String(i+1).padStart(2,'0');cut($('.framework-focus'));});}
 if(index===25){$$('[data-view]').forEach(b=>b.onclick=()=>{const isNow=b.dataset.view==='now';selectAll('[data-view]',b);$('#timeSheet').classList.toggle('now',isNow);$('#timeSheet').innerHTML='<span class="sheet-corner">↗</span>'+label(isNow?t[4]:t[2])+para(isNow?t[5]:t[3]);cut($('#timeSheet'));});}
 if(index===27){updateTimer();if(running)interval=setInterval(updateTimer,250);$('#timerToggle').onclick=()=>{if(running){remaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));running=false;clearInterval(interval);}else{if(remaining===0)remaining=600;deadline=Date.now()+remaining*1000;running=true;interval=setInterval(updateTimer,250);}updateTimer();};$('#timerReset').onclick=()=>{running=false;remaining=600;clearInterval(interval);updateTimer();};}
 if(index===28){const q=lines(t[2]);$$('[data-step]').forEach(b=>b.onclick=()=>{const i=+b.dataset.step;state[index]=i;selectAll('[data-step]',b);$('#reflectionQuestion').textContent=q[i];$('.question-number').textContent=String(i+1).padStart(2,'0');cut($('.reflection-focus'));});}
};
})();
