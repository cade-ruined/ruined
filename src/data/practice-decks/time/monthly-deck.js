import {ringSVG,escapeHTML as esc,announce} from './shared/common.js';
import {modes} from './data.js';

const modeNames=['SEE','FACE','CUT','GROW'];
export const MONTHLY_DECK_SCENES=Object.freeze(modeNames.flatMap(mode=>modes[mode].scenes.map((scene,number)=>Object.freeze({mode,number,kind:scene[0],title:scene[1],subtitle:scene[2],color:modes[mode].color}))));
const ringArt=ringSVG();
const defaultValue=kind=>kind==='rings'?42:0;
const validValue=(kind,value)=>{
 if(!Number.isFinite(value))return defaultValue(kind);
 if(kind==='rings')return Math.max(0,Math.min(168,Math.round(value)));
 if(kind==='grow')return Math.max(0,Math.min(6.5,Math.round(value*2)/2));
 if(kind==='compare')return Math.max(0,Math.min(2,Math.round(value)));
 if(kind==='cut')return Math.max(0,Math.min(3,Math.round(value)));
 return null;
};
export function cleanMonthlyDeckPosition(value){
 const index=Number.isInteger(value?.index)?Math.max(0,Math.min(MONTHLY_DECK_SCENES.length-1,value.index)):0;
 const kind=MONTHLY_DECK_SCENES[index].kind;
 return {index,interaction:['rings','grow','compare','cut'].includes(kind)?{value:validValue(kind,value?.interaction?.value)}:null};
}
function sceneContent(position){
 const s=MONTHLY_DECK_SCENES[position.index],value=position.interaction?.value;
 let control='',extra='';
 if(s.kind==='rings'){
  control=`<input type="range" data-month-deck-range aria-label="Hours of the week elapsed" min="0" max="168" value="${value}"><output data-month-deck-output>${value} / 168</output>`;
  extra='<div class="evidence-track"><span data-month-deck-evidence></span></div>';
 }
 if(s.kind==='compare'){
  control=['Relationships','Health','Community'].map((label,i)=>`<button type="button" data-month-deck-choice="${i}" aria-pressed="${i===value}">${label}</button>`).join('');
  extra='<div class="evidence-track"><span data-month-deck-evidence></span></div><p class="example-caption" data-month-deck-caption></p>';
 }
 if(s.kind==='cut'){
  control=['REMOVE','REDUCE','DELEGATE','AUTOMATE'].map((label,i)=>`<button type="button" data-month-deck-choice="${i}" aria-pressed="${i===value}">${label}</button>`).join('');
  extra='<div class="evidence-track"><span data-month-deck-evidence></span></div><p class="example-caption" data-month-deck-caption></p>';
 }
 if(s.kind==='grow'){
  control=`<input type="range" data-month-deck-range aria-label="Hours reinvested from reclaimed time" min="0" max="6.5" step=".5" value="${value}"><output data-month-deck-output>${value} / 6.5 H</output>`;
  extra='<div class="evidence-track"><span data-month-deck-evidence></span></div><p class="example-caption" data-month-deck-caption></p>';
 }
 return `${s.mode==='GROW'&&s.kind==='cover'?'<video class="bloom-video" src="/membership/practice/bloom.mp4" poster="/membership/practice/bloom.webp" autoplay muted loop playsinline aria-hidden="true"></video><div class="bloom-shade"></div>':''}<p class="scene-kicker">RUINED / ${s.mode} / DECEMBER</p><div class="time-art" aria-hidden="true">${ringArt}</div><h2>${esc(s.title)}</h2><p class="scene-sub">${esc(s.subtitle)}</p>${extra}${control?`<div class="scene-control">${control}</div>`:''}<span class="scene-index">${String(s.number+1).padStart(2,'0')} / 10</span>`;
}
function sceneClass(s){return `time-stage mt-stage ${s.kind}${['rings','compare','cut','grow'].includes(s.kind)?' interaction':''}${s.mode==='GROW'&&s.kind==='cover'?' bloom-cover':''}`;}
export function monthlyDeck({position}={}){
 const p=cleanMonthlyDeckPosition(position),s=MONTHLY_DECK_SCENES[p.index];
 return `<section class="mt-deck" aria-label="TIME supporting deck"><div class="mt-frame"><div class="${sceneClass(s)}" data-month-deck-stage style="--accent:${s.color}" tabindex="0" aria-label="TIME ${s.mode}, slide ${p.index+1} of ${MONTHLY_DECK_SCENES.length}">${sceneContent(p)}</div></div><footer class="mt-controls" aria-label="Deck controls"><button type="button" data-month-deck-prev ${p.index===0?'disabled':''}>← Previous</button><p data-month-deck-location aria-live="polite">${s.mode} · ${String(p.index+1).padStart(2,'0')} / ${MONTHLY_DECK_SCENES.length}</p><button type="button" class="fa-primary" data-month-deck-next>${p.index===MONTHLY_DECK_SCENES.length-1?'Back to assignment →':'Next slide →'}</button></footer><details class="mt-options"><summary>Options</summary><label>Go to slide<select data-month-deck-select aria-label="Choose a TIME slide">${MONTHLY_DECK_SCENES.map((scene,i)=>`<option value="${i}" ${i===p.index?'selected':''}>${String(i+1).padStart(2,'0')} · ${scene.mode} / ${esc(scene.title)}</option>`).join('')}</select></label><button type="button" data-month-deck-restart>Restart deck</button><button type="button" data-month-deck-fullscreen>Enlarge ↗</button><button type="button" data-month-deck-exit>Exit full screen</button></details></section>`;
}

