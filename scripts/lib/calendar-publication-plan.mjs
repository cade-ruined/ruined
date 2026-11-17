import { createHash } from 'node:crypto';

export const CALENDAR_PLAN_VERSION = 'ruined-2027-calls-20261117';
const ZONE = 'America/Denver';
const stageNames = ['SEE', 'FACE', 'CUT', 'GROW'];
const circleStages = ['WHY', 'BUILD'];
const pad = value => String(value).padStart(2, '0');
const monthName = month => new Intl.DateTimeFormat('en-US', {month: 'long', timeZone: 'UTC'}).format(new Date(Date.UTC(2027, month - 1, 1)));
const occurrence = (month, weekday, ordinal) => 1 + (weekday - new Date(Date.UTC(2027, month - 1, 1)).getUTCDay() + 7) % 7 + (ordinal - 1) * 7;
function denverCall(month, day) {
  const civil = Date.UTC(2027, month - 1, day, 15);
  let instant = civil;
  const format = new Intl.DateTimeFormat('en-US', {timeZone: ZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(format.formatToParts(new Date(instant)).filter(item=>item.type!=='literal').map(item=>[item.type, Number(item.value)]));
    const delta = civil - Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    instant += delta;
    if (!delta) return new Date(instant).toISOString();
  }
  throw new Error('Could not resolve Mountain call time.');
}
export function calendarRequestId(key) {
  const hash=createHash('sha256').update(`${CALENDAR_PLAN_VERSION}:${key}`).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
export function buildCalendarPublicationPlan(circles, foundationsSchedule, closures) {
  const calls=[];
  function add(key, date, title, details, audience, fields) {
    const draft={blockId:null,capacity:null,circleId:null,details,endsAt:new Date(Date.parse(date)+90*60000).toISOString(),externalRegistrationUrl:null,
      kind:'weekly_call',locationLabel:'Google Meet',registrationClosesAt:null,registrationMode:'none',registrationOpensAt:null,startsAt:date,
      summary:details,timezone:ZONE,title,visibility:'all_members',waitlistEnabled:false,...fields};
    calls.push({key,requestId:calendarRequestId(key),audience,draft});
  }
  for (let month=1;month<=12;month++) {
    const cohort=`2027-${pad(month)}`, name=monthName(month), topic=month===1?'REINVENTION':null;
    foundationsSchedule(cohort,'monthly').callStartsAt.forEach((date,index)=>add(`foundations:${cohort}:${index+1}`,date,
      `RU/NED | Foundations ${index+1} — ${name} Group`, `Foundations ${index+1} for the ${name} 2027 group.`,
      'Assigned paid/complimentary cohort plus standing founders',
      {kind:'academy_session',visibility:'invite_only',registrationMode:'internal',emailCadence:{kind:`foundations_0${index+1}`,track:'members',cohortMonth:cohort},badgeCredit:{track:'none',stage:null,month:null}}));
    const membershipDays=month===12?[1,7,14,28]:[1,2,3,4].map(ordinal=>occurrence(month,2,ordinal));
    membershipDays.forEach((day,index)=>add(`membership:${cohort}:${index+1}`,denverCall(month,day),
      `RU/NED | ${topic??'Membership'} — ${stageNames[index]}`, `${topic?'Reinvention':`${name} 2027 membership`}: ${stageNames[index].toLowerCase()}.`,
      'All active eligible members plus standing founders',
      {emailCadence:{kind:'membership',track:'members'},badgeCredit:{track:'membership',stage:stageNames[index].toLowerCase(),month:cohort}}));
    const circleDays=month===11?[10,17]:month===12?[8,15]:[2,4].map(ordinal=>occurrence(month,3,ordinal));
    for(const circle of [...circles].sort((a,b)=>a.id.localeCompare(b.id))) circleDays.forEach((day,index)=>add(`circle:${circle.id}:${cohort}:${index+1}`,denverCall(month,day),
      `RU/NED | ${circle.name} — ${topic?`${topic} / `:''}${circleStages[index]}`,
      `${name} 2027 ${circle.name}: ${index===0?'why':'build'}.`, `${circle.name} members plus standing founders`,
      {kind:'circle_meeting',visibility:'circle',circleId:circle.id,emailCadence:{kind:'circle',track:'members'},badgeCredit:{track:'circle',stage:index===0?'why':'implementation',month:cohort}}));
  }
  calls.sort((a,b)=>a.draft.startsAt.localeCompare(b.draft.startsAt)||a.key.localeCompare(b.key));
  for (const call of calls) {
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(call.draft.startsAt));
    if(closures.some(c=>day>=c.startDate&&day<c.endDateExclusive)) throw new Error(`${call.key} collides with a closure.`);
  }
  if(new Set(calls.map(c=>c.requestId)).size!==calls.length) throw new Error('Duplicate calendar request.');
  return {version:CALENDAR_PLAN_VERSION,timeZone:ZONE,durationMinutes:90,preserveExisting2026:true,byob:[],circles,calls,closures};
}
