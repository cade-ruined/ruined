"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "./operatorStyles";
const TEMPLATES = [
  {key:"registration:welcome",title:"Registration welcome"},
  {key:"registration:pre_foundations",title:"A few things worth knowing"},
  {key:"registration:profile_ready",title:"Profile access ready"},
];
type Template = {key:string;subject:string;body:string;revision:number;tokens:string[]};
const API = "/api/ops/messages/templates";
export default function OperatorRegistrationEmailTemplates({preview=false,onDirtyChange}:{preview?:boolean;onDirtyChange?:(dirty:boolean)=>void}) {
  const [key,setKey]=useState(TEMPLATES[0].key),[saved,setSaved]=useState<Template|null>(null),[subject,setSubject]=useState(""),[body,setBody]=useState("");
  const [pending,setPending]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[refresh,setRefresh]=useState(0);
  const saving=useRef(false),sequence=useRef(0);
  const requestedKey=useSearchParams().get("template");
  const routeSelection=useRef<string|null|undefined>(undefined);
  const dirty=!!saved && (subject!==saved.subject || body!==saved.body);
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
  useEffect(()=>{
    if(routeSelection.current===requestedKey)return;
    if(!TEMPLATES.some(item=>item.key===requestedKey)){routeSelection.current=requestedKey;return;}
    if(dirty){setError("Save or discard the template changes before opening another template.");return;}
    if(pending||saving.current)return;
    routeSelection.current=requestedKey;setKey(requestedKey!);
  },[requestedKey,dirty,pending]);
  useEffect(()=>{
    if(preview)return;
    const controller=new AbortController(),current=++sequence.current;
    setPending(true);setSaved(null);setError("");setMessage("");
    void fetch(`${API}?key=${encodeURIComponent(key)}`,{cache:"no-store",signal:controller.signal}).then(async response=>{
      const value=await response.json();if(!response.ok)throw new Error(value.error??"Registration copy is unavailable.");
      if(current===sequence.current&&!controller.signal.aborted){setSaved(value);setSubject(value.subject);setBody(value.body);}
    }).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);}).finally(()=>{if(current===sequence.current)setPending(false);});
    return()=>controller.abort();
  },[key,preview,refresh]);
  useEffect(()=>{
    if(!dirty)return;
    const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    const navigation=(event:MouseEvent)=>{const anchor=(event.target as Element|null)?.closest("a[href]");if(!anchor||event.defaultPrevented||(anchor as HTMLAnchorElement).target==="_blank")return;event.preventDefault();setError("Save or discard the template changes before leaving this page.");};
    window.addEventListener("beforeunload",unload);document.addEventListener("click",navigation,true);
    return()=>{window.removeEventListener("beforeunload",unload);document.removeEventListener("click",navigation,true);};
  },[dirty]);
  async function save(){
    if(!saved||pending||preview||saving.current)return;saving.current=true;setPending(true);setError("");setMessage("");
    try{const response=await fetch(API,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:saved.key,subject,body,revision:saved.revision})});const value=await response.json();if(!response.ok)throw new Error(value.error??"Template changes could not be saved.");setSaved(value);setSubject(value.subject);setBody(value.body);setMessage("Reusable copy saved. Registration requirements and timing are unchanged; already frozen messages keep their approved content.");}
    catch(failure){setError(failure instanceof Error?failure.message:"Template changes could not be saved.");}finally{saving.current=false;setPending(false);}
  }
  return <section id="registration-email-copy" className="operator-glass mt-6 scroll-mt-24 space-y-4 p-5" aria-labelledby="registration-copy-heading" data-operator-dirty={dirty} data-operator-pending={pending}>
    <div><h3 id="registration-copy-heading" className="font-semibold">Registration email copy</h3><p className="mt-1 text-sm text-[color:var(--operator-muted)]">Edit the reusable wording for future registration messages. The existing registration workflow controls timing and eligibility.</p></div>
    <label className="block text-sm" htmlFor="registration-copy-template">Message<select className={OPERATOR_FIELD_CLASS} id="registration-copy-template" value={key} disabled={pending||dirty} onChange={event=>setKey(event.target.value)}>{TEMPLATES.map(item=><option key={item.key} value={item.key}>{item.title}</option>)}</select></label>
    {preview?<p className="text-sm">Saved registration copy is available in the live admin workspace. Nothing is changed here.</p>:null}
    {pending?<p className="text-sm" role="status">Loading or saving template…</p>:null}
    {error?<p className="text-sm text-[var(--operator-danger)]" role="alert">{error}</p>:null}
    {message?<p className="text-sm" role="status">{message}</p>:null}
    {saved?<fieldset disabled={pending} className="space-y-3"><label className="block text-sm" htmlFor="registration-copy-subject">Subject<input className={OPERATOR_FIELD_CLASS} id="registration-copy-subject" maxLength={200} value={subject} onChange={event=>setSubject(event.target.value)} /></label><label className="block text-sm" htmlFor="registration-copy-body">Message<textarea className={`${OPERATOR_FIELD_CLASS} resize-y leading-relaxed`} id="registration-copy-body" rows={12} maxLength={12000} value={body} onChange={event=>setBody(event.target.value)} /></label>{saved.tokens?.length?<p className="break-words text-xs text-[color:var(--operator-muted)]">Available dynamic fields: {saved.tokens.join(", ")}. Keep these exactly as shown to use the member’s actual information.</p>:null}<div className="flex flex-wrap gap-3"><button type="button" className={OPERATOR_BUTTON_CLASS} disabled={!dirty||!subject.trim()||!body.trim()} onClick={()=>void save()}>Save registration template</button>{dirty?<button type="button" className={OPERATOR_BUTTON_CLASS} onClick={()=>{setSubject(saved.subject);setBody(saved.body);}}>Discard copy changes</button>:null}</div></fieldset>:null}
    <button type="button" className={OPERATOR_BUTTON_CLASS} disabled={preview||pending||dirty} onClick={()=>setRefresh(value=>value+1)}>Refresh registration copy</button>
  </section>;
}
