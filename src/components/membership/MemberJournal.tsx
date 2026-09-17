"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { JOURNAL_BODY_LENGTH, JOURNAL_MAX_IMAGES, JOURNAL_MEDIA_ACCEPT, journalFilePolicy, type JournalEntry, type JournalKind, type JournalSnapshot } from "@/lib/membership/journal-model";
import styles from "./MemberJournal.module.css";

const examples:JournalEntry[] = [
  {id:"example-images",kind:"images",title:"A moment, kept.",body:"An example image entry. Add your own images to try the gallery.",createdAt:"2026-08-27T12:00:00Z",saved:false,media:[{id:"example-photo",mimeType:"image/webp",size:0,url:"/membership/portrait-pending-editorial.webp"}]},
  {id:"example-text",kind:"text",title:"Making room.",body:"What stays when you take away everything that does not belong?\n\nAn example journal entry. This space is yours.",createdAt:"2026-08-26T12:00:00Z",saved:true,media:[]},
  {id:"example-video",kind:"video",title:"Around the fire.",body:"An example video entry.",createdAt:"2026-08-25T12:00:00Z",saved:false,media:[{id:"example-film",mimeType:"video/mp4",size:0,url:"/sequences/fireside/fire-stream-loop-mobile.mp4"}]},
];
const kindLabel = {text:"Words",images:"Images",video:"Video"};
function entryDate(value:string) { return new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(value)); }
class JournalRequestError extends Error { constructor(message:string, readonly status:number){ super(message); } }
async function requestJson<T>(url:string, init?:RequestInit):Promise<T> {
  const response=await fetch(url,{...init,signal:init?.signal??AbortSignal.timeout(90_000),cache:"no-store"});
  const result=await response.json();
  if(!response.ok) throw new JournalRequestError(result.error || "Something went wrong. Please try again.",response.status);
  return result as T;
}
function Dialog({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:React.ReactNode}){
  const ref=useRef<HTMLDialogElement>(null); const titleId=useId();
  useEffect(()=>{const dialog=ref.current;if(!dialog)return;if(open){if(!dialog.open)dialog.showModal();const previous=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=previous;};}if(dialog.open)dialog.close();},[open]);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={onClose} onClose={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}}><div className={styles.dialogBody}><header className={styles.dialogHeader}><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label="Close">×</button></header>{children}</div></dialog>;
}

