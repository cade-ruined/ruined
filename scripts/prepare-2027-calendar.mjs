// Offline preparation only. No database, Google Calendar or email calls.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {applicationSourceLoader} from './lib/application-source-loader.mjs';
import {buildCalendarPublicationPlan} from './lib/calendar-publication-plan.mjs';
const root=resolve(import.meta.dirname,'..');
const load=applicationSourceLoader();
const out=resolve(process.argv[2]??resolve(root,'../outputs/date-refresh-20261117'));
const preflight=JSON.parse(readFileSync(resolve(out,'calendar-preflight.json'),'utf8'));
const {foundationsBillingScheduleForMonth}=load('src/lib/membership/foundations-schedule.ts');
const {RUINED_CALENDAR_CLOSURES:closures}=load('src/lib/membership/calendar-closures.ts');
const plan=buildCalendarPublicationPlan(preflight.circles,foundationsBillingScheduleForMonth,closures);
const json=JSON.stringify(plan,null,2)+'\n',sha256=createHash('sha256').update(json).digest('hex');
mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'calendar-2027-plan.json'),json);
const format=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',dateStyle:'full',timeStyle:'short'});
const escape=value=>`"${String(value).replaceAll('"','""')}"`;
writeFileSync(resolve(out,'calendar-2027-plan.csv'),['Title,Mountain time,Audience,Sequence,Request ID',...plan.calls.map(c=>[c.draft.title,format.format(new Date(c.draft.startsAt)),c.audience,c.draft.emailCadence.kind,c.requestId].map(escape).join(','))].join('\n')+'\n');
const rows=Array.from({length:12},(_,i)=>{
 const month=`2027-${String(i+1).padStart(2,'0')}`;
 const days=kind=>plan.calls.filter(c=>c.key.startsWith(kind)&&c.draft.startsAt.startsWith(month)).map(c=>new Date(c.draft.startsAt).getUTCDate()).join(', ');
 return `| ${month} | ${days('foundations:')} | ${days('membership:')} | ${days('circle:')} |`;
});
writeFileSync(resolve(out,'calendar-2027-review.md'),`# 2027 calendar publication plan\n\n${plan.calls.length} calls: 48 Foundations, 48 Membership, ${24*preflight.circles.length} Circle. Every call is 3:00–4:30 PM America/Denver, with daylight-saving changes applied. No BYOB dates. Existing 2026 calls remain untouched.\n\n| Month | Foundations | Membership | Circle |\n|---|---|---|---|\n${rows.join('\n')}\n\n## Audiences\n\nFoundations: members assigned to that paid or complimentary cohort. Membership: active eligible members. Circle: members of the named Circle. Standing founders receive all calls. Currently only Founders Circle is configured. Existing approved reminder sequences attach by explicit call type; no one-off announcement is sent by this plan.\n\n## Closures\n\n${closures.map(c=>`- ${c.title}: ${c.startDate} through ${new Date(Date.parse(c.endDateExclusive)-86400000).toISOString().slice(0,10)}`).join('\n')}\n\nThese are informational all-day calendar entries, with no Meet, RSVP or reminder emails.\n\n## Safe application\n\nApply schedule-v4 migration first, preserving every v1–v3 accepted offer. Create drafts using stable request IDs and full-draft fingerprints; stage all drafts before publication. Refuse conflicting existing 2027 events. Publish through the guarded operator service, then let the existing durable calendar worker create connect@ events and Meet links. Check every published event against its approved title, time, audience, cadence binding and active Google link. Existing cohort/standing-founder workers maintain recipients. A retry resolves the same request IDs, never duplicates them.\n\nPlan SHA-256: ${sha256}\n`);
console.log(JSON.stringify({calls:plan.calls.length,closures:closures.length,sha256,out},null,2));
