const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const electron=process.argv[2]||require('electron'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const r=spawnSync(electron,[path.join(__dirname,'native-continuation.cjs'),'--disable-gpu'],{env,windowsHide:true,encoding:'utf8',timeout:60000});
if(r.status!==0)throw Error('NATIVE_CONTINUATION_FAILED:'+r.status+':'+String(r.stderr).slice(-2000));
const receipt=JSON.parse(fs.readFileSync(path.join(__dirname,'../dist/native-continuation-receipt.json'),'utf8'));
if(!receipt.passed||!receipt.emptyInputHistoryResume||!receipt.materialEditBoundToOriginalBatch||receipt.modelAndPlatformCalls!==0||receipt.userWindowTouched!==false)throw Error('NATIVE_CONTINUATION_RECEIPT_INVALID');
console.log(JSON.stringify({passed:true,emptyInputHistoryResume:true,materialEditBoundToOriginalBatch:true,modelAndPlatformCalls:0,userWindowTouched:false}));
