const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const executable=process.argv[2]||require('electron'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(executable,[path.join(__dirname,'native-giga-browser.cjs'),'--disable-gpu'],{env,windowsHide:true,encoding:'utf8',timeout:60000});
const receiptPath=path.join(__dirname,'../dist/native-giga-browser-receipt.json');
const receipt=fs.existsSync(receiptPath)?JSON.parse(fs.readFileSync(receiptPath,'utf8')):null;
if(result.status!==0)throw Error('NATIVE_GIGA_BROWSER_FAILED:'+result.status+':'+(receipt?.error||String(result.stderr).slice(-2000)));
if(!receipt?.passed||!receipt.sequentialSegments||!receipt.waitsForManualAccount||!receipt.cancelPreventsPipeline||!receipt.frozenScopePreserved||!receipt.completeReceiptRequired||receipt.modelAndPlatformCalls!==0||receipt.userWindowTouched!==false)throw Error('INVALID_NATIVE_GIGA_RECEIPT');
console.log(JSON.stringify(receipt));
