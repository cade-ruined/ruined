import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'..');

test('completed BYOB dates retain their history while November is announced without registration',async()=>{
 const source=await readFile(path.join(root,'src/data/events.ts'),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const exports={};
 vm.runInNewContext(outputText,{exports,require:()=>({BYOB_01_GALLERY:[{src:'/events/byob-01/gallery/01-img-8059.webp?v=1'}]})});
 const events=JSON.parse(JSON.stringify(exports.EVENTS));
 assert.deepEqual(events.map(e=>[e.id,e.status]),[['byob-01','Ended'],['byob-02','Ended'],['byob-03','Ended'],['byob-04','Upcoming']]);
 assert.deepEqual(events.slice(0,3).map(e=>e.dateTime),[
  '2026-08-14T14:00:00.000Z','2026-09-11T14:00:00.000Z','2026-10-09T14:00:00.000Z',
 ]);
 const recap=events.find(e=>e.id==='byob-02');
 assert.equal(recap.video,'/events/byob-02-recap.mp4');
 assert.equal(recap.videoPoster,'/events/byob-02-recap-poster.webp');
 assert.equal(recap.image,recap.videoPoster);
 assert.equal(recap.registration.status,'Closed');
 const october=events.find(e=>e.id==='byob-03');
 assert.equal(october.video,'/events/byob-03-recap.mp4');
 assert.equal(october.videoPoster,'/events/byob-03-recap-poster.webp');
 assert.equal(october.image,october.videoPoster);
 assert.equal(october.time,'8:00 AM MDT');
 assert.equal(october.location,'Tibble Fork Reservoir · Hill south of the parking lot');
 assert.deepEqual(october.registration,{href:'/community/byob-03/register',label:'Register',status:'Closed'});
 const upcoming=events.find(e=>e.id==='byob-04');
 assert.equal(upcoming.image,'/events/byob-key-art.png');
 assert.equal(upcoming.date,'14 November 2026');
 assert.equal(upcoming.dateTime,'2026-11-14T16:00:00.000Z');
 assert.equal(upcoming.dateOnly,undefined);
 assert.equal(upcoming.time,'9:00 AM MST');
 assert.equal(upcoming.timezone,'America/Denver');
 assert.equal(upcoming.registration,undefined);
});

for (const number of ['02', '03']) test(`BYOB${number} recap has web-sized media with playback metadata at the front`,async()=>{
 const mp4=await readFile(path.join(root,`public/events/byob-${number}-recap.mp4`));
 const budget = number === '03' ? 4 : 16;
 assert.ok(mp4.length<budget*1024*1024,`Recap exceeds ${budget}MiB web budget`);
 const moov=mp4.indexOf('moov');const mdat=mp4.indexOf('mdat');
 assert.ok(moov>=0&&mdat>moov,'MP4 must support fast-start playback');
 const posterPath=path.join(root,`public/events/byob-${number}-recap-poster.webp`);
 const metadata=await sharp(posterPath).metadata();
 assert.equal(metadata.width,720);assert.equal(metadata.height,1280);
 assert.ok((await stat(posterPath)).size<150*1024);
});
