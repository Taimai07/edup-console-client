const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../ui/batch-progress.js'),'utf8').replace(/^import [^\r\n]*\r?\n/gm,'').replace(/export /g,'');
const ctx={};vm.createContext(ctx);vm.runInContext(source,ctx);
const saved={id:'root',codes:['W1','W2','W3'],state:'completed',result:{pipeline:{items:[{sku:'W1',state:'PREPARATION_EXCEPTION'},{sku:'W2',state:'PREVIEW_VALID'},{sku:'W3',state:'ALREADY_SUBMITTED'}]}}};
const resume=ctx.continuation(saved);assert.equal(resume.rootId,'root');assert.deepEqual(Array.from(resume.codes),['W1','W2']);
assert.equal(ctx.continuation(null).codes.length,0);
const paused=ctx.itemIssue({state:'PREPARATION_EXCEPTION',reason:'PLANNER_REQUEST_REJECTED',failure:{details:{reason:'plan_usage_paused',upstreamDispatched:false}}});
assert.equal(paused.needsInput,false);assert.match(paused.reason,/没有发给/);assert.match(paused.title,/模型服务暂停/);
const dg=ctx.itemIssue({state:'NEEDS_SOURCE_REVIEW',reason:'DG_REVIEW_REQUIRED',attention:['Confirm the power source and battery type.']});assert.match(dg.title,/供电/);assert.match(dg.reason,/不等于/);assert.equal(dg.needsInput,true);
const fields=ctx.itemIssue({state:'NEEDS_SOURCE_REVIEW',attention:[{field:'country_of_origin',reason:'Country missing'},{field:'fabric_type',reason:'Fabric missing'}]});
assert.equal(fields.problems.length,2);assert.equal(fields.problems[1].needsInput,false);assert.match(fields.problems[1].next,/不需要你编造/);
const operations=fs.readFileSync(path.join(__dirname,'../ui/operations.js'),'utf8');assert.match(operations,/继续检查本批（复用已有结果）/);assert.match(operations,/start\('giga_prepare',value.codes,value.rootId\)/);
console.log('Saved-batch continuation and actionable error tests passed');

const vague=ctx.itemIssue({state:'NEEDS_SOURCE_REVIEW',reason:'DG_REVIEW_REQUIRED'});assert.equal(vague.needsInput,false);assert.match(vague.title,/危险品声明/);
const previous=ctx.itemIssue({state:'PREVIEW_VALID',latestAttempt:{state:'failed'}});assert.equal(previous.ready,false);assert.match(previous.title,/原准备结果已保留/);
