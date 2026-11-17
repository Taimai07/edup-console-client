// Shared pieces of the operations views: the business call wrapper, the button helper, the submission
// proposal card and its explanations. Moved out of operations.js unchanged (client round 1).
import {materialEditor} from './materials.js';
import {el,table,number} from './analytics.js';
import {message,friendlyError,notify} from '../common/notices.js';

export async function businessCall(op,args={}){if(window.edup?.ai)return window.edup.ai(op,args);const r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,args})}),v=await r.json();if(!r.ok)throw Object.assign(Error((v.error||'REQUEST_FAILED')+(v.outcome==='unknown'?' OUTCOME_UNKNOWN':'')),{outcome:v.outcome,retryable:v.retryable});return v;}

export function button(label,work){const b=el('button',label);b.onclick=async()=>{b.disabled=true;try{await work();}catch(e){notify(friendlyError(e));}finally{b.disabled=b.dataset.locked==='true';}};return b;}

const stateName={queued:'已排队',running:'正在处理',executing:'正在提交',submitted:'已提交处理',accepted:'平台已接收，等待核对',verified:'目标字段已匹配',rejected:'平台未接受',completed:'读取完成',failed:'读取失败',interrupted:'服务重启中断',not_sent:'未发出（可以放心重试）',needs_reconciliation:'结果需要核对，暂勿重复提交',preflight_blocked:'提交前检查未通过'};

export function publicationExplanation(submission){const r=submission?.result||{},code=r.code||r.platform?.reason||r.platform?.code||'';if(code==='PRICING_RULE_CHANGED_REPREPARE')return friendlyError(code).message;if(['PREVIEW_PROGRAM_FAILED','PREVIEW_CHECK_FAILED','PRE_SUBMIT_PROGRAM_ERROR','SUBMISSION_REQUIRES_CHECK'].includes(code))return '上架程序检查未完成，本商品尚未提交。现有资料已保留，不需要你补商品资料；请等待修复后恢复。';if(/PRICE_DRIFT/.test(code))return '云仓采购价或配送报价发生变化，本商品未提交。请重新准备，核对新售价后再提交。';if(/STOCK_DRIFT/.test(code))return '最新库存与本次确认条件不符，本商品未提交。请重新读取库存并核对。';if(/OWNER_FACTS|DETAIL_DRIFT/.test(code))return '商品资料在确认后发生变化，本商品未提交。请重新检查并核对。';if(/VALIDATION/.test(code))return '亚马逊预检未通过，本商品未提交。请查看具体问题并重新检查。';return '本商品的提交前检查未通过，现有资料已保留。请查看处理说明；不会自动重复提交。';}

const originalStates={ALREADY_SUBMITTED:'已提交亚马逊',PUBLICATION_PENDING:'已有提交记录，等待核对',PREVIEW_VALID_DRAFT_STOCK_HOLD:'亚马逊预检通过，等待补货',NEEDS_SOURCE_REVIEW:'有真实资料待确认',PREPARING:'正在AI准备',FACTS_PREPARING:'AI核对事实和图片',FIELDS_PREPARING:'整理类目与字段',COPY_GENERATING:'DeepSeek生成文案',SEMANTIC_REVIEW:'上传前语义复核',VALIDATED:'本地字段校验通过',PREPARED_OUT_OF_STOCK:'资料已准备，等待供货库存',PREPARATION_EXCEPTION:'准备流程需要处理',NEEDS_INPUT:'等待AI准备',PREVIEW_VALID:'预检通过，可核对提交',EXCEPTION:'原脚本检查未通过',COPY_READY_REVIEW_REQUIRED:'文案待审核',MODEL_EXECUTION_DISABLED:'文案尚待生成',COLOR_FAMILY_REVIEW_REQUIRED:'颜色变体关系待核对',PREVIEW_REJECTED:'亚马逊预检未通过'};

const requiredNames={'approved attributes/provenance':'商品字段和来源依据','product type':'亚马逊商品类目','media selection':'主图和附图选择','copy facts':'用于文案的已核实事实'};

const preparationReasons={REQUIRED_FACTS_NEED_REVIEW:'有必填资料需要核对',SEMANTIC_REPAIR_NEEDS_SOURCE:'现有证据不足以确认，请查看准备报告',SEMANTIC_REVIEW_REJECTED:'图片或文案复核仍有待处理项',LOCAL_SCHEMA_INVALID:'字段格式或必填检查尚未通过',LOCAL_SCHEMA_MAPPING_REJECTED:'补充字段仍未通过校验',PLANNER_FAILED_CHECK_PENDING:'模型请求需要核对回执，未自动重复调用',DOCUMENT_TEXT_REVIEW_REQUIRED:'说明书文本读取需要处理',DOCUMENT_VISUAL_REVIEW_REQUIRED:'说明书含图表或扫描内容，需要看图核对',COPY_BATTERY_REVIEW_REQUIRED:'电池相关资料需要专项核对',CATEGORY_MAPPING_REQUIRED:'商品类目尚需确认'};

function pipelineRows(items){return table(['商品编码','原流程结果','待处理内容'],items.map(x=>[x.sku,originalStates[x.state]||x.state,(x.state==='NEEDS_INPUT'?'资料已读取，点击「AI准备并检查上架」；暂不需要补资料。':(x.required||[]).map(k=>requiredNames[k]||k).join('、'))||(x.holds||[]).map(k=>k==='SUPPLIER_OUT_OF_STOCK'?'供应商可用库存为0':k).join('、')||(x.reason?(preparationReasons[x.reason]||x.reason):'')]));}

