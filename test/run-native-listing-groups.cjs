const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const exe=process.argv[2]||require('electron'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const out=path.join(__dirname,'../dist/native-listing-groups-receipt.json');if(fs.existsSync(out))fs.unlinkSync(out);
const result=spawnSync(exe,[path.join(__dirname,'native-listing-groups.cjs'),'--disable-gpu'],{env,windowsHide:true,encoding:'utf8',timeout:60000});
const receipt=fs.existsSync(out)?JSON.parse(fs.readFileSync(out,'utf8')):null;
if(result.status!==0||!receipt?.passed)throw Error('NATIVE_GROUPS_FAILED:'+JSON.stringify(receipt)+':'+result.stderr);
console.log(JSON.stringify(receipt));