export function mountMonthlyDeck(root,saved,{onChange,onReturn}={}){
 const deck=root.querySelector('.mt-deck');if(!deck)return null;
 const stage=deck.querySelector('[data-month-deck-stage]');let position=cleanMonthlyDeckPosition(saved),destroyed=false;
 const publish=()=>onChange?.(structuredClone(position));
 function paintInteraction(){
  const kind=MONTHLY_DECK_SCENES[position.index].kind,value=position.interaction?.value,fill=stage.querySelector('[data-month-deck-evidence]'),caption=stage.querySelector('[data-month-deck-caption]'),output=stage.querySelector('[data-month-deck-output]');
  if(kind==='rings'||kind==='grow'){
   const total=kind==='rings'?168:6.5;
   if(output)output.textContent=kind==='rings'?`${value} / 168`:`${value} / 6.5 H`;
   if(fill)fill.style.width=`${value/total*100}%`;
   const paths=[...stage.querySelectorAll('.time-art path')];paths.forEach((path,i)=>{path.style.opacity=i/paths.length<=value/total?'1':'.12';});
   if(caption)caption.textContent=`Illustration · ${6.5-value} reclaimed hours still to place`;
  }else if(kind==='compare'){
   fill.style.width=`${[7,5,3][value]/168*100}%`;
   caption.textContent=`Illustrative Actual week · ${['Relationships','Health','Community'][value]} ${[7,5,3][value]} hours of 168`;
  }else if(kind==='cut'){
   fill.style.width=`${(168-[2,4,1.5,1][value])/168*100}%`;
   caption.textContent=['Illustration · Remove 2 hours of unwanted scrolling','Illustration · Reduce media time by 4 hours','Illustration · Delegate 1.5 hours, with agreement','Illustration · Automate 1 hour, if setup pays off'][value];
   stage.querySelector('.time-art').style.clipPath=`polygon(0 0,100% 0,100% ${100-value*15}%,0 100%)`;
  }
  for(const button of stage.querySelectorAll('[data-month-deck-choice]'))button.setAttribute('aria-pressed',String(Number(button.dataset.monthDeckChoice)===value));
 }
 function render(){
  const s=MONTHLY_DECK_SCENES[position.index];
  stage.querySelector('video')?.pause();stage.className=sceneClass(s);stage.style.setProperty('--accent',s.color);stage.setAttribute('aria-label',`TIME ${s.mode}, slide ${position.index+1} of ${MONTHLY_DECK_SCENES.length}`);stage.innerHTML=sceneContent(position);
  deck.querySelector('[data-month-deck-prev]').disabled=position.index===0;
  deck.querySelector('[data-month-deck-next]').textContent=position.index===MONTHLY_DECK_SCENES.length-1?'Back to assignment →':'Next slide →';
  deck.querySelector('[data-month-deck-location]').textContent=`${s.mode} · ${String(position.index+1).padStart(2,'0')} / ${MONTHLY_DECK_SCENES.length}`;
  deck.querySelector('[data-month-deck-select]').value=String(position.index);
  paintInteraction();
  const video=stage.querySelector('video');if(video){if(matchMedia('(prefers-reduced-motion: reduce)').matches){video.autoplay=false;video.pause();}else video.play().catch(()=>{});}
 }
 function goTo(index){if(destroyed||!Number.isInteger(index)||index<0||index>=MONTHLY_DECK_SCENES.length)return false;position=cleanMonthlyDeckPosition({index});render();publish();return true;}
 function next(){if(position.index===MONTHLY_DECK_SCENES.length-1)onReturn?.();else goTo(position.index+1);}
 async function click(event){
  const button=event.target.closest('button');if(!button||!deck.contains(button))return;
  if(button.hasAttribute('data-month-deck-next'))next();
  else if(button.hasAttribute('data-month-deck-prev'))goTo(position.index-1);
  else if(button.hasAttribute('data-month-deck-restart'))goTo(0);
  else if(button.hasAttribute('data-month-deck-fullscreen')){try{await deck.requestFullscreen();}catch{announce('Full screen is unavailable here. You can keep viewing the deck in this window.');}}
  else if(button.hasAttribute('data-month-deck-exit')){if(document.fullscreenElement===deck)await document.exitFullscreen();}
  else if(button.hasAttribute('data-month-deck-choice')){position=cleanMonthlyDeckPosition({index:position.index,interaction:{value:Number(button.dataset.monthDeckChoice)}});paintInteraction();publish();}
 }
 function input(event){if(!event.target.hasAttribute('data-month-deck-range'))return;position=cleanMonthlyDeckPosition({index:position.index,interaction:{value:Number(event.target.value)}});paintInteraction();publish();}
 function change(event){if(event.target.hasAttribute('data-month-deck-select'))goTo(Number(event.target.value));}
 function keydown(event){if(event.target!==stage)return;if(event.key==='ArrowRight'){event.preventDefault();next();}else if(event.key==='ArrowLeft'){event.preventDefault();goTo(position.index-1);}}
 deck.addEventListener('click',click);deck.addEventListener('input',input);deck.addEventListener('change',change);stage.addEventListener('keydown',keydown);render();
 return {goTo,destroy(){destroyed=true;stage.querySelector('video')?.pause();deck.removeEventListener('click',click);deck.removeEventListener('input',input);deck.removeEventListener('change',change);stage.removeEventListener('keydown',keydown);}};
}
