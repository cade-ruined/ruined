// Scope: the reviewed 2027 call manifest only. Default mode is read-only status.
// --apply stages drafts then publishes. --sync runs the existing durable worker
// only for manifest IDs. Both require --approved-sha256=<reviewed file hash>.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import postgres from 'postgres';
import {applicationSourceLoader} from './lib/application-source-loader.mjs';
import {buildCalendarPublicationPlan,CALENDAR_PLAN_VERSION} from './lib/calendar-publication-plan.mjs';

const arg=name=>process.argv.find(value=>value.startsWith(`${name}=`))?.slice(name.length+1);
const mode=process.argv.includes('--apply')?'apply':process.argv.includes('--sync')?'sync':process.argv.includes('--inherit')?'inherit':'status';
const planFile=resolve(arg('--plan')??resolve(import.meta.dirname,'../../outputs/date-refresh-20261117/calendar-2027-plan.json'));
const raw=readFileSync(planFile,'utf8'),hash=createHash('sha256').update(raw).digest('hex'),plan=JSON.parse(raw);
const actor='805f989b-ce32-41c0-a9f9-f331873d4167';
if(plan.version!==CALENDAR_PLAN_VERSION||plan.calls.length!==120||plan.byob.length||plan.circles.length!==1||plan.circles[0].id!=='e140cf3c-dd56-4164-b7e4-6c97fbd39d3e')throw new Error('Unexpected approved calendar scope.');
if(mode!=='status'&&arg('--approved-sha256')!==hash)throw new Error('Mutations require the exact reviewed plan hash.');
if(!process.env.DATABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_URL)throw new Error('Load the configured production environment securely.');
const databaseUrl=new URL(process.env.DATABASE_URL),project=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if(!decodeURIComponent(databaseUrl.username).includes(project)&&!databaseUrl.hostname.includes(project))throw new Error('Database and Supabase project identities do not match.');
const sql=postgres(process.env.DATABASE_URL,{ssl:'require',prepare:false,max:1,connect_timeout:10,idle_timeout:5});
const load=applicationSourceLoader({'@/lib/database/server':{getApplicationDatabase:()=>sql}});
const schedule=load('src/lib/membership/foundations-schedule.ts');
const closures=load('src/lib/membership/calendar-closures.ts').RUINED_CALENDAR_CLOSURES;
if(JSON.stringify(plan)!==JSON.stringify(buildCalendarPublicationPlan(plan.circles,schedule.foundationsBillingScheduleForMonth,closures)))throw new Error('Manifest no longer matches the reviewed schedule implementation.');
const keys=plan.calls.map(call=>`experience-create:${actor}:${call.requestId}`);
const journal={planHash:hash,mode,startedAt:new Date().toISOString(),events:[]};
const save=()=>writeFileSync(resolve(dirname(planFile),`calendar-2027-${mode}-result.json`),JSON.stringify(journal,null,2)+'\n');
async function readRows() {
  return sql.begin('read only',async tx=>{
    await tx`set local statement_timeout='30s'`;
    return tx`select a.dedupe_key,e.*,b.kind as cadence_kind,b.track as cadence_track,b.cohort_month,
      l.status as calendar_status,l.provider_event_id,l.meet_url,l.organizer_email,l.desired_experience_version,l.synced_experience_version,
      l.desired_attendee_revision,l.synced_attendee_revision,l.last_failure_code,
      r.attendee_count,r.event_snapshot,r.status as request_status,p.active as cadence_plan_active,p.sequence_revision as inherited_sequence_revision,s.revision as sequence_revision,s.active as sequence_active
      from operator_audit_events a join experiences e on e.id=a.subject_id::uuid
      left join private.member_email_cadence_event_bindings b on b.experience_id=e.id
      left join experience_calendar_links l on l.experience_id=e.id
      left join private.member_email_cadence_plans p on p.experience_id=e.id
      left join private.member_email_cadence_sequences s on s.id=p.sequence_id
      left join lateral (select * from experience_calendar_sync_requests sr where sr.experience_id=e.id and sr.status='succeeded' order by sr.completed_at desc,sr.created_at desc limit 1) r on true
      where a.dedupe_key=any(${keys}::text[]) and a.action='experience.created' and a.actor_auth_user_id=${actor}::uuid order by e.starts_at,e.id`;
  });
}
function checkRow(row,call) {
  const d=call.draft;
  for(const [key,value] of Object.entries({title:d.title,kind:d.kind,summary:d.summary,details:d.details,timezone:d.timezone,location_label:d.locationLabel,visibility:d.visibility,circle_id:d.circleId,block_id:d.blockId,registration_mode:d.registrationMode,capacity:d.capacity,waitlist_enabled:d.waitlistEnabled,external_registration_url:d.externalRegistrationUrl,registration_opens_at:d.registrationOpensAt,registration_closes_at:d.registrationClosesAt})) {
    if(row[key]!==value)throw new Error(`Existing event changed: ${call.key} ${key}`);
  }
  if(new Date(row.starts_at).toISOString()!==d.startsAt||new Date(row.ends_at).toISOString()!==d.endsAt)throw new Error(`Existing event timing changed: ${call.key}`);
  if(row.cadence_kind!==d.emailCadence.kind||row.cadence_track!==d.emailCadence.track||(row.cohort_month??null)!==(d.emailCadence.cohortMonth??null))throw new Error(`Existing call sequence changed: ${call.key}`);
  if(!['draft','published'].includes(row.status))throw new Error(`Existing event no longer publishable: ${call.key}`);
  if(JSON.stringify(row.metadata?.badge_credit)!==JSON.stringify(d.badgeCredit)) {
    for(const key of ['track','stage','month'])if(row.metadata?.badge_credit?.[key]!==d.badgeCredit[key])throw new Error(`Existing badge credit changed: ${call.key}`);
  }
}
async function legacyHash(tx){const rows=await tx`select id,title,starts_at,ends_at,kind,visibility,circle_id,registration_mode,status from experiences where starts_at>='2026-01-01' and starts_at<'2027-01-01' order by id`;return createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
try {
  const preflight=await sql.begin('read only',async tx=>{
    await tx`set local statement_timeout='30s'`;
    const actors=await tx`select u.email_normalized from platform_users u join platform_role_grants g on g.auth_user_id=u.auth_user_id where u.auth_user_id=${actor}::uuid and u.status='active' and g.role_slug='ops_admin' and g.revoked_at is null`;
    if(actors.length!==1||actors[0].email_normalized!=='cade@theruinedproject.com')throw new Error('Expected active administrator is unavailable.');
    const circles=await tx`select id,name,status from circles where status in ('forming','active') order by id`;
    if(JSON.stringify(circles)!==JSON.stringify(plan.circles))throw new Error('Circle roster changed; review the plan again.');
    const calendar=await tx`select id,title,starts_at from experiences where starts_at>='2027-01-01' and starts_at<'2028-01-01' order by starts_at`;
    const [validation]=await tx`select private.ruined_valid_prepaid_schedule(${tx.json(schedule.foundationsBillingScheduleForMonth('2027-11','monthly'))}::jsonb,'monthly') as valid,
      private.ruined_complimentary_foundations_schedule('2027-11-01T12:00:00Z',null)->>'version' as version`;
    const sequences=await tx`select kind,track from private.member_email_cadence_sequences where active and track='members' order by kind`;
    return {calendar,validation,sequences,legacy:await legacyHash(tx)};
  });
  let rows=await readRows();
  const known=new Set(rows.map(row=>row.id));
  if(preflight.calendar.some(row=>!known.has(row.id)))throw new Error('Unrecognized 2027 events exist; stop to avoid duplicates.');
  const byKey=new Map(rows.map(row=>[row.dedupe_key,row]));
  for(const call of plan.calls){const row=byKey.get(`experience-create:${actor}:${call.requestId}`);if(row)checkRow(row,call);}
  if(mode!=='status') {
    if(!preflight.validation.valid||preflight.validation.version!=='foundations-prepaid-v4')throw new Error('Install and verify schedule-v4 migration before publication.');
    const calendar=load('src/lib/google/calendar.ts');
    const config=calendar.getGoogleCalendarConfigurationStatus();
    if(!config.ready||config.organizerEmail!=='connect@theruinedproject.com'||load('src/lib/google/communications.ts').googleCommunicationLivemode()!==true)throw new Error('The verified live connect@ Google Calendar connection is required.');
    const expectedSequences=['circle','foundations_01','foundations_02','foundations_03','foundations_04','membership'];
    if(JSON.stringify(preflight.sequences.map(row=>row.kind))!==JSON.stringify(expectedSequences))throw new Error('All six approved member reminder sequences must be active.');
    if(mode==='apply') {
      const repository=load('src/lib/platform/ops-experience-repository.ts');
      for(const call of plan.calls) {
        const result=await repository.createOpsExperience({actorAuthUserId:actor,draft:call.draft,requestId:call.requestId});
        journal.events.push({key:call.key,experienceId:result.experienceId,step:'staged'});save();
      }
      rows=await readRows();
      if(rows.length!==plan.calls.length)throw new Error('Not all planned drafts are staged.');
      for(const call of plan.calls)checkRow(rows.find(row=>row.dedupe_key===`experience-create:${actor}:${call.requestId}`),call);
      for(const row of rows) {
        if(row.status==='draft')await repository.transitionOpsExperience({actorAuthUserId:actor,experienceId:row.id,intent:'publish',reason:'Approved 2027 calls, monthly groups and holiday exceptions.'});
        journal.events.push({experienceId:row.id,step:'published'});save();
      }
    } else if(mode==='inherit') {
      if(rows.length!==120||rows.some(row=>row.status!=='published'||row.calendar_status!=='active'||!row.meet_url))throw new Error('All120 calls need active Meet links before reminder/cohort inheritance.');
      const configuration=load('src/lib/communications/member-email-cadence-model.ts').getMemberEmailCadenceConfiguration();
      if(!configuration.enabled||!configuration.ready)throw new Error('Existing member email cadence must be enabled and ready.');
      const pending=rows.filter(row=>row.cadence_plan_active!==true||row.sequence_active!==true||row.inherited_sequence_revision!==row.sequence_revision).map(row=>row.id);
      const result=await load('src/lib/communications/member-email-cadence-inheritance.ts').reconcileCadenceInheritance(configuration,Date.now()+20_000,pending);
      journal.events.push({step:'scoped_inheritance',...result});save();
    } else {
      const {processCalendarReconciliationForExperience}=load('src/lib/google/calendar-worker.ts');
      for(const row of rows) {
        if(row.status!=='published')throw new Error('Publish all calls before provider synchronization.');
        const result=await processCalendarReconciliationForExperience(row.id);
        journal.events.push({experienceId:row.id,...result});save();
        if(result.failed)throw new Error('A durable Calendar request needs review; remaining calls have not been manually retried.');
      }
    }
    if(await sql.begin('read only',legacyHash)!==preflight.legacy)throw new Error('Existing 2026 calls changed during application; review required.');
    rows=await readRows();
  }
  const byId=new Map(plan.calls.map(call=>[`experience-create:${actor}:${call.requestId}`,call]));
  const verification=[];
  for(const row of rows) {
    const call=byId.get(row.dedupe_key);checkRow(row,call);
    const entry={key:call.key,experienceId:row.id,state:row.status,calendarStatus:row.calendar_status,meetUrl:row.meet_url,googleEventId:row.provider_event_id,
      attendeeCount:row.attendee_count??null,cadenceReady:row.cadence_plan_active===true&&row.sequence_active===true&&row.inherited_sequence_revision===row.sequence_revision,upToDate:row.desired_experience_version===row.synced_experience_version&&row.desired_attendee_revision===row.synced_attendee_revision,lastFailureCode:row.last_failure_code};
    if(process.argv.includes('--verify-provider')&&row.provider_event_id) {
      const calendar=load('src/lib/google/calendar.ts'),model=load('src/lib/google/calendar-model.ts');
      const remote=await calendar.getRuinedOwnedGoogleCalendarEventSnapshot(row.provider_event_id);
      const result=model.toGoogleCalendarEventResult(remote,'connect@theruinedproject.com');
      const expected=(row.event_snapshot?.attendees??[]).map(person=>person.email.toLowerCase()).sort();
      const actual=(remote.attendees??[]).map(person=>person.email?.toLowerCase()).filter(email=>email&&email!=='connect@theruinedproject.com').sort();
      entry.providerVerified=result.organizerVerified&&result.meetReady&&result.status==='confirmed'&&result.meetUrl===row.meet_url
        &&remote.summary===call.draft.title&&Date.parse(remote.start?.dateTime)===Date.parse(call.draft.startsAt)&&Date.parse(remote.end?.dateTime)===Date.parse(call.draft.endsAt)
        &&JSON.stringify([...new Set(actual)])===JSON.stringify([...new Set(expected)]);
      entry.providerAttendeeCount=actual.length;
    }
    verification.push(entry);
  }
  journal.verification=verification;journal.summary={planned:120,found:rows.length,published:rows.filter(row=>row.status==='published').length,activeGoogleLinks:rows.filter(row=>row.calendar_status==='active'&&row.meet_url).length,
    providerVerified:verification.filter(row=>row.providerVerified).length,cadenceReady:verification.filter(row=>row.cadenceReady).length,scheduleV4:preflight.validation.valid&&preflight.validation.version==='foundations-prepaid-v4',existing2026Preserved:true};
  if(process.argv.includes('--verify-provider')&&(verification.length!==120||verification.some(row=>row.state!=='published'||row.calendarStatus!=='active'||!row.upToDate||!row.cadenceReady||!row.providerVerified)))throw new Error('Calendar verification is incomplete; inspect saved status results before reporting completion.');
  journal.completedAt=new Date().toISOString();save();console.log(JSON.stringify(journal.summary,null,2));
} catch(error) {
  journal.error={code:error.code??error.name,message:error.message};save();console.error(JSON.stringify(journal.error));process.exitCode=1;
} finally {await sql.end({timeout:5});}
