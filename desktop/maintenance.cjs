const fs=require('node:fs'),path=require('node:path'),{createHash,randomBytes}=require('node:crypto');
const {validateRelease,verifyDownload,trustedArtifact}=require('../shared/updates.cjs');
const {applyDelta}=require('./delta.cjs');
const allowed=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
async function boundedDownload(url,max=500*1024*1024,fetcher=(...args)=>fetch(...args)){
 let current=new URL(url);
 for(let n=0;n<6;n++){
  if(current.protocol!=='https:'||current.username||current.password||(!allowed.has(current.hostname)&&!trustedArtifact(current.href)))throw Error('DOWNLOAD_HOST_INVALID');
  const r=await fetcher(current,{redirect:'manual',signal:AbortSignal.timeout(900000)});
  if([301,302,303,307,308].includes(r.status)){const next=r.headers.get('location');if(!next)throw Error('DOWNLOAD_REDIRECT');current=new URL(next,current);continue;}
  if(!r.ok)throw Error(r.status===404?'UPDATE_NOT_PUBLISHED':'DOWNLOAD_FAILED');
  if(Number(r.headers.get('content-length')||0)>max)throw Error('DOWNLOAD_TOO_LARGE');
  const pieces=[];let size=0;for await(const c of r.body){size+=c.length;if(size>max)throw Error('DOWNLOAD_TOO_LARGE');pieces.push(c);}return Buffer.concat(pieces);
 }throw Error('DOWNLOAD_REDIRECT_LIMIT');
}
async function downloadFile(url,manifest,target,{fetcher=(...args)=>fetch(...args)}={}){
 let current=new URL(url),response;
 for(let n=0;n<6;n++){
  if(current.protocol!=='https:'||current.username||current.password||(!allowed.has(current.hostname)&&!trustedArtifact(current.href)))throw Error('DOWNLOAD_HOST_INVALID');
  const r=await fetcher(current,{redirect:'manual',signal:AbortSignal.timeout(900000)});
  if([301,302,303,307,308].includes(r.status)){const next=r.headers.get('location');await r.body?.cancel();if(!next)throw Error('DOWNLOAD_REDIRECT');current=new URL(next,current);continue;}
  if(!r.ok)throw Error('DOWNLOAD_FAILED');response=r;break;
 }
 if(!response)throw Error('DOWNLOAD_REDIRECT_LIMIT');
 const length=response.headers.get('content-length');if(length!==null&&Number(length)!==manifest.size)throw Error('UPDATE_FILE_MISMATCH');
 if((response.headers.get('content-type')||'').includes('text/html'))throw Error('UPDATE_NOT_EXECUTABLE');
 fs.mkdirSync(path.dirname(target),{recursive:true});const space=fs.statfsSync(path.dirname(target));if(space.bavail*space.bsize<manifest.size+32*1024*1024)throw Error('UPDATE_DISK_FULL');
 const temp=target+'.'+randomBytes(8).toString('hex')+'.partial',hash=createHash('sha256');let size=0,head=Buffer.alloc(0),fd;
 try{
  fd=fs.openSync(temp,'wx',0o600);
  for await(const c of response.body){size+=c.length;if(size>manifest.size)throw Error('UPDATE_FILE_MISMATCH');hash.update(c);if(head.length<2)head=Buffer.concat([head,c]).subarray(0,2);let offset=0;while(offset<c.length){const n=fs.writeSync(fd,c,offset,c.length-offset);if(n===0)throw Error('UPDATE_DISK_WRITE_FAILED');offset+=n;}}
  fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  if(size!==manifest.size||hash.digest('hex')!==manifest.sha256)throw Error('UPDATE_FILE_MISMATCH');if(head.toString()!=='MZ')throw Error('UPDATE_NOT_EXECUTABLE');
  fs.renameSync(temp,target);
  if(process.platform==='win32')fs.writeFileSync(target+':Zone.Identifier','[ZoneTransfer]\r\nZoneId=3\r\nHostUrl='+url+'\r\n');
  return target;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}}
}
class Updates{
 constructor({version,publicKey,dir,logger,patchStore=null,fetcher=(...args)=>fetch(...args)}){this.fetcher=fetcher;this.patchStore=patchStore;this.patch=null;this.envelope=null;this.version=version;this.publicKey=publicKey;this.dir=dir;this.logger=logger;this.state={state:'idle',currentVersion:version};this.manifest=null;this.file=null;}
 async check(){if(this.state.state==='downloading')return this.state;this.state={state:'checking',currentVersion:this.version};try{let b;
  const r=await this.fetcher('https://console.eduplinkaudio.com/updates/v3/stable.json',{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('UPDATE_NOT_PUBLISHED');const text=await r.text();if(Buffer.byteLength(text)>65536)throw Error('UPDATE_MANIFEST_INVALID');b=Buffer.from(text);
  this.envelope=JSON.parse(b);const m=validateRelease(this.envelope,{publicKey:this.publicKey,currentVersion:this.version});this.manifest=m.available?m:null;this.state={state:m.available?'available':'current',currentVersion:this.version,version:m.version,notes:m.notes||'',updateKind:this.patchStore?.canApply(m)?'patch':'installer'};}catch(e){this.state={state:e.message==='UPDATE_NOT_PUBLISHED'?'not_published':'check_failed',currentVersion:this.version,code:e.message};this.logger.write('update_check_failed',{code:e.message});}return this.state;}
 async download(){if(!this.manifest)throw Error('UPDATE_NOT_AVAILABLE');if(this.state.state==='downloading')throw Error('UPDATE_DOWNLOAD_IN_PROGRESS');this.file=null;this.state={...this.state,state:'downloading'};try{if(this.state.updateKind==='patch'){const p=this.manifest.appPatch,bytes=await boundedDownload(p.url,p.size,this.fetcher);this.patch=this.patchStore.stage(bytes,this.envelope,this.version);this.state={...this.state,state:'ready'};this.logger.write('app_patch_ready',{count:bytes.length});return this.state;}const target=path.join(this.dir,'EDUPLINK-Setup-'+this.manifest.version+'.exe');let usedDelta=false;const delta=this.manifest.deltas?.find(d=>d.fromVersion===this.version&&d.size<this.manifest.size*0.7),base=path.join(this.dir,'EDUPLINK-Setup-'+this.version+'.exe');
 if(delta&&fs.existsSync(base)){try{const bytes=await boundedDownload(delta.url,delta.size,this.fetcher);applyDelta(bytes,base,target,this.manifest,delta);usedDelta=true;this.logger.write('update_delta_applied',{count:bytes.length});}catch(e){this.logger.write('update_delta_fallback',{code:e.message});}}
 if(!usedDelta)await downloadFile(this.manifest.url,this.manifest,target,{fetcher:this.fetcher});
 if(usedDelta&&process.platform==='win32')fs.writeFileSync(target+':Zone.Identifier','[ZoneTransfer]\r\nZoneId=3\r\nHostUrl='+this.manifest.url+'\r\n');
 this.file=target;this.state={...this.state,state:'ready'};return this.state;}catch(e){this.state={...this.state,state:'download_failed',code:e.message};this.logger.write('update_download_failed',{code:e.message});throw e;}}
 verifiedPatch(){if(!this.patch||!this.patchStore||this.state.state!=='ready')throw Error('PATCH_NOT_READY');return this.patchStore.validate(this.patch.id);}
 verifiedInstaller(){if(!this.file||!this.manifest||this.state.state!=='ready')throw Error('UPDATE_NOT_READY');verifyDownload(fs.readFileSync(this.file),this.manifest);return this.file;}
}
module.exports={Updates,boundedDownload,downloadFile};
