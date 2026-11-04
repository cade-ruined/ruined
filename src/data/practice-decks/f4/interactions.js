const state={"deck":"4","channel":0,"networkCount":6,"participation":0,"give":0,"receive":0,"response":0,"responseCare":0,"circle":0,"circleFocus":0,"chain":0,"action":0,"leaveMask":0,"scanDomain":0,"scanValues":[4,6,5,3,7,4,5],"week":0,"identity":0,"difference":0};
const paper='#eeece3',yellow='#efcc24',red='#e75b3d';
const labels=['Self / Identity','Relationships','Family','Health','Work / Purpose','Money','Community / Contribution'];
const fmt=n=>Number(n).toFixed(2);
const line=(a,b,attrs='')=>`<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" ${attrs}/>`;
function action(st){return `<div class="f34-knowledge-anchor">WHAT<br>I KNOW</div><div class="f34-action-cable" style="--progress:${st.action/100}"></div><div class="f34-action-move" style="--progress:${st.action/100}"><span>ONE</span><strong>NEXT STEP</strong></div><div class="f34-practice-anchor">HOW<br>I LIVE</div>`;}
function carry(st){const items=['PROVING','CURIOSITY','OLD RULES','CARE'];return `<span class="f34-carry-horizon" aria-hidden="true">WHAT<br>MATTERS.</span>${items.map((x,i)=>`<button class="f34-carry-token ${st.leaveMask&(1<<i)?'is-left':''}" data-demo-bit="leaveMask" data-bit="${i}" style="--i:${i}" aria-pressed="${!!(st.leaveMask&(1<<i))}" aria-label="${st.leaveMask&(1<<i)?'Carry':'Leave'} ${x.toLowerCase()}">${x}<span>${st.leaveMask&(1<<i)?'LEFT BEHIND ↶':'CARRYING ×'}</span></button>`).join('')}`;}
function life(st){const center=[220,190],R=135,pts=st.scanValues.map((v,i)=>{const a=i/7*Math.PI*2-Math.PI/2;return [center[0]+Math.cos(a)*R*v/10,center[1]+Math.sin(a)*R*v/10];});return `<svg viewBox="0 0 440 380" role="img" aria-label="Seven separate areas form an uneven Life Scan. Selected area: ${labels[st.scanDomain]}, ${st.scanValues[st.scanDomain]} out of ten. There is no combined score.">${[.25,.5,.75,1].map(r=>`<polygon points="${Array.from({length:7},(_,i)=>{const a=i/7*Math.PI*2-Math.PI/2;return `${220+Math.cos(a)*R*r},${190+Math.sin(a)*R*r}`;}).join(' ')}" fill="none" stroke="${paper}" opacity=".25"/>`).join('')}${Array.from({length:7},(_,i)=>{const a=i/7*Math.PI*2-Math.PI/2;return line(center,[220+Math.cos(a)*R,190+Math.sin(a)*R],`stroke="${paper}" opacity=".2"`);}).join('')}<polygon points="${pts.map(p=>p.map(fmt).join(',')).join(' ')}" fill="${yellow}" fill-opacity=".2" stroke="${yellow}" stroke-width="3"/>${pts.map((p,i)=>`<circle cx="${fmt(p[0])}" cy="${fmt(p[1])}" r="${i===st.scanDomain?9:4}" fill="${i===st.scanDomain?red:yellow}"/>`).join('')}</svg>`;}
function identity(st){return `<div class="f34-identity-word">WHO<br>I AM.</div>${['CONVERSATION','BOUNDARY','PROMISE','ACTION'].map((x,i)=>`<div class="f34-identity-piece ${st.identity&(1<<i)?'is-practiced':''}" style="--i:${i}">${x}</div>`).join('')}`;}
function week(st){const p=st.week/100;return `<div class="f34-week-days">${['MON','TUE','WED','THU','FRI'].map(x=>`<span>${x}</span>`).join('')}</div><div class="f34-week-grid">${Array.from({length:15},(_,i)=>`<i style="--i:${i};--room:${p}" class="${[7,8].includes(i)?'f34-displaced':''}"></i>`).join('')}<div class="f34-week-commitment" style="--room:${p}"><span>ONE</span><strong>COMMITMENT</strong></div></div><div class="f34-week-labels"><span>SAME WEEK.</span><span>DIFFERENT CHOICE.</span></div>`;}
export function paintMechanism(root,st){
 const paintings={action,carry,scan:life,identity,week};
 root.querySelectorAll('[data-demo-canvas]').forEach(el=>el.innerHTML=paintings[el.dataset.demoCanvas]?.(st)??'');
 root.style.setProperty('--demo-action',st.action/100);
 root.querySelectorAll('[data-demo-range]').forEach(el=>el.value=el.dataset.demoRange==='scanValue'?st.scanValues[st.scanDomain]:st[el.dataset.demoRange]);
 root.querySelectorAll('[data-demo-choice]').forEach(el=>el.setAttribute('aria-pressed',String(st[el.dataset.demoChoice]===+el.dataset.value)));
 root.querySelectorAll('[data-demo-bit]').forEach(el=>el.setAttribute('aria-pressed',String(!!(st[el.dataset.demoBit]&(1<<+el.dataset.bit)))));
 root.querySelectorAll('[data-demo-toggle]').forEach(el=>{el.setAttribute('aria-pressed',String(!!st[el.dataset.demoToggle]));el.textContent=st.responseCare?'WITH CARE ↔':'WITHOUT CARE ↔';});
 if(root.querySelector('[data-demo-domain]')){root.querySelector('[data-demo-domain]').textContent=labels[st.scanDomain];root.querySelector('[data-demo-score]').textContent=st.scanValues[st.scanDomain];}
}
export function bindMechanisms(root,st,onChange){
 root.addEventListener('input',e=>{const key=e.target.dataset.demoRange;if(!key)return;const value=+e.target.value;if(key==='scanValue')st.scanValues[st.scanDomain]=value;else st[key]=value;paintMechanism(root,st);onChange();});
 root.addEventListener('click',e=>{const choice=e.target.closest('[data-demo-choice]'),bit=e.target.closest('[data-demo-bit]'),toggle=e.target.closest('[data-demo-toggle]');if(choice)st[choice.dataset.demoChoice]=+choice.dataset.value;else if(bit)st[bit.dataset.demoBit]^=1<<+bit.dataset.bit;else if(toggle)st[toggle.dataset.demoToggle]=+!st[toggle.dataset.demoToggle];else return;paintMechanism(root,st);onChange();});
}

export function paint(root){paintMechanism(root,state);}
export function bind(root){bindMechanisms(root.querySelector('.f34-scene-body'),state,()=>paint(root));}
