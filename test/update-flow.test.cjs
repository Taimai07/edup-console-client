const {test}=require('node:test'),assert=require('node:assert/strict'),{runUpdate}=require('../desktop/update-flow.cjs'),{template}=require('../desktop/menu.cjs');
test('single update action confirms before download and never installs after cancel or failure',async()=>{
 const calls=[],args={check:async()=>({state:'available',version:'9.0.0'}),confirm:async()=>false,download:async()=>calls.push('download'),install:async()=>{calls.push('install');return {state:'installing'};}};
 assert.equal((await runUpdate(args)).state,'cancelled');assert.deepEqual(calls,[]);
 args.confirm=async()=>true;assert.equal((await runUpdate(args)).state,'installing');assert.deepEqual(calls,['download','install']);
 calls.length=0;args.download=async()=>{throw Error('HASH_FAILED');};await assert.rejects(runUpdate(args),/HASH_FAILED/);assert.deepEqual(calls,[]);
 args.check=async()=>({state:'current'});assert.equal((await runUpdate(args)).state,'current');
});
test('native top menu uses Chinese labels',()=>{const m=template({about(){}});assert.deepEqual(m.map(x=>x.label),['文件','编辑','查看','窗口','帮助']);for(const x of m)for(const y of x.submenu)if(y.role)assert.ok(y.label);});
