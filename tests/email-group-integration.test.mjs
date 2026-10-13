import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { loader, read } from "./helpers/member-sms-fixture.mjs";

function bridge(engine) {
  class Query {
    constructor(strings,values) { this.strings=strings;this.values=values; }
    compile(parameters) {
      let source=this.strings[0];
      this.values.forEach((value,index)=>{
        if(value instanceof Query) source+=value.compile(parameters);
        else {parameters.push(value instanceof Date?value.toISOString():value);source+="$"+parameters.length;}
        source+=this.strings[index+1];
      }); return source;
    }
    then(resolve,reject) {const parameters=[];return engine.query(this.compile(parameters),parameters).then(result=>result.rows).then(resolve,reject);}
  }
  const sql=(strings,...values)=>new Query(strings,values);
  sql.json=JSON.stringify;sql.begin=callback=>engine.transaction(tx=>callback(bridge(tx)));return sql;
}
async function fixture(t) {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec("create role anon;create role authenticated;create role service_role;");
  for(const match of read("scripts/migrate-platform.mjs").matchAll(/"\.\.\/(db\/migrations\/[^"]+)"/g)) await db.exec(read(match[1]));
  const sql=bridge(db),actor=randomUUID(),topic=randomUUID(),template=randomUUID(),contacts=[],sends=[];
  await db.query("insert into platform_users(auth_user_id,email_normalized,user_type,status) values($1,'groups-admin@example.test','staff','active')",[actor]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[actor]);
  const env={RESEND_API_KEY:"fake-test-key",ADMIN_EMAIL_SENDING_ENABLED:"true",ADMIN_EMAIL_GROUP_SENDING_ENABLED:"true",CRON_SECRET:"fake-cron",RESEND_TOPIC_UPDATES_ID:topic};
  const message={from:"Ruined <hello@example.test>",replyTo:[],subject:"A group update",html:'<p>Hello {{{contact.first_name|friend}}}</p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>',text:"A group update"};
  const load=loader(env,{
    "@/lib/database/server":{getApplicationDatabase:()=>sql},
    "@/lib/platform/config":{getPlatformConfiguration:()=>({mode:"connected"})},
    "./resend-email-service":{
      prepareResendEmail:async()=>message,
      listResendEmailRecords:async path=>{
        if(path==="/suppressions")return [];
        if(path==="/contacts")return contacts;
        if(path.endsWith("/topics"))return [{id:topic,subscription:"opt_in"}];
        assert.fail("Unexpected provider list "+path);
      },
      resendEmailProvider:async(path,method="GET",body,key)=>{
        if(method==="POST"&&path==="/emails"){sends.push({body,key});return {id:randomUUID()};}
        if(path==="/topics/"+topic)return {default_subscription:"opt_out"};
        if(path.startsWith("/contacts/"))return contacts.find(contact=>contact.email===decodeURIComponent(path.slice(10)));
        assert.fail("Unexpected provider request "+path);
      },
    },
  });
  const groups=load("src/lib/communications/email-group-repository.ts"),campaigns=load("src/lib/communications/email-group-campaign-service.ts");
  async function contact(email,subscribed=true) {
    const id=randomUUID();contacts.push({id,email,unsubscribed:false,first_name:"Avery",last_name:""});
    await db.query("insert into communication_contacts(id,email_normalized) values($1,$2)",[id,email]);
    await db.query("insert into communication_subscriptions(contact_id,channel,topic,status,consent_version,last_state_source,requested_at,confirmed_at) values($1,'email','about',$2,'test-confirmed','about',now(),case when $3 then now() else null end)",[id,subscribed?"subscribed":"pending_confirmation",subscribed]);
    return {email,name:""};
  }
  async function campaign(group) {
    return (await campaigns.saveEmailGroupCampaign(actor,{name:"Reviewed group update",groupId:group.id,groupRevision:group.revision,purpose:"general_updates",templateId:template,templateVersion:"version-1",edits:{subject:"A group update",values:{},copy:{}}})).campaign;
  }
  async function reviewed(group) {const draft=await campaign(group);return campaigns.reviewEmailGroupCampaign(actor,draft.id,draft.revision);}
  return {db,actor,groups,campaigns,contact,campaign,reviewed,sends};
}

test("real group and campaign repositories preserve consent and frozen audiences across the complete schema",async t=>{
  const f=await fixture(t);
  const subscribed=await f.contact("confirmed@example.test"),pending=await f.contact("pending@example.test",false);
  const manual=await f.groups.saveEmailGroup(f.actor,{name:"Selected people",description:"Manual test",mode:"manual",members:[subscribed,pending]});
  assert.equal(manual.group.memberCount,2);
  const review=await f.reviewed(manual.group);
  assert.deepEqual(review.recipients.map(person=>person.email),[subscribed.email]);
  assert.equal(review.excludedCount,1);
  await f.campaigns.queueEmailGroupCampaign(f.actor,review.id);
  await f.campaigns.queueEmailGroupCampaign(f.actor,review.id);
  assert.equal((await f.db.query("select count(*)::int as count from admin_email_group_deliveries")).rows[0].count,1);
  const result=await f.campaigns.processEmailGroupCampaignBatch();
  assert.equal(result.sent,1);assert.equal(f.sends.length,1);
  assert.deepEqual(f.sends[0].body.to,[subscribed.email]);
  const token=new URL(f.sends[0].body.headers["List-Unsubscribe"].slice(1,-1)).searchParams.get("token");
  assert.ok(token);
  assert.deepEqual(await f.campaigns.inspectEmailGroupUnsubscribe(token),{purpose:"general_updates"});
  assert.equal((await f.db.query("select count(*)::int as count from admin_email_group_withdrawals")).rows[0].count,0,"opening an unsubscribe link must not withdraw");
  await f.campaigns.unsubscribeEmailGroupCampaign(token);
  await assert.rejects(f.reviewed(manual.group),/No recipients currently qualify/);
  assert.equal((await f.db.query("select status from communication_subscriptions where contact_id=(select id from communication_contacts where email_normalized=$1)",[subscribed.email])).rows[0].status,"subscribed","native scope must not silently mutate other preferences");

  const rule=await f.groups.saveEmailGroup(f.actor,{name:"General subscribers",description:"Current confirmed contacts",mode:"rule",rule:{kind:"general_subscribers"}});
  const second=await f.contact("second@example.test");
  const secondReview=await f.reviewed(rule.group);
  assert.deepEqual(secondReview.recipients.map(person=>person.email),[second.email]);
  await f.contact("third@example.test");
  await assert.rejects(f.campaigns.queueEmailGroupCampaign(f.actor,secondReview.id),/changed/,"new rule matches require a new review");
  const fresh=await f.reviewed(rule.group);
  await f.campaigns.queueEmailGroupCampaign(f.actor,fresh.id);
  const late=await f.contact("after-queue@example.test");
  await f.campaigns.processEmailGroupCampaignBatch();
  assert.equal(f.sends.length,3);
  assert.ok(!f.sends.some(send=>send.body.to.includes(late.email)),"new matches never enter an already queued campaign");
  const beforeArchive=await f.reviewed(rule.group);
  await f.campaigns.queueEmailGroupCampaign(f.actor,beforeArchive.id);
  await f.groups.archiveEmailGroup(f.actor,rule.group.id,rule.group.revision,true);
  const cancelled=await f.campaigns.processEmailGroupCampaignBatch();
  assert.equal(cancelled.cancelled,3);
  assert.equal(f.sends.length,3,"archiving prevents pending sends");
});