export default function MemberJournal({preview,writable,view="journal"}:{preview:boolean;writable:boolean;view?:"journal"|"saved"}) {
  const [entries,setEntries]=useState<JournalEntry[]>(preview?examples:[]);
  const [loading,setLoading]=useState(!preview);const [hasMore,setHasMore]=useState(false);const [mediaReady,setMediaReady]=useState(preview);const [error,setError]=useState("");const [reload,setReload]=useState(0);
  const railRef=useRef<HTMLDivElement>(null);const [composer,setComposer]=useState(false);const [selected,setSelected]=useState<JournalEntry|null>(null);const [imageIndex,setImageIndex]=useState(0);const [mediaError,setMediaError]=useState("");
  const [kind,setKind]=useState<JournalKind>("text");const [title,setTitle]=useState("");const [body,setBody]=useState("");const [files,setFiles]=useState<File[]>([]);const [fileUrls,setFileUrls]=useState<string[]>([]);
  const [pending,setPending]=useState(false);const [attempted,setAttempted]=useState(false);const [draftError,setDraftError]=useState("");const [notice,setNotice]=useState("");const [savingId,setSavingId]=useState<string|null>(null);
  const listVersion=useRef(0);const draftId=useRef<string|null>(null);const uploadIds=useRef(new Map<File,string>());const savedUrls=useRef<string[]>([]);const busy=useRef(false);const id=useId();
  const canWrite=writable;
  useEffect(()=>{const urls=files.map(file=>URL.createObjectURL(file));setFileUrls(urls);return()=>urls.forEach(url=>URL.revokeObjectURL(url));},[files]);
  useEffect(()=>()=>savedUrls.current.forEach(url=>URL.revokeObjectURL(url)),[]);
  useEffect(()=>{
    listVersion.current+=1;if(preview)return;const abort=new AbortController();setLoading(true);setError("");
    requestJson<JournalSnapshot>(`/api/my/journal${view==="saved"?"?saved=true":""}`,{signal:abort.signal}).then(data=>{if(abort.signal.aborted)return;setEntries(data.entries);setHasMore(data.hasMore);setMediaReady(data.mediaReady);}).catch(cause=>{if(!abort.signal.aborted)setError(cause.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[preview,view,reload]);
  useEffect(()=>{
    if(!title && !body && !files.length)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);
    return()=>window.removeEventListener("beforeunload",warn);
  },[title,body,files]);
  const closeComposer=useCallback(()=>setComposer(false),[]);const closeEntry=useCallback(()=>setSelected(null),[]);
  const visible=view==="saved" ? entries.filter(entry=>entry.saved) : entries;
  function addFiles(incoming:FileList|null){
    if(!incoming)return;setDraftError("");
    const next=kind==="images"?[...files,...Array.from(incoming)]:Array.from(incoming).slice(0,1);
    try{if(kind==="images"&&next.length>JOURNAL_MAX_IMAGES)throw new Error("Choose up to eight images.");for(const file of next){if(journalFilePolicy(file.type,file.size)!==kind)throw new Error("Choose the matching media type.");}setFiles(next);}catch(cause){setDraftError(cause instanceof Error?cause.message:"Choose a supported file.");}
  }
  function resetDraft(){setTitle("");setBody("");setFiles([]);setKind("text");setAttempted(false);setDraftError("");draftId.current=null;uploadIds.current.clear();}
  async function publish(event:FormEvent){
    event.preventDefault();if(busy.current||!canWrite)return;busy.current=true;setPending(true);setDraftError("");
    draftId.current??=crypto.randomUUID();
    try{
      if(kind==="text"&&!body.trim())throw new Error("Write something before adding your entry.");
      if(kind!=="text"&&!files.length)throw new Error(kind==="images"?"Choose at least one image.":"Choose a video.");
      let entry:JournalEntry;
      if(preview){
        entry={id:draftId.current,kind,title:title.trim()||null,body:body.trim()||null,createdAt:new Date().toISOString(),saved:false,media:files.map(file=>{const url=URL.createObjectURL(file);savedUrls.current.push(url);return{id:crypto.randomUUID(),mimeType:file.type,size:file.size,url};})};
      }else{
        for(const file of files){if(uploadIds.current.has(file))continue;
          const upload=await requestJson<{id:string;signedUrl:string}>("/api/my/journal/media",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mimeType:file.type,size:file.size})});
          const data=new FormData();data.append("cacheControl","0");data.append("",file);
          const response=await fetch(upload.signedUrl,{method:"PUT",headers:{"x-upsert":"false"},signal:AbortSignal.timeout(180_000),body:data});
          if(!response.ok)throw new Error("An upload could not finish. Your draft is still here; please try again.");
          uploadIds.current.set(file,upload.id);
        }
        setAttempted(true);
        const result=await requestJson<{entry:JournalEntry}>("/api/my/journal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:draftId.current,kind,title,body,mediaIds:files.map(file=>uploadIds.current.get(file))})});entry=result.entry;
      }
      setEntries(current=>[entry,...current.filter(item=>item.id!==entry.id)]);resetDraft();setComposer(false);setNotice(preview?"Entry added for this preview. It will reset when you leave or refresh.":"Entry added to your journal.");
    }catch(cause){if(cause instanceof JournalRequestError && cause.status>=400 && cause.status<500){setAttempted(false);}setDraftError(cause instanceof Error?cause.message:"Your draft is still here. Please try again.");}finally{setPending(false);busy.current=false;}
  }
  async function toggleSaved(entry:JournalEntry){
    if(savingId||!canWrite)return;setSavingId(entry.id);setError("");
    try{const updated=preview?{...entry,saved:!entry.saved}:(await requestJson<{entry:JournalEntry}>(`/api/my/journal/${entry.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({saved:!entry.saved})})).entry;
      setEntries(current=>current.map(item=>item.id===entry.id?updated:item).filter(item=>preview||view!=="saved"||item.saved));setSelected(current=>current?.id===entry.id?updated:current);
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not save entry.");}finally{setSavingId(null);}
  }
  async function loadMore(){if(loading||!hasMore)return;const version=listVersion.current;setLoading(true);setError("");try{const data=await requestJson<JournalSnapshot>(`/api/my/journal?before=${encodeURIComponent(entries.at(-1)?.id??"")}${view==="saved"?"&saved=true":""}`);if(version!==listVersion.current)return;setEntries(current=>[...current,...data.entries.filter(item=>!current.some(old=>old.id===item.id))]);setHasMore(data.hasMore);}catch(cause){setError(cause instanceof Error?cause.message:"Could not load entries.");}finally{if(version===listVersion.current)setLoading(false);}}
  return <section className={styles.journal} aria-labelledby={`${id}-title`}>
    <header className={styles.sectionHeader}>
      <h2 className={`member-handwritten ${styles.sectionTitle}`} id={`${id}-title`}>{view==="saved"?"Kept close":"Your journal"}</h2>
      <div className={styles.toolbar}>
        {canWrite&&view==="journal"?<button className="member-button member-button-primary" type="button" onClick={()=>{setNotice("");setComposer(true);}}><span aria-hidden="true">＋</span>Add entry</button>:null}
        <div className={styles.scrollActions} role="group" aria-label="Scroll journal entries">
          <button type="button" aria-label="Earlier in journal row" onClick={()=>railRef.current?.scrollBy({left:-260,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"})}>←</button>
          <button type="button" aria-label="Further in journal row" onClick={()=>railRef.current?.scrollBy({left:260,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"})}>→</button>
        </div>
      </div>
    </header>
    <p className={styles.srOnly}>{view==="saved"?"Entries you have saved for later.":"A place for what matters. Only you can see this."} Scroll horizontally to explore your entries.</p>
    {preview?<p className={styles.previewNote}>Example entries · New entries stay in this preview until you leave or refresh.</p>:null}
    {notice?<p role="status" className={styles.feedback}>{notice}</p>:null}
    {error?<div role="alert" className={styles.feedback}>{error} <button type="button" className={styles.retry} onClick={()=>setReload(value=>value+1)}>Try again</button></div>:null}
    {loading&&!entries.length?<p role="status" className={styles.empty}>Opening your journal…</p>:!visible.length&&!error?<div className={styles.empty}><h3>{view==="saved"?"Keep something worth returning to.":"Start with a moment."}</h3><p>{view==="saved"?"Use Save on any journal entry to find it here.":"A few words, a photograph, a video. It can be that simple."}</p></div>:null}
    <div className={styles.entries} ref={railRef} role="region" aria-label="Journal entries — scroll horizontally" aria-busy={loading} tabIndex={visible.length?0:undefined}>
      {visible.map((entry,index)=><article className={styles.card} data-kind={entry.kind} key={entry.id}>
        <button type="button" className={styles.openEntry} aria-label={`Open entry: ${entry.title||entry.body?.slice(0,75)||"A moment, kept."}`} onClick={()=>{setImageIndex(0);setMediaError("");setSelected(entry);}}>
          <span className={styles.cover}>
            <span className={styles.cardMeta}>{String(index+1).padStart(2,"0")}</span>
            <span className={styles.coverContents} aria-hidden="true">
              {entry.kind==="text"?<span className={styles.coverQuote}>{entry.body||entry.title}</span>:entry.kind==="images"?<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m21 15-5-5L5 21"/></svg>:<span className={styles.play}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="m8 4 12 8-12 8Z"/></svg></span>}
            </span>
            <span className={styles.cardKind}>{entry.kind==="images"?"Image":entry.kind==="text"?"Text":"Video"}{entry.kind==="images"&&entry.media.length>1?<span>{entry.media.length}</span>:null}</span>
          </span>
          <span className={styles.cardTitle}>{entry.title||entry.body?.slice(0,75)||"A moment, kept."}</span>
          <time className={styles.cardDate} dateTime={entry.createdAt}>{entryDate(entry.createdAt)}</time>
        </button>
        <button className={styles.save} type="button" aria-label={entry.saved?"Unsave entry":"Save entry"} aria-pressed={entry.saved} disabled={!canWrite||savingId===entry.id} onClick={()=>void toggleSaved(entry)}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 20 20" fill={entry.saved?"currentColor":"none"} stroke="currentColor"><path d="M5 3h10v14l-5-3-5 3Z"/></svg></button>
      </article>)}
    </div>
    {hasMore?<button className={`member-button ${styles.more}`} type="button" disabled={loading} onClick={()=>void loadMore()}>{loading?"Loading…":"Load earlier entries"}</button>:null}
    <Dialog open={composer} onClose={closeComposer} title="Leave something here."><form onSubmit={publish} aria-busy={pending}>
      <p className={styles.subtitle}>{preview?"Try it out. Entries in preview are temporary.":"Your journal is private. This entry is only visible to you."}</p>
      <fieldset className={styles.kindPicker} disabled={pending||attempted}><legend className={styles.srOnly}>Entry type</legend>{(["text","images","video"] as const).map(value=><label key={value}><input type="radio" name={`${id}-kind`} checked={kind===value} onChange={()=>{setKind(value);setFiles([]);setDraftError("");}} disabled={value!=="text"&&!mediaReady}/><span>{value==="text"?"Text":kindLabel[value]}</span></label>)}</fieldset>
      {!mediaReady?<p className={styles.subtitle}>Image and video uploads are temporarily unavailable.</p>:null}
      <label className={styles.field}>Title <span>(optional)</span><input maxLength={160} value={title} disabled={pending||attempted} onChange={event=>setTitle(event.target.value)} placeholder="Give this moment a name"/></label>
      <label className={styles.field}>{kind==="text"?"Your words":"Caption"} {kind!=="text"?<span>(optional)</span>:null}<textarea rows={5} maxLength={JOURNAL_BODY_LENGTH} required={kind==="text"} value={body} disabled={pending||attempted} onChange={event=>setBody(event.target.value)} placeholder={kind==="text"?"What is on your mind?":"A little context, if it needs it."}/></label>
      {kind!=="text"?<><label className={styles.fileInput}>{kind==="images"?"Choose images":"Choose a video"}<input type="file" accept={JOURNAL_MEDIA_ACCEPT[kind]} multiple={kind==="images"} disabled={pending||attempted} onChange={event=>{addFiles(event.target.files);event.target.value="";}}/><span>{kind==="images"?"Up to 8 images · JPG, PNG, WebP · 8 MB each":"MP4 or WebM · Up to 50 MB"}</span></label><div className={styles.previews}>{files.map((file,index)=><figure key={`${file.name}-${index}`}>{kind==="images"&&fileUrls[index]?<Image src={fileUrls[index]} alt={`Selected image ${index+1}`} width={180} height={140} unoptimized/>:fileUrls[index]?<video src={fileUrls[index]} controls playsInline preload="metadata"/>:null}<figcaption>{file.name}</figcaption><button type="button" disabled={pending||attempted} onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))} aria-label={`Remove ${file.name}`}>Remove</button></figure>)}</div></>:null}
      {draftError?<p role="alert" className={styles.draftError}>{draftError}{attempted?" Retry to confirm this same entry. Your words and media have been kept.":""}</p>:null}
      <p className={styles.subtitle}>Your draft stays here while you remain on this profile.</p>
      <footer className={styles.composerActions}><button type="button" className={styles.quiet} onClick={closeComposer}>Keep draft & close</button><button className="member-button member-button-primary" type="submit" disabled={pending}>{pending?"Saving…":attempted?"Retry save":"Add to journal"}</button></footer>
    </form></Dialog>
    <Dialog open={Boolean(selected)} onClose={closeEntry} title={selected?.title||"A moment, kept."}>{selected?<>
      <div className={styles.detailMeta}><time dateTime={selected.createdAt}>{entryDate(selected.createdAt)}</time><button className={styles.quiet} type="button" disabled={!canWrite||savingId===selected.id} onClick={()=>void toggleSaved(selected)}>{selected.saved?"Saved ✓":"Save entry"}</button></div>
      {selected.kind==="images"&&selected.media[imageIndex]?<div className={styles.gallery}><Image src={selected.media[imageIndex].url} alt={`Journal image ${imageIndex+1} of ${selected.media.length}`} width={1000} height={800} unoptimized/>{selected.media.length>1?<nav aria-label="Image gallery"><button type="button" onClick={()=>setImageIndex(index=>(index-1+selected.media.length)%selected.media.length)} aria-label="Previous image">←</button><span>{imageIndex+1} / {selected.media.length}</span><button type="button" onClick={()=>setImageIndex(index=>(index+1)%selected.media.length)} aria-label="Next image">→</button></nav>:null}</div>:null}
      {selected.kind==="video"&&selected.media[0]?<video className={styles.video} key={selected.id} src={selected.media[0].url} controls playsInline preload="metadata" onError={()=>setMediaError("This video could not be played. Try reopening the entry or use a different browser.")}/>:null}
      {mediaError?<p className={styles.draftError} role="alert">{mediaError}</p>:null}
      {selected.body?<p className={styles.detailBody}>{selected.body}</p>:null}
    </>:null}</Dialog>
  </section>;
}
