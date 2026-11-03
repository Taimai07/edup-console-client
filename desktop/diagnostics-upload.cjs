const fs=require('node:fs'),path=require('node:path');const {record,id}=require('../shared/client-diagnostics.cjs');
class DiagnosticsUpload{
 constructor({dir,logger,send,paired}){Object.assign(this,{logger,send,paired});this.file=path.join(dir,'diagnostics-upload.json');this.busy=false;this.next=0;this.failures=0;try{this.state=JSON.parse(fs.readFileSync(this.file));if(!Array.isArray(this.state.seen)||!Array.isArray(this.state.pending))throw Error();}catch{this.state={seen:[],pending:[],lastSent:null};}}
 save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.state),{mode:0o600});fs.renameSync(tmp,this.file);}
 status(){return {enabled:true,pending:this.state.pending.length,lastSent:this.state.lastSent,lastError:this.state.lastError||null};}
 async tick(){if(this.busy||!this.paired())return this.status();this.busy=true;try{const seen=new Set(this.state.seen);for(const x of this.logger.recentErrors(100)){if(x.route==='client-logs'||x.event==='diagnostics_upload_failed')continue;let r;try{r=record(x);}catch{continue;}const hash=id(r);if(!seen.has(hash)){this.state.pending.push(r);this.state.seen.push(hash);seen.add(hash);}}this.state.pending=this.state.pending.slice(-200);this.state.seen=this.state.seen.slice(-600);this.save();if(!this.state.pending.length||Date.now()<this.next)return this.status();const chunk=this.state.pending.slice(0,40);await this.send('client-logs',{format:1,records:chunk});this.state.pending.splice(0,chunk.length);this.state.lastSent=new Date().toISOString();this.state.lastError=null;this.failures=0;this.next=0;this.save();}catch{this.failures++;this.next=Date.now()+Math.min(3600000,60000*2**Math.min(this.failures,6));this.state.lastError='UPLOAD_PENDING_RETRY';try{this.save();}catch{}}finally{this.busy=false;}return this.status();}
 start(){this.tick();this.timer=setInterval(()=>this.tick(),60000);this.timer.unref();}
 close(){clearInterval(this.timer);}
}
module.exports={DiagnosticsUpload};
