const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {validateRelease,verifyDownload}=require('../shared/updates.cjs');
const allowed=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
async function boundedDownload(url,max=500*1024*1024){
 let current=new URL(url);
 for(let n=0;n<6;n++){
  if(current.protocol!=='https:'||current.username||current.password||!allowed.has(current.hostname))throw Error('DOWNLOAD_HOST_INVALID');
  const r=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(120000)});
  if([301,302,303,307,308].includes(r.status)){const next=r.headers.get('location');if(!next)throw Error('DOWNLOAD_REDIRECT');current=new URL(next,current);continue;}
  if(!r.ok)throw Error(r.status===404?'UPDATE_NOT_PUBLISHED':'DOWNLOAD_FAILED');
  if(Number(r.headers.get('content-length')||0)>max)throw Error('DOWNLOAD_TOO_LARGE');
  const pieces=[];let size=0;for await(const c of r.body){size+=c.length;if(size>max)throw Error('DOWNLOAD_TOO_LARGE');pieces.push(c);}return Buffer.concat(pieces);
 }throw Error('DOWNLOAD_REDIRECT_LIMIT');
}
class Updates{
 constructor({version,publicKey,dir,logger}){this.version=version;this.publicKey=publicKey;this.dir=dir;this.logger=logger;this.state={state:'idle',currentVersion:version};this.manifest=null;this.file=null;}
 async check(){this.state={state:'checking',currentVersion:this.version};try{let b;
  try{const r=await fetch('https://console.eduplinkaudio.com/updates/stable.json',{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('UPDATE_NOT_PUBLISHED');const text=await r.text();if(Buffer.byteLength(text)>65536)throw Error('UPDATE_MANIFEST_INVALID');b=Buffer.from(text);}catch{b=await boundedDownload('https://github.com/Taimai07/edup-console-client/releases/latest/download/stable.json',65536);}
  const m=validateRelease(JSON.parse(b),{publicKey:this.publicKey,currentVersion:this.version});this.manifest=m.available?m:null;this.state={state:m.available?'available':'current',currentVersion:this.version,version:m.version,notes:m.notes||''};}catch(e){this.state={state:e.message==='UPDATE_NOT_PUBLISHED'?'not_published':'check_failed',currentVersion:this.version,code:e.message};this.logger.write('update_check',{code:e.message});}return this.state;}
 async download(){if(!this.manifest)throw Error('UPDATE_NOT_AVAILABLE');this.file=null;this.state={...this.state,state:'downloading'};try{const bytes=await boundedDownload(this.manifest.url,this.manifest.size);verifyDownload(bytes,this.manifest);fs.mkdirSync(this.dir,{recursive:true});this.file=path.join(this.dir,'EDUPLINK-Setup-'+this.manifest.version+'.exe');fs.writeFileSync(this.file,bytes);this.state={...this.state,state:'ready'};return this.state;}catch(e){this.state={...this.state,state:'download_failed',code:e.message};this.logger.write('update_download',{code:e.message});throw e;}}
 verifiedInstaller(){if(!this.file||!this.manifest||this.state.state!=='ready')throw Error('UPDATE_NOT_READY');verifyDownload(fs.readFileSync(this.file),this.manifest);return this.file;}
}
module.exports={Updates,boundedDownload};