export function proposalCard(target,p){if(p.state==='preparing'||p.state==='needs_preparation'){const box=el('section',undefined,'operation-preview');box.append(el('h3',p.state==='preparing'?'正在重新准备，尚未提交':'暂不能提交，请先处理以下问题'),el('p',p.note,'muted'));if(p.items)box.append(pipelineRows(p.items));if(p.jobId)box.append(button('刷新原流程结果',async()=>{const r=await businessCall('giga_job',{id:p.jobId});const result=el('div');result.append(el('p',r.state==='completed'?'准备检查已结束；尚未正式上架。':'任务仍在处理，请稍后刷新。'));if(r.result?.pipeline?.items)result.append(pipelineRows(r.result.pipeline.items));box.replaceChildren(result);}));target.append(box);return;}if(!p.id||!p.hash||!p.body)throw Error('PROPOSAL_INVALID');const box=el('section',undefined,'operation-preview'),status=el('div');box.append(el('h3','请核对这次变更'),el('p','目标：'+p.body.site+' · '+(p.body.sku||p.body.codes?.join('、'))),el('p',p.preview?.note||'请核对目标与内容后再确认。','muted'));

 const listing=p.body.target==='giga'&&p.body.operation==='giga_import';if(listing){const a=p.preview?.after?.attributes||{},q=a.fulfillment_availability?.find(x=>x.fulfillment_channel_code==='DEFAULT')?.quantity,price=a.purchasable_offer?.[0]?.our_price?.[0]?.schedule?.[0]?.value_with_tax;if(!Number.isInteger(q)||q<0||!Number.isFinite(Number(price)))throw Error('SUBMISSION_PREVIEW_MISSING');box.append(el('h3','提交前最后核对'),el('p','售价：'+Number(price).toFixed(2)+' USD · 本次刊登库存：'+q),el('p',q===0?'本次只建立库存为0的链接，不接受订单；开卖前须核对商品属性、图片与价量。':'确认后会按以上数量提交，可能开始接受订单。'));}

 box.append(window.EdupHuman.render(window.EdupHuman.summary(p)));

 if(p.body.operation==='update_price')box.append(el('p','常规售价 → '+p.body.value+'（站点币种）'));

 if(p.body.operation==='update_listing_text'){try{const x=JSON.parse(p.body.value);box.append(el('pre',x.values.join('\n')));}catch{}}

 const actions=el('div',undefined,'toolbar');const readback=button('查看执行结果',async()=>{const r=await businessCall('operation_readback',{id:p.id});message(status,{level:r.state==='verified'?'success':'info',title:stateName[r.state]||r.state,message:r.note||r.result?.note||r.result?.code||'执行结果已保存在服务器。',code:r.result?.code||''});});readback.hidden=true;

 const confirm=button(listing?'确认提交到亚马逊':'确认执行这次修改',async()=>{confirm.disabled=true;if(listing){confirm.dataset.locked='true';readback.hidden=false;}const r=await businessCall('proposal_decide',{id:p.id,hash:p.hash,decision:'confirm'});
   const decision=r?.proposal||r;
   if(listing&&decision?.state==='rejected'){
    let proof=decision;
    if(typeof decision.result==='string'){try{proof=JSON.parse(decision.result);}catch{}}
    if(proof?.outcome==='not_admitted'){
     confirm.remove();cancel.remove();readback.hidden=true;
     message(status,friendlyError(proof.code));
     actions.append(button('重新生成提交预览',async()=>{
      const {site,operation,reason,batchJobId,codes}=p.body;
      const next=await businessCall('proposal_prepare',{action:{target:'giga',site,operation,reason,batchJobId,sku:codes[0],value:codes.join(',')}});
      if(box.isConnected){target.replaceChildren();proposalCard(target,next);}
     }));
     return;
    }
   }
   if(listing&&!['submitted','queued','running','completed'].includes(decision?.state))
    throw Error('EXECUTION_UNCERTAIN_CHECK_RECEIPT');
   confirm.remove();cancel.remove();readback.hidden=false;message(status,{level:'info',title:listing?'已确认，正在提交':'已交给服务器处理',message:'请点击“查看执行结果”核对平台回执；平台接受和实际生效会分别显示，不会自动重复提交。'});});

 const cancel=button('不执行',async()=>{await businessCall('proposal_decide',{id:p.id,hash:p.hash,decision:'reject'});actions.remove();message(status,{level:'info',title:'已取消这次修改'});});actions.append(confirm,cancel,readback);box.append(actions,status);target.append(box);

}

export function openMaterialReview({jobId,reportJobId,sku,issues=[],openChat,call=businessCall}){const dialog=el('dialog',undefined,'material-dialog'),close=el('button','关闭'),body=el('section');close.onclick=()=>dialog.close();dialog.append(close,body);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});materialEditor(body,{jobId,sku,call,openChat,issues});dialog.showModal();if(issues.length&&issues.every(x=>typeof x==='string'||!x.reason))call('giga_report',{id:reportJobId||jobId,sku,section:'required',offset:0}).then(r=>{if(!dialog.isConnected||r.nextOffset!==null)return;try{const v=JSON.parse(r.content);if(v.blocking_holds?.length&&!body.querySelector('textarea')?.value)materialEditor(body,{jobId,sku,call,openChat,issues:v.blocking_holds});}catch{}}).catch(()=>{});return dialog;}

export function quoteTables(products){const group=new Map(),out=document.createDocumentFragment();for(const p of products){const c=/^[A-Z]{3}$/.test(p.currency||'')?p.currency:'币种待核实';if(!group.has(c))group.set(c,[]);group.get(c).push(p);}for(const [currency,rows] of group)out.append(table(['编码','商品','采购报价（'+currency+'）','标准配送报价（'+currency+'）','供应商库存'],rows.map(x=>[x.code,x.name,number(x.purchaseQuote),number(x.shippingQuote),x.available??'待核实'])));return out;}
