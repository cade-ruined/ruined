"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import MemberJournal from "@/components/membership/MemberJournal";
import { memberCan } from "@/lib/membership/access-policy";
import { memberTier } from "@/lib/membership/member-number";
import type { MemberHomeSnapshot } from "@/lib/membership/model";
import styles from "./MemberProfile.module.css";

const tabs=["journal","timeline","saved","about"] as const;
type Tab=typeof tabs[number];
function date(value:string){return new Intl.DateTimeFormat("en-US",{month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(value));}
function MembershipRecord({member}:{member:MemberHomeSnapshot}){
  const record=member.record;
  const hasRecord=memberCan(member.access,"artifacts.read")||memberCan(member.access,"experiences.member");
  return <div className={styles.about}>
    <section><h2 className="member-handwritten">A little about you</h2><dl className={styles.facts}>
      {member.profile.bio?<div><dt>About</dt><dd>{member.profile.bio}</dd></div>:null}
      {member.profile.buildingNow?<div><dt>Building now</dt><dd>{member.profile.buildingNow}</dd></div>:null}
      {member.profile.location?<div><dt>Based in</dt><dd>{member.profile.location}</dd></div>:null}
      {member.profile.timezone?<div><dt>Time zone</dt><dd>{member.profile.timezone}</dd></div>:null}
      <div><dt>Profile visibility</dt><dd>{member.profile.directoryStatus==="circle_visible"?"Visible to your Circle according to your sharing choices.":"Hidden from the Circle directory."}</dd></div>
    </dl><Link className="member-button" href="/my/profile">Edit profile & sharing</Link></section>
    <section><h2 className="member-handwritten">Your membership</h2><dl className={styles.facts}><div><dt>Status</dt><dd>{member.identity.standingState.replaceAll("_"," ")}</dd></div>{member.memberSince?<div><dt>Member since</dt><dd>{date(member.memberSince)}</dd></div>:null}{memberCan(member.access,"foundations.summary")?<div><dt>Foundations</dt><dd>{member.foundations.state.replaceAll("_"," ")}</dd></div>:null}{member.circleName?<div><dt>Circle</dt><dd><Link href="/my/circle">{member.circleName} ↗</Link></dd></div>:null}</dl><Link className="member-button" href="/my/account">Account & billing</Link></section>
    {hasRecord&&record?<section className={styles.full} aria-labelledby="member-record-title"><div className={styles.sectionLine}><h2 className="member-handwritten" id="member-record-title">Along the way</h2><span>{record.totals.milestones} milestones · {record.totals.attendedExperiences} attended</span></div>
      {record.milestones.length?<ol className={styles.recordList}>{record.milestones.map(item=><li key={item.id}><span>{item.title}</span><time dateTime={item.occurredAt}>{date(item.occurredAt)}</time></li>)}</ol>:<p className={styles.muted}>Completed work and membership milestones will appear here.</p>}
      {record.totals.milestones>record.milestones.length?<p className={styles.muted}>Showing the {record.milestones.length} most recent milestones of {record.totals.milestones}.</p>:null}
      {record.attendedExperiences.length?<><h3 className={styles.smallTitle}>Experiences</h3><ol className={styles.recordList}>{record.attendedExperiences.map(item=><li key={item.id}><div>{item.title}<span className={styles.recordNote}>{item.attendanceState==="credited"?"Credited attendance":"Attendance confirmed"}</span></div><time dateTime={item.startsAt}>{date(item.startsAt)}</time></li>)}</ol></>:null}
      {record.totals.attendedExperiences+record.totals.creditedExperiences>record.attendedExperiences.length?<p className={styles.muted}>Showing {record.attendedExperiences.length} recent experiences. Your full record includes {record.totals.attendedExperiences} attended and {record.totals.creditedExperiences} credited.</p>:null}
    </section>:null}
    {memberCan(member.access,"artifacts.read")?<section className={styles.full}><div className={styles.sectionLine}><h2 className="member-handwritten">Your artifacts</h2><Link href="/my/artifacts">View all ↗</Link></div>{member.artifacts.length?<ul className={styles.artifacts}>{member.artifacts.slice(0,3).map(item=><li key={item.awardId}><span>{item.acquisitionType==="earned"?"Earned":item.acquisitionType==="gifted"?"Gifted":"Purchased"}</span><h3>{item.name}</h3><p>{item.artifactState.replaceAll("_"," ")}</p></li>)}</ul>:<p className={styles.muted}>Your collection will appear here as it grows.</p>}</section>:null}
  </div>;
}
export default function MemberHome({member,preview=false,timeline}:{member:MemberHomeSnapshot;preview?:boolean;timeline?:ReactNode}) {
  const [tab,setTab]=useState<Tab>("journal");const [timelineVisited,setTimelineVisited]=useState(false);const tabRefs=useRef<(HTMLButtonElement|null)[]>([]);const id=useId();
  useEffect(()=>{function synchronize(){const value=window.location.hash.slice(1);if(tabs.includes(value as Tab)){setTab(value as Tab);if(value==="timeline")setTimelineVisited(true);}}synchronize();window.addEventListener("hashchange",synchronize);return()=>window.removeEventListener("hashchange",synchronize);},[]);
  function select(value:Tab){setTab(value);if(value==="timeline")setTimelineVisited(true);window.history.replaceState(null,"",`#${value}`);}
  function keyNavigate(event:KeyboardEvent,index:number){const target=event.key==="ArrowRight"?(index+1)%tabs.length:event.key==="ArrowLeft"?(index+tabs.length-1)%tabs.length:event.key==="Home"?0:event.key==="End"?tabs.length-1:null;if(target!==null){event.preventDefault();select(tabs[target]);tabRefs.current[target]?.focus();}}
  const tag=member.profile.memberTag?`@${member.profile.memberTag}`:null;
  const selectedName=member.profile.displayName?.trim()||member.displayName.trim();
  // This is the private owner page; a generated @tag can use the owner's full name.
  const profileName=tag&&selectedName.toLowerCase()===tag?(member.profile.fullName?.trim()||"My profile"):(selectedName||"My profile");
  const [firstName,...surnameParts]=profileName.split(/\s+/);
  const surname=surnameParts.join(" ");
  const tier=memberTier(member.memberNumber);
  const next=member.nextAction;const needsAttention=["onboarding","billing","account","foundations"].includes(next.kind);
  return <main className={styles.profile} data-member-profile>
    <header className={styles.identity}>
      <figure className={styles.polaroid} aria-label={member.avatarUrl?"Member portrait":"Portrait not added"} data-member-polaroid><div className={styles.photo}><Image src={member.avatarUrl??"/membership/portrait-pending-editorial.webp"} alt="" fill sizes="(max-width: 359px) 128px, (max-width: 700px) 156px, 208px" priority unoptimized/></div><Image className={styles.frame} src="/membership/polaroid-frame.png" alt="" fill sizes="(max-width: 359px) 128px, (max-width: 700px) 156px, 208px" priority unoptimized/><figcaption>{member.avatarUrl?"This is you":"Photo pending"}</figcaption></figure>
      <div className={styles.nameBlock}>
        <h1 aria-label={profileName}><span className={styles.firstName}>{firstName}</span>{surname?<span className={styles.surname}>{surname}</span>:null}</h1>
        {tag?<p className={styles.memberTag}>{tag}</p>:null}
        <div className={styles.memberBadge}>
          <span className={styles.memberLeaf} aria-hidden="true" style={{maskImage:"url(/ruined-mark.svg)",WebkitMaskImage:"url(/ruined-mark.svg)"}}/>
          <span className={styles.badgeDetails}><span className={styles.badgeLabel}>{tier?.label??(member.identity.standingState==="active"?"Member":"My Ruined")}</span>{tier?<span className={styles.badgeNumber}><span className={styles.badgeDivider} aria-hidden="true">·</span>No. {tier.displayNumber}</span>:null}</span>
        </div>
      </div>
      {member.profile.bio?<p className={styles.bio}>{member.profile.bio}</p>:<p className={styles.bio}>A little space of your own.</p>}
      <div className={styles.identityActions}><Link className="member-button" href="/my/profile"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="m13 3 4 4M3 13 14 2l4 4L7 17l-5 1Z"/></svg>Edit profile</Link><Link className="member-button" href="/my/card">My Card ↗</Link><Link className="member-button" href="/my/invitation">My Invitation ↗</Link></div>
      {member.memberSince?<p className={styles.memberSince}>Member since {new Date(member.memberSince).getUTCFullYear()}</p>:null}
    </header>

    <div className={styles.tabs} role="tablist" aria-label="Your profile">{tabs.map((value,index)=><button type="button" role="tab" aria-selected={tab===value} aria-controls={`${id}-${value === "journal" || value === "saved" ? "entries" : value}-panel`} id={`${id}-${value}-tab`} tabIndex={tab===value?0:-1} onClick={()=>select(value)} onKeyDown={event=>keyNavigate(event,index)} ref={element=>{tabRefs.current[index]=element;}} key={value}>{value[0].toUpperCase()+value.slice(1)}{value==="timeline"||value==="saved"?<svg aria-label="Private" width="11" height="13" viewBox="0 0 12 14" fill="none" stroke="currentColor"><rect x="1" y="6" width="10" height="7" rx="1"/><path d="M3 6V4a3 3 0 0 1 6 0v2"/></svg>:null}</button>)}</div>
    <div role="tabpanel" id={`${id}-entries-panel`} aria-labelledby={`${id}-${tab==="saved"?"saved":"journal"}-tab`} hidden={tab!=="journal"&&tab!=="saved"} tabIndex={0}><MemberJournal preview={preview} writable={memberCan(member.access,"profile.write")} view={tab==="saved"?"saved":"journal"}/></div>
    <div role="tabpanel" id={`${id}-timeline-panel`} aria-labelledby={`${id}-timeline-tab`} hidden={tab!=="timeline"} tabIndex={0}>{timelineVisited?<><div className={styles.timelineHeader}><h2 className="member-handwritten">Your story, so far</h2><p className={styles.muted}>Your timeline is private. Add the moments that shaped you.</p></div>{timeline??<div className="member-card"><p>Your timeline is available through Foundations.</p><Link href="/my/foundations" className="member-button">Open Foundations →</Link></div>}</>:null}</div>
    <div role="tabpanel" id={`${id}-about-panel`} aria-labelledby={`${id}-about-tab`} hidden={tab!=="about"} tabIndex={0}><MembershipRecord member={member}/></div>
    {next?<aside className={styles.nextAction} data-member-next-action aria-label="Your next step"><div><span className={styles.nextLabel}>{next.kind==="foundations"?"Pick up where you left off.":needsAttention?"Your next step":"Worth a look"}</span><p>{next.title}</p>{next.kind==="foundations" && memberCan(member.access,"foundations.summary") ? <div className={styles.progressTicks} role="progressbar" aria-label="Foundations progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,Math.max(0,member.foundations.progressPercent))}>{Array.from({length:6},(_,index)=><span key={index} data-state={index<Math.floor(member.foundations.progressPercent/100*6)?"complete":index===Math.floor(member.foundations.progressPercent/100*6)?"next":"waiting"}/>)}</div> : needsAttention?<span className={styles.nextBody}>{next.body}</span>:null}</div><Link href={next.href} className={`member-button ${needsAttention?"member-button-primary":""}`}>{needsAttention?"Continue":"Open"}<span aria-hidden="true">→</span></Link></aside>:null}
  </main>;
}
