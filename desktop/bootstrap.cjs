const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');
const {PatchStore}=require('./patch-store.cjs');
const base=require('../package.json').version,selfCheck=process.argv.includes('--self-check');
if(!selfCheck&&!app.requestSingleInstanceLock()){app.quit();}else{
 const publicKey=fs.readFileSync(path.join(__dirname,'../assets/update-public.pem'),'utf8');
 const store=new PatchStore({root:path.join(app.getPath('userData'),'app-patches'),publicKey,electron:process.versions.electron,baseVersion:base,platform:process.platform+'-'+process.arch});
 const selected=store.select();let timer,failed=false;
 const fail=reason=>{if(failed)return false;failed=true;clearTimeout(timer);if(!store.rollback(reason))return false;if(!selfCheck)app.relaunch();app.exit(1);return true;};
 globalThis[Symbol.for('edup.patch')]=Object.freeze({store,publicKey,baseVersion:base,singleInstanceOwned:!selfCheck,version:selected?.version||base,healthy:version=>{if(selected)store.healthy(selected.id,version);clearTimeout(timer);},fail});
 if(selected&&store.state().pending&&!selfCheck){timer=setTimeout(()=>fail('BOOT_HEALTH_TIMEOUT'),90000);timer.unref();}
 try{require(selected?.entry||'./main.cjs');}catch(e){if(!fail('BOOT_REQUIRE_FAILED'))throw e;}
}
