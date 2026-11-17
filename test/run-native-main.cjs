// Runs native-main-trace.cjs under Electron (hidden window, temp user dir, network blocked) and compares the result with
// main-trace.golden.json, which was recorded from desktop/main.cjs before it was split (6ad9a52).
// Usage: node test/run-native-main.cjs [--record]   (EDUP_CLIENT_DIR points it at another copy of client/, e.g. the pre-split one)
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert');
const root=path.resolve(process.env.EDUP_CLIENT_DIR||path.join(__dirname,'..')),golden=path.join(__dirname,'main-trace.golden.json'),out=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'edup-main-trace-')),'trace.json');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const run=spawnSync(require('electron'),[path.join(__dirname,'native-main-trace.cjs'),root,out],{env,windowsHide:true,timeout:150000,encoding:'utf8'});
if(!fs.existsSync(out))throw Error('TRACE_NOT_WRITTEN '+(run.stderr||'').slice(0,300));
const trace=JSON.parse(fs.readFileSync(out,'utf8'));
if(trace.harnessError)throw Error('TRACE_FAILED '+trace.harnessError.slice(0,400));
const text=JSON.stringify(trace,null,1).replace(/[0-9a-f]{32}/g,'<ID32>').replace(/edup-trace-[A-Za-z0-9]{6}/g,'edup-trace-<RAND>');
const t=JSON.parse(text);
// this machine's Giga connection folder and registry state are not part of the check
for(const k of ['giga-browser-folder:giga-browser-folder','giga-browser-status:giga-browser-status'])t.results[k]='<machine>';
const normalized=JSON.stringify(t,null,1);
if(process.argv.includes('--record')){fs.writeFileSync(golden,normalized);console.log('recorded',golden);process.exit(0);}
assert.strictEqual(normalized,fs.readFileSync(golden,'utf8'),'desktop startup behaviour differs from main-trace.golden.json');
console.log('native main trace identical to golden');
