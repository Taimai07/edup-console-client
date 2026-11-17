// node test/run-native-operations-giga.cjs            compare a fresh run with test/operations-giga-trace.golden.json
// node test/run-native-operations-giga.cjs --record   (re)write the golden file; only on code whose behaviour is the reference
// EDUP_CLIENT_DIR=<other client dir> runs the same trace against another copy of client/ (used to record on the pre-split code)
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const exe=process.argv.find(a=>/electron(\.exe)?$/i.test(a))||require('electron'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const golden=path.join(__dirname,'operations-giga-trace.golden.json'),record=process.argv.includes('--record');
const out=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'edup-ogtrace-')),'trace.json');env.EDUP_TRACE_OUT=out;
const result=spawnSync(exe,[path.join(__dirname,'native-operations-giga.cjs'),'--disable-gpu'],{env,windowsHide:true,encoding:'utf8',timeout:150000});
const trace=fs.existsSync(out)?JSON.parse(fs.readFileSync(out,'utf8')):null;
if(result.status!==0||!trace||trace.error||!Array.isArray(trace.trace))throw Error('NATIVE_OPERATIONS_GIGA_FAILED:'+JSON.stringify(trace&&trace.error)+':'+result.stderr);
const text=JSON.stringify({steps:trace.trace.length,errs:trace.errs,consoleErrors:trace.consoleErrors,calls:trace.calls,trace:trace.trace},null,1);
if(record){fs.writeFileSync(golden,text);console.log('recorded '+trace.trace.length+' steps');process.exit(0);}
const want=fs.readFileSync(golden,'utf8');
if(want.replace(/\r\n/g,'\n')!==text)throw Error('NATIVE_OPERATIONS_GIGA_DIFFERENT: the 大健 view no longer matches test/operations-giga-trace.golden.json');
console.log(JSON.stringify({passed:true,steps:trace.trace.length}));
