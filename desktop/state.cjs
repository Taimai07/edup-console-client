const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {compareVersions}=require('../shared/protocol.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function atomic(file,bytes){
 fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
 try{const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch{}}
}
class ProtectedState{
 constructor(root,codec){this.root=root;this.codec=codec;this.cache=path.join(root,'snapshot.bin');this.pending=path.join(root,'upgrade-pending.json');this.receipt=null;}
 seal(value){if(!this.codec.isEncryptionAvailable())throw Error('WINDOWS_PROTECTION_UNAVAILABLE');return this.codec.encryptString(JSON.stringify(value));}
 open(file){return JSON.parse(this.codec.decryptString(fs.readFileSync(file)));}
 writeCache(snapshot){if(!snapshot||!Array.isArray(snapshot.products)||!Array.isArray(snapshot.markets))throw Error('CACHE_INVALID');const text=JSON.stringify(snapshot);if(Buffer.byteLength(text)>4*1024*1024)throw Error('CACHE_TOO_LARGE');atomic(this.cache,this.seal({format:1,snapshot}));return {saved:true};}
 readCache(){if(!fs.existsSync(this.cache))return null;const v=this.open(this.cache);if(v.format!==1)throw Error('CACHE_VERSION_UNSUPPORTED');return v.snapshot;}
 backup(manifest){
  const files={};for(const name of ['connection.json','device-identity.bin','snapshot.bin']){const f=path.join(this.root,name);if(!fs.existsSync(f))continue;if(fs.lstatSync(f).isSymbolicLink())throw Error('UPGRADE_LINKED_STATE');const b=fs.readFileSync(f);if(b.length>8*1024*1024)throw Error('UPGRADE_STATE_TOO_LARGE');files[name]={data:b.toString('base64'),sha256:hash(b)};}
  const id=Date.now()+'-'+crypto.randomBytes(8).toString('hex'),file=path.join(this.root,'recovery',id+'.bin');
  const record={format:1,target:manifest.version,installerSha256:manifest.sha256,files};atomic(file,this.seal(record));
  const verify=this.open(file);if(JSON.stringify(record)!==JSON.stringify(verify))throw Error('UPGRADE_BACKUP_VERIFY_FAILED');
  atomic(this.pending,JSON.stringify({format:1,id,target:manifest.version}));return {id,files:Object.keys(files).length};
 }
 inspectUpgrade(version){
  if(!fs.existsSync(this.pending))return null;const p=JSON.parse(fs.readFileSync(this.pending,'utf8'));
  if(p.format!==1||!/^\d+-[a-f0-9]{16}$/.test(p.id))throw Error('UPGRADE_RECEIPT_INVALID');
  const record=this.open(path.join(this.root,'recovery',p.id+'.bin'));if(record.format!==1||record.target!==p.target)throw Error('UPGRADE_RECEIPT_INVALID');
  for(const name of ['connection.json','device-identity.bin']){const expected=record.files[name];if(!expected)continue;const f=path.join(this.root,name);if(!fs.existsSync(f)||hash(fs.readFileSync(f))!==expected.sha256)throw Error('UPGRADE_DATA_CHANGED');}
  this.receipt={version,target:p.target,recoveryId:p.id,dataPreserved:true,state:compareVersions(version,p.target)>=0?'awaiting_ui':'previous_version'};return this.receipt;
 }
 confirmUi(){if(!['awaiting_ui','previous_version'].includes(this.receipt?.state))return this.receipt;this.receipt={...this.receipt,state:this.receipt.state==='awaiting_ui'?'installed':'previous_version',checkedAt:new Date().toISOString()};atomic(path.join(this.root,'upgrade-result.json'),JSON.stringify(this.receipt));fs.unlinkSync(this.pending);return this.receipt;}
 cancelUpgrade(){if(!fs.existsSync(this.pending))return;const p=JSON.parse(fs.readFileSync(this.pending,'utf8'));atomic(path.join(this.root,'upgrade-result.json'),JSON.stringify({state:'dispatch_failed',target:p.target,recoveryId:p.id,checkedAt:new Date().toISOString()}));fs.unlinkSync(this.pending);}
}
module.exports={ProtectedState,atomic};
