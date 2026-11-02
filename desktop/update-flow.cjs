async function runUpdate({check,confirm,download,install}){
 const state=await check();if(state.state!=='available')return state;
 if(!await confirm(state))return {...state,state:'cancelled'};
 await download();return install();
}
module.exports={runUpdate};
