const fs=require('node:fs'),path=require('node:path');
const {VERSION}=require('./protocol.cjs');
const fields=new Set(['event','requestId','code','status','method','route','durationMs','version','deviceId','count','state','operationId','stack','level']);
function clean(s){return String(s).replace(/Bearer\s+\S+/gi,'[redacted]').replace(/Atzr\|\S+|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,'[redacted]').replace(/https?:\/\/\S+/gi,'[url]');}
function sanitize(value){const result={};for(const [k,v] of Object.entries(value||{})){if(!fields.has(k))continue;result[k]=k==='stack'?String(v).split('\n').filter(x=>/^\s*at /.test(x)).slice(0,6).map(x=>clean(x).slice(0,220)).join('\n'):clean(v).replace(/[\r\n]/g,' ').slice(0,160);}return result;}
const isError=r=>Number(r.status)>=400||/(?:failed|error|exception|denied|rejected|unresponsive|gone)/i.test(r.event||'');
class Logger{
 constructor(dir,{maxBytes=1024*1024,files=14}={}){this.dir=dir;this.maxBytes=Math.max(80,maxBytes);this.files=Math.max(2,Math.min(60,files));fs.mkdirSync(dir,{recursive:true,mode:0o700});this.file=path.join(dir,'application.jsonl');this.errorFile=path.join(dir,'errors.jsonl');}
 append(file,record){if(fs.existsSync(file)&&fs.statSync(file).size>=this.maxBytes){for(let i=this.files-1;i>=1;i--){const p=file+'.'+i;if(fs.existsSync(p)){if(i===this.files-1)fs.unlinkSync(p);else fs.renameSync(p,file+'.'+(i+1));}}fs.renameSync(file,file+'.1');}fs.appendFileSync(file,JSON.stringify(record)+'\n',{mode:0o600});}
 write(event,details={}){const safe=sanitize({...details,event}),r={at:new Date().toISOString(),version:VERSION,...safe,level:isError(safe)||details.level==='error'?'error':'info'};try{this.append(this.file,r);}catch{}if(r.level==='error')try{this.append(this.errorFile,r);}catch{}}
 writeError(event,error,details={}){const code=error?.code||String(error?.message||'').match(/^([A-Z][A-Z0-9_]{2,79})(?:\s*\/\s*[a-f0-9-]{36})?$/)?.[1]||error?.name||'UNKNOWN_ERROR';this.write(event,{...details,level:'error',code,stack:error?.stack||''});}
 read(file,limit){const all=[];for(let i=this.files-1;i>=0;i--){try{const f=i?file+'.'+i:file;for(const line of fs.readFileSync(f,'utf8').split('\n')){if(!line)continue;try{all.push(JSON.parse(line));}catch{}}}catch{}}return limit===null?all:all.slice(-Math.max(1,Math.min(500,Number(limit)||100)));}
 recent(limit=100){return this.read(this.file,limit);}
 recentErrors(limit=100){return this.read(this.errorFile,limit);}
 export(){return {retention:{filesPerStream:this.files,bytesPerFile:this.maxBytes,policy:'size_rotation_preserved_across_updates'},logs:this.read(this.file,null),errors:this.read(this.errorFile,null)};}
}
module.exports={Logger,sanitize,isError};
