const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
const ctx=await import('../ui/batch-progress.js');
const rows=Array.from({length:5},(_,i)=>({sku:'W'+i,state:'ALREADY_SUBMITTED',publication:{state:'accepted',result:{platformReviewPending:true}}}));rows.push({sku:'W5',state:'NEEDS_SOURCE_REVIEW',attention:[{field:'item_depth_width_height'}]});const d=ctx.describeProgress({state:'completed',preparationMode:'ai_workflow',result:{pipeline:{items:rows}}});assert.equal(d.submitted,5);assert.equal(d.ready,0);assert.equal(d.issues.filter(x=>x.level==='error').length,0);assert.match(d.title,/5款已有提交/);assert.equal(d.issues[5].needsInput,true);assert.equal(d.issues[0].ready,false);assert.ok(!d.issues[0].next.includes('补商品'));
const op=fs.readFileSync(path.join(__dirname,'../ui/operations.js'),'utf8');assert.ok(op.includes('!issue.submitted&&'));assert.ok(op.includes(':issue.submitted?issue.next:'));assert.ok(op.includes("['accepted','verified','needs_reconciliation']"));
console.log('Publication state projection tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
