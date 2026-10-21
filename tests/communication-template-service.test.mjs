import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { json, serializeJsonBindings } from './helpers/postgres-json-bindings.mjs';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
async function load(path,deps={}) {
  const source=ts.transpileModule(await read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{}};new Function('require','module','exports',source)(name=>{assert.ok(name in deps,`Unexpected import ${name}`);return deps[name];},loaded,loaded.exports);return loaded.exports;
}
const manual=await load('src/lib/communications/cade-communications.ts');
class AdminEmailError extends Error {constructor(status,message){super(message);this.status=status;}}
const registration={getRegistrationEditableTemplate:()=>({subject:'Hello {{member_name}}',body:'Welcome, {{member_name}}.',tokens:['{{member_name}}']}),validateRegistrationTemplateOverride:(_kind,copy)=>copy};
async function fixture(t) {
  const db=new PGlite();t.after(()=>db.close());const actor=randomUUID();
  await db.exec(`create role anon;create role authenticated;create schema private;create table platform_users(auth_user_id uuid primary key);
    create table operator_audit_events(actor_auth_user_id uuid,action text,subject_type text,subject_id text,metadata jsonb);`);
  await db.query('insert into platform_users values($1)',[actor]);
  await db.exec(await read('db/migrations/20261021193000_member_communication_template_overrides.sql'));
  function bridge(engine) {
    const sql=(strings,...values)=>engine.query(strings.reduce((out,text,i)=>out+(i?'$'+i:'')+text,''),serializeJsonBindings(strings,values)).then(result=>result.rows);
    sql.json=json;sql.begin=action=>engine.transaction(tx=>action(bridge(tx)));return sql;
  }
  const service=await load('src/lib/communications/communication-template-service.ts',{'server-only':{},'@/lib/database/server':{getApplicationDatabase:()=>bridge(db)},
    '@/lib/membership/registration-email':registration,'./admin-email-model':{AdminEmailError},'./admin-email-repository':{requireAdminEmailActor:async(_tx,id)=>{if(id!==actor)throw new AdminEmailError(403,'Administrator required');}},'./cade-communications':manual});
  return {db,actor,service};
}
test('manual template edits persist with audit and prevent stale overwrite',async t=>{
  const {db,actor,service}=await fixture(t);const key='manual:platform-update';
  const initial=await service.readCommunicationTemplate(actor,key);assert.equal(initial.revision,0);assert.match(initial.body,/\[/);
  const saved=await service.updateCommunicationTemplate(actor,{key,revision:0,subject:'New capability',body:'{{unfinished}} is intentionally allowed in reusable manual copy.'});
  assert.equal(saved.revision,1);assert.equal((await service.readCommunicationTemplate(actor,key)).body,saved.body);
  await assert.rejects(service.updateCommunicationTemplate(actor,{key,revision:0,subject:'stale',body:'stale'}),error=>error.status===409);
  assert.equal((await db.query('select count(*)::int as n from operator_audit_events')).rows[0].n,1);
  assert.equal((await db.query("select has_table_privilege('authenticated','private.member_communication_template_overrides','SELECT') as allowed")).rows[0].allowed,false);
});
test('templates require current admin, known key, expected revision, plain text and allowed fields',async t=>{
  const {actor,service}=await fixture(t);
  await assert.rejects(service.readCommunicationTemplate(randomUUID(),'registration:welcome'),error=>error.status===403);
  for(const key of ['missed-session','registration:missed','manual:unknown'])assert.throws(()=>service.communicationTemplateDefaults(key));
  const valid={key:'registration:welcome',revision:0,subject:'Hi {{member_name}}',body:'Welcome.'};
  assert.deepEqual(service.validateCommunicationTemplate(valid).body,'Welcome.');
  for(const update of [{revision:undefined},{subject:'bad\nheader'},{body:'<img>'},{body:'{{private_work}}'},{body:'{{broken'}])assert.throws(()=>service.validateCommunicationTemplate({...valid,...update}));
  const text=await service.updateCommunicationTemplate(actor,{key:'manual:urgent-text',revision:0,subject:'',body:'A revised call time: [DATE].'});assert.equal(text.subject,'');
  assert.throws(()=>service.validateCommunicationTemplate({...valid,subject:''}));
});
