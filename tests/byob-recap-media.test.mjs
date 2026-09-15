import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'..');

test('October BYOB has its own signup after the two recap events',async()=>{
 const source=await readFile(path.join(root,'src/data/events.ts'),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const exports={};
 vm.runInNewContext(outputText,{exports,require:()=>({BYOB_01_GALLERY:[{src:'/events/byob-01/gallery/01-img-8059.webp?v=1'}]})});
 const events=JSON.parse(JSON.stringify(exports.EVENTS));
 assert.deepEqual(events.map(e=>[e.id,e.status]),[['byob-01','Ended'],['byob-02','Ended'],['byob-03','Upcoming']]);
 const recap=events.find(e=>e.id==='byob-02');
 assert.equal(recap.video,'/events/byob-02-recap.mp4');
 assert.equal(recap.videoPoster,'/events/byob-02-recap-poster.webp');
 assert.equal(recap.registration.status,'Closed');
 const upcoming=events.find(e=>e.id==='byob-03');
 assert.equal(upcoming.dateTime,'2026-10-09T14:00:00.000Z');
 assert.equal(upcoming.timezone,'America/Denver');
 assert.deepEqual(upcoming.registration,{href:'/community/byob-03/register',label:'Register',status:'Open'});
});

test('BYOB02 recap has web-sized media with playback metadata at the front',async()=>{
 const mp4=await readFile(path.join(root,'public/events/byob-02-recap.mp4'));
 assert.ok(mp4.length<16*1024*1024,'Recap exceeds16MiB web budget');
 const moov=mp4.indexOf('moov');const mdat=mp4.indexOf('mdat');
 assert.ok(moov>=0&&mdat>moov,'MP4 must support fast-start playback');
 const posterPath=path.join(root,'public/events/byob-02-recap-poster.webp');
 const metadata=await sharp(posterPath).metadata();
 assert.equal(metadata.width,720);assert.equal(metadata.height,1280);
 assert.ok((await stat(posterPath)).size<150*1024);
});
