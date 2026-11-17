import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve,extname,sep} from 'node:path';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'../..'),requirePackage=createRequire(resolve(root,'package.json'));
/** Run the existing guarded server repositories from a deliberate operator script. */
export function applicationSourceLoader(overrides={}) {
  const cache=new Map();
  function load(path) {
    const absolute=resolve(root,path);
    if(!absolute.startsWith(root+sep))throw new Error('Source dependency escaped repository.');
    if(cache.has(absolute))return cache.get(absolute).exports;
    const m={exports:{}};cache.set(absolute,m);
    const code=ts.transpileModule(readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX},fileName:absolute}).outputText;
    const requireSource=name=>{
      if(Object.hasOwn(overrides,name))return overrides[name];
      if(name==='server-only')return {};
      if(name.startsWith('@/')||name.startsWith('.')){
        const base=name.startsWith('@/')?resolve(root,'src',name.slice(2)):resolve(dirname(absolute),name);
        const target=[base,`${base}.ts`,`${base}.tsx`,`${base}.js`,`${base}/index.ts`].find(value=>extname(value)&&existsSync(value));
        if(!target)throw new Error(`Unresolved source import ${name}`);
        return extname(target)==='.json'?JSON.parse(readFileSync(target,'utf8')):load(target);
      }
      return requirePackage(name);
    };
    new Function('require','module','exports',code)(requireSource,m,m.exports);
    return m.exports;
  }
  return load;
}
