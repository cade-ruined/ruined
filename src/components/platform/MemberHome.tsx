"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import InstallRuined from "@/components/membership/InstallRuined";
import MemberBadges from "@/components/membership/MemberBadges";
import MemberJournal from "@/components/membership/MemberJournal";
import { useMemberPortrait } from "@/components/membership/MemberPortraitState";
import { memberCan } from "@/lib/membership/access-policy";
import { memberTier } from "@/lib/membership/member-number";
import type { MemberHomeSnapshot } from "@/lib/membership/model";
import styles from "./MemberProfile.module.css";

const tabs=["journal","timeline"] as const;
type JournalMode="all"|"timeline";
type Tab=typeof tabs[number];
export default function MemberHome({member,preview=false}:{member:MemberHomeSnapshot;preview?:boolean}) {
  const {avatarUrl}=useMemberPortrait(member.avatarUrl);
  const [tab,setTab]=useState<Tab>("journal");const [journalMode,setJournalMode]=useState<JournalMode>("all");const tabRefs=useRef<(HTMLButtonElement|null)[]>([]);const id=useId();
  useEffect(()=>{
    function synchronize(){
      const value=window.location.hash.slice(1);
      if(value==="timeline"||value==="saved"){setTab("timeline");setJournalMode("timeline");}
      else {setTab("journal");setJournalMode("all");}
    }
    synchronize();
    window.addEventListener("hashchange",synchronize);
    window.addEventListener("popstate",synchronize);
    return()=>{window.removeEventListener("hashchange",synchronize);window.removeEventListener("popstate",synchronize);};
  },[]);
  function select(value:Tab){
    setTab(value);
    if(value==="journal"||value==="timeline")setJournalMode(value==="timeline"?"timeline":"all");
    window.history.replaceState(window.history.state,"",`#${value}`);
  }
  function keyNavigate(event:KeyboardEvent,index:number){const target=event.key==="ArrowRight"?(index+1)%tabs.length:event.key==="ArrowLeft"?(index+tabs.length-1)%tabs.length:event.key==="Home"?0:event.key==="End"?tabs.length-1:null;if(target!==null){event.preventDefault();select(tabs[target]);tabRefs.current[target]?.focus();}}
  const tag=member.profile.memberTag?`@${member.profile.memberTag}`:null;
  const selectedName=member.profile.displayName?.trim()||member.displayName.trim();
  // This is the private owner page; a generated @tag can use the owner's full name.
  const profileName=tag&&selectedName.toLowerCase()===tag?(member.profile.fullName?.trim()||"My profile"):(selectedName||"My profile");
  const [firstName,...surnameParts]=profileName.split(/\s+/);
  const surname=surnameParts.join(" ");
  const tier=memberTier(member.memberNumber);
  return <main className={styles.profile} data-member-profile>
    <header className={styles.identity}>
      <figure className={styles.polaroid} aria-label={avatarUrl?"Member portrait":"Portrait not added"} data-member-polaroid><div className={styles.photo}><Image src={avatarUrl??"/membership/portrait-pending-editorial.webp"} alt="" fill sizes="(max-width: 359px) 128px, (max-width: 700px) 156px, 208px" priority unoptimized/></div><Image className={styles.frame} src="/membership/polaroid-frame.png" alt="" fill sizes="(max-width: 359px) 128px, (max-width: 700px) 156px, 208px" priority unoptimized/><figcaption>{avatarUrl?"the ruined project":"Add your photo"}</figcaption>{!avatarUrl?<Link className="absolute inset-0 z-10" href="/my/profile" aria-label="Add your profile photo"/>:null}</figure>
      <div className={styles.nameBlock}>
        <h1 aria-label={profileName}><span className={styles.firstName}>{firstName}</span>{surname?<span className={styles.surname}>{surname}</span>:null}</h1>
        {tag?<p className={styles.memberTag}>{tag}</p>:null}
        <div className={styles.memberBadge}>
          <span className={styles.memberLeaf} aria-hidden="true" style={{maskImage:"url(/ruined-mark.svg)",WebkitMaskImage:"url(/ruined-mark.svg)"}}/>
          <span className={styles.badgeDetails}><span className={styles.badgeLabel}>{tier?.label??(member.identity.standingState==="active"?"Member":"My Ruined")}</span>{tier?<span className={styles.badgeNumber}><span className={styles.badgeDivider} aria-hidden="true">·</span>No. {tier.displayNumber}</span>:null}</span>
        </div>
        {member.memberSince?<p className={styles.memberSince}>Member since {new Date(member.memberSince).getUTCFullYear()}</p>:null}
      </div>
      {member.profile.bio?<p className={styles.bio}>{member.profile.bio}</p>:<p className={styles.bio}>A little space of your own.</p>}
      <div className={styles.identityActions}><Link className="member-button" href="/my/profile"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="m13 3 4 4M3 13 14 2l4 4L7 17l-5 1Z"/></svg>Edit profile</Link><Link className="member-button" href="/my/card">My Card ↗</Link><Link className="member-button" href="/my/invitation">My Invitation ↗</Link></div>
      {member.badges?.length ? <div className={styles.earnedBadges}><MemberBadges badges={member.badges} preview={preview}/></div> : null}
    </header>

    <InstallRuined variant="profile"/>

    <MemberJournal preview={preview} sharingEnabled writable={memberCan(member.access,"profile.write")} initialMode={journalMode} onModeChange={mode=>select(mode==="timeline"?"timeline":"journal")} renderLayout={(content,addEntryAction)=><>
      <div className={styles.profileControls}>
        <div className={styles.tabs} role="tablist" aria-label="Your profile">{tabs.map((value,index)=><button type="button" role="tab" aria-selected={tab===value} aria-controls={`${id}-entries-panel`} id={`${id}-${value}-tab`} tabIndex={tab===value?0:-1} onClick={()=>select(value)} onKeyDown={event=>keyNavigate(event,index)} ref={element=>{tabRefs.current[index]=element;}} key={value}>{value[0].toUpperCase()+value.slice(1)}{value==="timeline"?<svg aria-label="Private" width="11" height="13" viewBox="0 0 12 14" fill="none" stroke="currentColor"><rect x="1" y="6" width="10" height="7" rx="1"/><path d="M3 6V4a3 3 0 0 1 6 0v2"/></svg>:null}</button>)}</div>
        <div className={styles.entryAction}>{addEntryAction}</div>
      </div>
      <div role="tabpanel" id={`${id}-entries-panel`} aria-labelledby={`${id}-${tab}-tab`} tabIndex={0}>{content}</div>
    </>}/>
  </main>;
}
