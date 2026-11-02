class UpdateController{
 constructor({updates,confirm,install,canRun=()=>true,progress=()=>{},onError=()=>{}}){Object.assign(this,{updates,confirm,install,canRun,progress,onError});this.seen=new Set();this.pending=null;}
 run({automatic=false}={}){if(this.pending)return this.pending;if(!this.canRun())return Promise.resolve({state:'deferred'});this.pending=this.execute(automatic).finally(()=>{this.pending=null;this.progress(false);});return this.pending;}
 async execute(automatic){let approved=false;try{const state=await this.updates.check();if(state.state!=='available')return state;if(automatic&&this.seen.has(state.version))return {...state,state:'deferred'};this.seen.add(state.version);approved=await this.confirm(state);if(!approved)return {...state,state:'cancelled'};this.progress(true);await this.updates.download();return await this.install();}catch(e){if(approved||!automatic)await this.onError(e);return {state:'update_failed',code:e.message};}}
}
module.exports={UpdateController};
