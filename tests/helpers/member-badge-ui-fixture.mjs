import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../../',import.meta.url));
export const nodes=node=>!React.isValidElement(node)?[]:[node,...React.Children.toArray(node.props.children).flatMap(nodes)];
export const text=node=>React.isValidElement(node)?React.Children.toArray(node.props.children).map(text).join(''):typeof node==='string'||typeof node==='number'?String(node):'';

export function badgeUIFixture(initial={},options={}){
  const props={...initial},effects=[],frames=[],buttons=new Map(),elements=new Map(),instances=new Map(),observers=new Set(),requests=[];
  let current,seen,dirty=false,pathname=options.pathname??'/my',hiddenAncestor=false,sequence=0;
  const document={activeElement:null,hidden:options.hidden??false,body:{style:{overflow:'scroll'}},listeners:new Map(),
    addEventListener(type,fn){const set=this.listeners.get(type)??new Set();set.add(fn);this.listeners.set(type,set);},
    removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);},
    querySelectorAll(selector){assert.equal(selector,'dialog[open]');return [dialog,otherDialog].filter(item=>item.open);},
    querySelector(selector){return this.querySelectorAll(selector)[0]??null;}};
  class Element{
    constructor(name){this.name=name;this.isConnected=true;this.listeners=new Map();this.scrollLeft=0;this.scrollWidth=300;this.clientWidth=300;this.offsetLeft=0;this.offsetWidth=56;this.parentElement=null;this.open=false;}
    focus(value){document.activeElement=this;this.focusOptions=value;}
    closest(){return hiddenAncestor?document.body:null;}
    getBoundingClientRect(){const left=this.offsetLeft-(this.parentElement?.scrollLeft??0);return {left,right:left+this.offsetWidth,top:0,width:this.offsetWidth,height:76};}
    addEventListener(type,fn){const set=this.listeners.get(type)??new Set();set.add(fn);this.listeners.set(type,set);}
    removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
    dispatch(type,event){this.listeners.get(type)?.forEach(fn=>fn(event));}
  }
  const original=new Element('original-focus');document.activeElement=original;
  const dialog=new Element('dialog'),otherDialog=new Element('other-dialog');otherDialog.open=options.otherDialog??false;
  dialog.opens=0;dialog.closes=0;
  dialog.showModal=()=>{dialog.opens++;dialog.open=true;};dialog.close=()=>{if(dialog.open){dialog.closes++;dialog.open=false;}};
  const hooks={...React,
    useId(){const owner=current,key=owner.cursor++;return owner.slots[key]??= `badge-ui-${++sequence}`;},
    useRef(initial){const owner=current,key=owner.cursor++;return owner.slots[key]??={current:initial};},
    useState(initial){const owner=current,key=owner.cursor++;if(!(key in owner.slots))owner.slots[key]=typeof initial==='function'?initial():initial;return [owner.slots[key],next=>{const value=typeof next==='function'?next(owner.slots[key]):next;if(!Object.is(value,owner.slots[key])){owner.slots[key]=value;dirty=true;}}];},
    useEffect(callback,deps){const owner=current,key=owner.cursor++,old=owner.slots[key];if(!old||deps.some((value,index)=>!Object.is(value,old.deps[index]))){const slot={deps};owner.slots[key]=slot;effects.push(()=>{old?.cleanup?.();slot.cleanup=callback();});}},
  };
  const loaded=new Map();
  const fetch=async(url,init={})=>{requests.push({url,...init});return options.fetch?options.fetch(url,init):Promise.reject(new Error('Unexpected fetch'));};
  class MutationObserver{constructor(callback){this.callback=callback;}observe(){observers.add(this);}disconnect(){observers.delete(this);}}
  function load(path){
    path=resolve(root,path);if(loaded.has(path))return loaded.get(path).exports;
    const loadedModule={exports:{}};loaded.set(path,loadedModule);
    const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    new Function('require','module','exports','document','HTMLElement','MutationObserver','requestAnimationFrame','cancelAnimationFrame','fetch',code)(name=>{
      if(name==='react')return hooks;if(name==='react/jsx-runtime')return require(name);
      if(name==='next/image')return {__esModule:true,default:'img'};
      if(name==='next/navigation')return {usePathname:()=>pathname};
      if(name.endsWith('.module.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>key})};
      if(name.startsWith('./'))return load(resolve(dirname(path),`${name}.tsx`));
      throw Error(`Unexpected badge dependency: ${name}`);
    },loadedModule,loadedModule.exports,document,Element,MutationObserver,callback=>{frames.push(callback);return frames.length;},id=>{frames[id-1]=null;},fetch);
    return loadedModule.exports;
  }
  const Component=load(options.component??'src/components/membership/MemberBadges.tsx').default;
  function renderFunction(type,props,path){
    const key=`${path}/${type.name}`,instance=instances.get(key)??{slots:[],cursor:0};instances.set(key,instance);seen.add(key);instance.cursor=0;
    const prior=current;current=instance;const tree=type(props);current=prior;return expand(tree,key);
  }
  function expand(node,path){
    if(!React.isValidElement(node))return node;
    if(typeof node.type==='function')return renderFunction(node.type,node.props,`${path}/${node.key??''}`);
    const children=React.Children.toArray(node.props.children).map((child,index)=>expand(child,`${path}/${index}:${React.isValidElement(child)?child.key??'':''}`));
    return React.cloneElement(node,{},...children);
  }
  function setRef(ref,value){if(typeof ref==='function')ref(value);else if(ref)ref.current=value;}
  function draw(next){
    Object.assign(props,next);let tree,budget=10;
    do{
      dirty=false;seen=new Set();tree=renderFunction(Component,props,'root');
      for(const[key,instance]of instances){if(!seen.has(key)){instance.slots.forEach(slot=>slot?.cleanup?.());instances.delete(key);}}
      for(const node of nodes(tree)){
        if(node.type==='button'){const label=node.props['aria-label']??text(node);if(!buttons.has(label))buttons.set(label,new Element(label));setRef(node.props.ref,buttons.get(label));}
        else if(node.type==='dialog')setRef(node.props.ref,dialog);
        else if(node.props.ref){const key=node.props.className??node.props['aria-label']??node.type;if(!elements.has(key))elements.set(key,new Element(key));setRef(node.props.ref,elements.get(key));}
      }
      effects.splice(0).forEach(effect=>effect());
    }while(dirty&&--budget);
    assert.ok(budget,'Render/effect loop did not settle');return tree;
  }
  function button(label){const node=nodes(draw()).find(node=>node.type==='button'&&(node.props['aria-label']??text(node))===label);assert.ok(node,`Missing button: ${label}`);return node;}
  const click=label=>{button(label).props.onClick({currentTarget:buttons.get(label)});return draw();};
  const notify=()=>{[...observers].forEach(observer=>observer.callback([]));return draw();};
  return {draw,button,click,buttons,elements,dialog,document,original,requests,observers,
    async settle(){for(let i=0;i<4;i++){await new Promise(resolve=>setImmediate(resolve));draw();}return draw();},
    setPath(value){pathname=value;return draw();},
    setHidden(value){document.hidden=value;document.listeners.get('visibilitychange')?.forEach(fn=>fn());return draw();},
    setAncestorHidden(value){hiddenAncestor=value;return notify();},
    setOtherDialog(value){otherDialog.open=value;return notify();},
    notifyMutations:notify,
    layout({width=156,itemWidth=52,padding=6}={}){const tree=draw(),row=elements.get('row');assert.ok(row,'Expected dock');row.offsetWidth=width;row.clientWidth=width;row.scrollWidth=props.badges.length*itemWidth+padding*2;nodes(tree).filter(node=>node.type==='button'&&node.props['aria-haspopup']==='dialog').forEach((node,index)=>{const el=buttons.get(node.props['aria-label']);el.parentElement=row;el.offsetLeft=padding+index*itemWidth;el.offsetWidth=itemWidth;});return row;},
    flushFrames(){frames.splice(0).forEach(fn=>fn?.());},
    unmount(){instances.forEach(instance=>instance.slots.forEach(slot=>slot?.cleanup?.()));instances.clear();},
  };
}
