const fs=require('node:fs'),path=require('node:path');
const fields=new Set(['event','requestId','code','status','method','route','durationMs','version','deviceId','count','state']);
function sanitize(value){const result={};for(const [k,v] of Object.entries(value||{})){if(!fields.has(k))continue;const s=String(v);result[k]=s.replace(/Bearer\s+\S+/gi,'[redacted]').replace(/https?:\/\/\S+/gi,'[url]').replace(/[\r\n]/g,' ').slice(0,160);}return result;}
class Logger{
 constructor(dir,{maxBytes=1024*1024,files=7}={}){this.dir=dir;this.maxBytes=maxBytes;this.files=files;fs.mkdirSync(dir,{recursive:true,mode:0o700});this.file=path.join(dir,'application.jsonl');}
 write(event,details={}){try{if(fs.existsSync(this.file)&&fs.statSync(this.file).size>=this.maxBytes){for(let i=this.files-1;i>=1;i--){const p=this.file+'.'+i;if(fs.existsSync(p)){if(i===this.files-1)fs.unlinkSync(p);else fs.renameSync(p,this.file+'.'+(i+1));}}fs.renameSync(this.file,this.file+'.1');}fs.appendFileSync(this.file,JSON.stringify({at:new Date().toISOString(),...sanitize({...details,event})})+'\n',{mode:0o600});}catch{/* Logging must not expose payloads or crash request handling. */}}
 recent(limit=100){try{return fs.readFileSync(this.file,'utf8').trim().split('\n').filter(Boolean).slice(-limit).map(x=>JSON.parse(x));}catch{return [];}}
}
module.exports={Logger,sanitize};
