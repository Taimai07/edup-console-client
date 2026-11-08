const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const electron=process.argv[2]||require('electron'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const r=spawnSync(electron,[path.join(__dirname,'native-continuation.cjs'),'--disable-gpu'],{env,windowsHide:true,encoding:'utf8',timeout:60000});
const receiptPath=path.join(__dirname,'../dist/native-continuation-receipt.json');
const receipt=fs.existsSync(receiptPath)?JSON.parse(fs.readFileSync(receiptPath,'utf8')):null;
if(r.status!==0)throw Error('NATIVE_CONTINUATION_FAILED:'+r.status+':'+(receipt?.error||String(r.stderr).slice(-2000)));
if(!receipt?.passed||!receipt.emptyInputHistoryResume||!receipt.materialEditBoundToOriginalBatch||receipt.modelAndPlatformCalls!==0||receipt.userWindowTouched!==false)throw Error('NATIVE_CONTINUATION_RECEIPT_INVALID');
console.log(JSON.stringify({passed:true,emptyInputHistoryResume:true,materialEditBoundToOriginalBatch:true,modelAndPlatformCalls:0,userWindowTouched:false}));
