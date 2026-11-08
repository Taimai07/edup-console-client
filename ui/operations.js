import './human-report.js';

import {ensureGigaFavorites} from './giga-browser.js';

import {materialEditor} from './materials.js';

import {renderProgress,itemIssue,continuation} from './batch-progress.js';

import {batchChat} from './batch-chat.js';

import {el,table,number} from './analytics.js';import {message,friendlyError,notify} from './notices.js';

let lastGigaJob=null, activeGigaQueue=false;
const sessionGigaJobs=new Map();

export async function businessCall(op,args={}){if(window.edup?.ai)return window.edup.ai(op,args);const r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,args})}),v=await r.json();if(!r.ok)throw Object.assign(Error((v.error||'REQUEST_FAILED')+(v.outcome==='unknown'?' OUTCOME_UNKNOWN':'')),{outcome:v.outcome,retryable:v.retryable});return v;}

function button(label,work){const b=el('button',label);b.onclick=async()=>{b.disabled=true;try{await work();}catch(e){notify(friendlyError(e));}finally{b.disabled=b.dataset.locked==='true';}};return b;}

const stateName={queued:'已排队',running:'正在处理',executing:'正在提交',submitted:'已提交处理',accepted:'平台已接收，等待核对',verified:'目标字段已匹配',rejected:'平台未接受',completed:'读取完成',failed:'读取失败',interrupted:'服务重启中断',needs_reconciliation:'结果需要核对，暂勿重复提交',preflight_blocked:'提交前检查未通过'};

export function publicationExplanation(submission){const r=submission?.result||{},code=r.code||r.platform?.reason||r.platform?.code||'';if(['PREVIEW_PROGRAM_FAILED','PREVIEW_CHECK_FAILED','PRE_SUBMIT_PROGRAM_ERROR','SUBMISSION_REQUIRES_CHECK'].includes(code))return '上架程序检查未完成，本商品尚未提交。现有资料已保留，不需要你补商品资料；请等待修复后恢复。';if(/PRICE_DRIFT/.test(code))return '云仓采购价或配送报价发生变化，本商品未提交。请重新准备，核对新售价后再提交。';if(/STOCK_DRIFT/.test(code))return '最新库存与本次确认条件不符，本商品未提交。请重新读取库存并核对。';if(/OWNER_FACTS|DETAIL_DRIFT/.test(code))return '商品资料在确认后发生变化，本商品未提交。请重新检查并核对。';if(/VALIDATION/.test(code))return '亚马逊预检未通过，本商品未提交。请查看具体问题并重新检查。';return '本商品的提交前检查未通过，现有资料已保留。请查看处理说明；不会自动重复提交。';}

const originalStates={ALREADY_SUBMITTED:'已提交亚马逊',PUBLICATION_PENDING:'已有提交记录，等待核对',PREVIEW_VALID_DRAFT_STOCK_HOLD:'亚马逊预检通过，等待补货',NEEDS_SOURCE_REVIEW:'有真实资料待确认',PREPARING:'正在AI准备',FACTS_PREPARING:'AI核对事实和图片',FIELDS_PREPARING:'整理类目与字段',COPY_GENERATING:'DeepSeek生成文案',SEMANTIC_REVIEW:'上传前语义复核',VALIDATED:'本地字段校验通过',PREPARED_OUT_OF_STOCK:'资料已准备，等待供货库存',PREPARATION_EXCEPTION:'准备流程需要处理',NEEDS_INPUT:'等待AI准备',PREVIEW_VALID:'预检通过，可核对提交',EXCEPTION:'原脚本检查未通过',COPY_READY_REVIEW_REQUIRED:'文案待审核',MODEL_EXECUTION_DISABLED:'文案尚待生成',COLOR_FAMILY_REVIEW_REQUIRED:'颜色变体关系待核对',PREVIEW_REJECTED:'亚马逊预检未通过'};

const requiredNames={'approved attributes/provenance':'商品字段和来源依据','product type':'亚马逊商品类目','media selection':'主图和附图选择','copy facts':'用于文案的已核实事实'};

const preparationReasons={REQUIRED_FACTS_NEED_REVIEW:'有必填资料需要核对',SEMANTIC_REPAIR_NEEDS_SOURCE:'现有证据不足以确认，请查看准备报告',SEMANTIC_REVIEW_REJECTED:'图片或文案复核仍有待处理项',LOCAL_SCHEMA_INVALID:'字段格式或必填检查尚未通过',LOCAL_SCHEMA_MAPPING_REJECTED:'补充字段仍未通过校验',PLANNER_FAILED_CHECK_PENDING:'模型请求需要核对回执，未自动重复调用',DOCUMENT_TEXT_REVIEW_REQUIRED:'说明书文本读取需要处理',DOCUMENT_VISUAL_REVIEW_REQUIRED:'说明书含图表或扫描内容，需要看图核对',COPY_BATTERY_REVIEW_REQUIRED:'电池相关资料需要专项核对',CATEGORY_MAPPING_REQUIRED:'商品类目尚需确认'};

function pipelineRows(items){return table(['商品编码','原流程结果','待处理内容'],items.map(x=>[x.sku,originalStates[x.state]||x.state,(x.state==='NEEDS_INPUT'?'资料已读取，点击「AI准备并检查上架」；暂不需要补资料。':(x.required||[]).map(k=>requiredNames[k]||k).join('、'))||(x.holds||[]).map(k=>k==='SUPPLIER_OUT_OF_STOCK'?'供应商可用库存为0':k).join('、')||(x.reason?(preparationReasons[x.reason]||x.reason):'')]));}

export function proposalCard(target,p){if(p.state==='preparing'||p.state==='needs_preparation'){const box=el('section',undefined,'operation-preview');box.append(el('h3',p.state==='preparing'?'正在重新准备，尚未提交':'暂不能提交，请先处理以下问题'),el('p',p.note,'muted'));if(p.items)box.append(pipelineRows(p.items));if(p.jobId)box.append(button('刷新原流程结果',async()=>{const r=await businessCall('giga_job',{id:p.jobId});const result=el('div');result.append(el('p',r.state==='completed'?'准备检查已结束；尚未正式上架。':'任务仍在处理，请稍后刷新。'));if(r.result?.pipeline?.items)result.append(pipelineRows(r.result.pipeline.items));box.replaceChildren(result);}));target.append(box);return;}if(!p.id||!p.hash||!p.body)throw Error('PROPOSAL_INVALID');const box=el('section',undefined,'operation-preview'),status=el('div');box.append(el('h3','请核对这次变更'),el('p','目标：'+p.body.site+' · '+(p.body.sku||p.body.codes?.join('、'))),el('p',p.preview?.note||'请核对目标与内容后再确认。','muted'));

 const listing=p.body.target==='giga'&&p.body.operation==='giga_import';if(listing){const a=p.preview?.after?.attributes||{},q=a.fulfillment_availability?.find(x=>x.fulfillment_channel_code==='DEFAULT')?.quantity,price=a.purchasable_offer?.[0]?.our_price?.[0]?.schedule?.[0]?.value_with_tax;if(!Number.isInteger(q)||q<0||!Number.isFinite(Number(price)))throw Error('SUBMISSION_PREVIEW_MISSING');box.append(el('h3','提交前最后核对'),el('p','售价：'+Number(price).toFixed(2)+' USD · 本次刊登库存：'+q),el('p',q===0?'本次只建立库存为0的链接，不接受订单；补货自动同步尚未开启。':'确认后会按以上数量提交，可能开始接受订单。'));}

 box.append(window.EdupHuman.render(window.EdupHuman.summary(p)));

 if(p.body.operation==='update_price')box.append(el('p','常规售价 → '+p.body.value+'（站点币种）'));

 if(p.body.operation==='update_listing_text'){try{const x=JSON.parse(p.body.value);box.append(el('pre',x.values.join('\n')));}catch{}}

 const actions=el('div',undefined,'toolbar');const readback=button('查看执行结果',async()=>{const r=await businessCall('operation_readback',{id:p.id});message(status,{level:r.state==='verified'?'success':'info',title:stateName[r.state]||r.state,message:r.note||r.result?.note||r.result?.code||'执行结果已保存在服务器。',code:r.result?.code||''});});readback.hidden=true;

 const confirm=button(listing?'确认提交到亚马逊':'确认执行这次修改',async()=>{confirm.disabled=true;const r=await businessCall('proposal_decide',{id:p.id,hash:p.hash,decision:'confirm'});confirm.remove();cancel.remove();readback.hidden=false;message(status,{level:'info',title:listing?'已确认，正在提交':'已交给服务器处理',message:'请点击“查看执行结果”核对平台回执；平台接受和实际生效会分别显示，不会自动重复提交。'});});

 const cancel=button('不执行',async()=>{await businessCall('proposal_decide',{id:p.id,hash:p.hash,decision:'reject'});actions.remove();message(status,{level:'info',title:'已取消这次修改'});});actions.append(confirm,cancel,readback);box.append(actions,status);target.append(box);

}

export function productEditor(target,product,{offline=false}={}){target.replaceChildren();const kind=el('select');for(const [value,label] of [['price','常规售价'],['item_name','商品标题'],['bullet_point','五点描述（每行一条）'],['product_description','商品描述'],['generic_keyword','后台搜索关键词']]){const o=el('option',label);o.value=value;kind.append(o);}const input=el('textarea');input.placeholder='填写需要设置的完整值；价格使用站点币种。';const out=el('div'),prepare=button('检查并生成修改预览',async()=>{const operation=kind.value==='price'?'update_price':'update_listing_text',value=kind.value==='price'?input.value.trim():JSON.stringify({field:kind.value,values:kind.value==='bullet_point'?input.value.split('\n').map(x=>x.trim()).filter(Boolean):[input.value.trim()]});const p=await businessCall('proposal_prepare',{action:{target:'amazon',operation,site:product.site,sku:product.sku,value,reason:'用户在商品管理页面手动填写并请求预览'}});out.replaceChildren();proposalCard(out,p);});prepare.disabled=offline;target.append(el('h3',product.site+' · '+product.sku),kind,input,prepare,out,el('p','暂停／恢复销售尚未接通。FBA商品不能用库存设为零代替停售。','muted'));

}

export function preparationReport(target,id,sku,initialSection='status'){target.replaceChildren();const select=el('select'),body=el('pre'),status=el('div'),more=button('继续读取报告',async()=>load(false));let next=0,sha=null;more.hidden=true;

 for(const [value,label] of [['failure','本次错误原因'],['task_log','程序运行日志'],['status','阶段状态'],['required','待确认的必填字段'],['mapping','商品字段与来源'],['semantic','语义和图片复核'],['repair','复核修正记录'],['copy_check','文案机械检查'],['schema','本地字段校验'],['source','商品原始资料'],['usage','模型调用记录'],['preview','亚马逊预检结果']]){const o=el('option',label);o.value=value;select.append(o);}

 async function load(reset){if(reset){next=0;sha=null;body.textContent='';}const r=await businessCall('giga_report',{id,sku,section:select.value,offset:next,expectedSha:sha});if(r.state==='not_ready'){body.textContent=r.content;more.hidden=true;return;}body.textContent+=r.content;sha=r.sha256;next=r.nextOffset;more.hidden=next===null;message(status,{level:'info',title:sku+' · VPS原始阶段报告',message:next===null?'本报告已完整显示。':'内容较长，可继续读取后续部分。'});}

 select.value=initialSection;select.addEventListener('change',()=>load(true).catch(e=>message(status,friendlyError(e))));target.append(el('h3','准备报告 · '+sku),select,status,body,more);load(true).catch(e=>message(status,friendlyError(e)));

}

export function openMaterialReview({jobId,reportJobId,sku,issues=[],openChat,call=businessCall}){const dialog=el('dialog',undefined,'material-dialog'),close=el('button','关闭'),body=el('section');close.onclick=()=>dialog.close();dialog.append(close,body);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});materialEditor(body,{jobId,sku,call,openChat,issues});dialog.showModal();if(issues.length&&issues.every(x=>typeof x==='string'||!x.reason))call('giga_report',{id:reportJobId||jobId,sku,section:'required',offset:0}).then(r=>{if(!dialog.isConnected||r.nextOffset!==null)return;try{const v=JSON.parse(r.content);if(v.blocking_holds?.length&&!body.querySelector('textarea')?.value)materialEditor(body,{jobId,sku,call,openChat,issues:v.blocking_holds});}catch{}}).catch(()=>{});return dialog;}

export function quoteTables(products){const group=new Map(),out=document.createDocumentFragment();for(const p of products){const c=/^[A-Z]{3}$/.test(p.currency||'')?p.currency:'币种待核实';if(!group.has(c))group.set(c,[]);group.get(c).push(p);}for(const [currency,rows] of group)out.append(table(['编码','商品','采购报价（'+currency+'）','标准配送报价（'+currency+'）','供应商库存'],rows.map(x=>[x.code,x.name,number(x.purchaseQuote),number(x.shippingQuote),x.available??'待核实'])));return out;}

export function gigaQueries(target,codes,{offline=false,site='US',siteAvailable=true,siteChecking=false}={}){

 const screeningResults=el('section'),history=el('select'),historyLabel=el('label','历史上架批次 '),chat=el('section'),materials=el('section'),progress=el('section'),bulk=el('section',undefined,'operation-preview'),results=el('div'),report=el('section',undefined,'operation-preview'),review=el('section',undefined,'operation-preview'),actions=el('div',undefined,'toolbar');history.setAttribute('aria-label','历史上架批次');historyLabel.append(history);history.append(el('option','选择历史批次'));

 let chatId=null,closeChat=null,polling=false,refreshPending=false,signature='',running=false,starting=false,connected=!offline,quoteKey='',quoteGeneration=0,currentJob=null;const submitRows=[];

 const prepareBulk=async(r,items)=>{const ready=items.filter(x=>x.state==='PREVIEW_VALID'&&!x.latestAttempt).map(x=>x.sku),key=JSON.stringify([r.rootJobId||r.id,items,r.submissions]);if(key===quoteKey)return;quoteKey=key;const generation=++quoteGeneration;bulk.replaceChildren();if(!ready.length)return;bulk.append(el('p','正在整理可提交商品的价格和数量……'));try{const p=await businessCall('proposal_prepare',{action:{target:'giga',operation:'giga_batch_import',site,value:ready.join(','),batchJobId:r.rootJobId||r.id,reason:'用户核对本批商品固定价格和库存后，一次确认后台提交'}});if(generation!==quoteGeneration||lastGigaJob!==(r.rootJobId||r.id))return;bulk.replaceChildren();bulk.append(el('h3','本批可提交商品'),table(['商品编码','售价（USD）','刊登库存'],p.preview.items.map(x=>[x.sku,Number(x.price).toFixed(2),x.quantity])),el('p','点击下面按钮即确认以上价格和库存。服务器会在后台逐款检查并提交；有问题的留下，其他继续。库存为0的只建链接，不接受订单。'));const submit=button('一键提交这 '+p.preview.items.length+' 款商品',async()=>{submit.dataset.locked='true';await businessCall('proposal_decide',{id:p.id,hash:p.hash,decision:'confirm'});bulk.replaceChildren(el('h3','已交给服务器后台提交'),el('p','可以离开此页面或关闭软件；逐款结果会自动同步。'));signature='';await refresh();});submit.classList.add('primary-action');bulk.append(submit);if(p.preview.skipped?.length)bulk.append(el('p','其余 '+p.preview.skipped.length+' 款未加入提交，将保留处理说明。','muted'));}catch(e){if(generation!==quoteGeneration)return;bulk.replaceChildren(el('p',e.message==='NO_READY_PRODUCTS'?'没有新的可提交商品；已提交、处理中或待修正的商品不会重复提交。':'暂时无法整理提交清单，请刷新后重试。','muted'));}};

 const showChat=id=>{if(chatId===id)return;closeChat?.();chatId=id;closeChat=batchChat(chat,id,{call:businessCall,offline});};

 const selected=()=>[...codes],updateButtons=()=>{const locked=activeGigaQueue||!connected||!siteAvailable||running||!selected().length;query.disabled=prepare.disabled=locked;query.dataset.locked=prepare.dataset.locked=String(locked);const resumeLocked=activeGigaQueue||!connected||!siteAvailable||running||!continuation(currentJob).codes.length;resume.disabled=resumeLocked;resume.dataset.locked=String(resumeLocked);};

 const addHistory=({id,created,codes:historyCodes})=>{
  if([...history.options].some(option=>option.value===id))return;
  const option=el('option',new Date(created*1000).toLocaleString('zh-CN')+' · '+historyCodes.length+'款 · '+id.slice(0,8));
  option.value=id;history.append(option);
 };
 const refresh=async()=>{if(starting||!lastGigaJob)return;if(polling){refreshPending=true;return;}polling=true;const requestedJob=lastGigaJob;try{const r=await businessCall('giga_job',{id:requestedJob});if(starting||lastGigaJob!==requestedJob)return;connected=true;currentJob=r;running=['queued','running'].includes(r.state);updateButtons();const nextSignature=JSON.stringify([r.id,r.state,r.result,r.childJobs,r.submissions,connected,siteAvailable,siteChecking]);if(nextSignature===signature)return r.state;signature=nextSignature;renderProgress(progress,r);const mode=r.preparationMode||r.result?.preparationMode;if(mode==='ai_workflow')showChat(r.rootJobId||r.id);const items=r.result?.pipeline?.items||[];results.replaceChildren();submitRows.length=0;if(r.result?.products)results.append(quoteTables(r.result.products));const quoteHolds=(r.result?.products||[]).filter(x=>x.quoteScreen);if(quoteHolds.length)results.append(table(['采购筛选','结果'],quoteHolds.map(x=>[x.code,x.quoteScreen==='GIGA_LANDED_QUOTE_OVER_3000_USD'?'采购单价加配送费超过 3,000 USD，排除':'报价或币种待核实，暂停'])));

 const byCode=new Map((r.result?.products||[]).map(x=>[x.code,x]));const products=[...new Set([...(r.codes||[]),...byCode.keys()])].map(code=>byCode.get(code)||{code});for(const product of products){const submission=(r.submissions||[]).flatMap(x=>x.items||[]).filter(x=>x.sku===product.code).at(-1);const item=items.find(x=>x.sku===product.code)||{},issue=itemIssue(item,mode),row=el('section',undefined,'listing-action-row'+(issue.level==='error'||['needs_review','needs_reconciliation','rejected'].includes(submission?.state)?' has-error':'')),heading=el('div',undefined,'toolbar');heading.append(el('strong',product.code),el('span',submission?({queued:'等待后台检查',checking:'正在核对提交条件',submitting:'正在提交',accepted:'亚马逊已接收',verified:'已核对',needs_review:'暂停，请查看原因',needs_reconciliation:'提交结果待核对',rejected:'亚马逊未接受'}[submission.state]||submission.state):issue.title,'tag'));

 const submit=button('提交到亚马逊',async()=>{review.replaceChildren();const p=await businessCall('proposal_prepare',{action:{target:'giga',operation:'giga_import',site,sku:product.code,value:product.code,batchJobId:r.rootJobId||r.id,reason:'用户从商品列表核对并提交；先显示价格和库存，确认后才正式提交'}});proposalCard(review,p);if(p.state==='preparing'&&p.jobId){lastGigaJob=r.rootJobId||r.id;signature='';await refresh();}});submit.classList.add('primary-action');submit.disabled=!connected||!siteAvailable||!issue.ready||!!submission;heading.append(submit);row.append(heading);

 if(submission)row.append(el('p',submission.state==='needs_review'?publicationExplanation(submission):submission.state==='needs_reconciliation'?'已进入提交，但回执尚不能确认。请等待核对，不要重复提交。':'提交进度和结果已保存，关闭软件不会丢失。'));if(issue.problems?.length){if(item.attentionTotal)row.append(el('p','原报告共 '+item.attentionTotal+' 条待处理说明，归纳如下。','muted'));for(const problem of issue.problems){const box=el('section',undefined,'listing-problem');box.append(el('h4',problem.title),el('p','哪里有问题：'+problem.why),el('p','怎么处理：'+problem.next));row.append(box);}if(item.attention?.length){const detail=el('details');detail.append(el('summary','查看报告原文与依据'),el('pre',JSON.stringify(item.attention,null,2)));row.append(detail);}}else if(issue.reason)row.append(el('p',issue.reason));const next=el('p',!siteAvailable?(siteChecking?'正在检查上架站点，请稍候。':'请先在页面上方选择可用的上架站点；若无法读取站点，请刷新。'):!connected?'暂时连接不上，请恢复连接后刷新。':running?(issue.level==='error'?'此款保存有未解决问题，原因见上方；请以当前批次进度为准，整批结束后可原地续检。':'本批仍在处理，请等待检查结束。'):issue.submitted?issue.next:issue.ready?'尚未提交。点击右侧按钮，核对库存和价格后再确认。':'暂不能提交：'+issue.title+'。'+issue.next,'listing-next');row.append(next);submitRows.push({submit,next,issue});

 

 const secondary=el('div',undefined,'toolbar');if(submission?.operationId&&['accepted','verified','needs_reconciliation'].includes(submission.state))secondary.append(button('核对亚马逊结果',async()=>{await businessCall('operation_readback',{id:submission.operationId});signature='';await refresh();}));if(!issue.submitted&&(!issue.ready||submission?.state==='needs_review')&&!running)secondary.append(button('继续检查此商品',()=>start('giga_prepare',[product.code],r.rootJobId||r.id)));

 secondary.append(button(issue.needsInput?'核对并补充':'补充或修改资料',()=>openMaterialReview({jobId:r.rootJobId||r.id,reportJobId:r.id,sku:product.code,issues:item.attention||[],openChat:showChat})),button('查看处理说明',()=>{showChat(r.rootJobId||r.id);chat.scrollIntoView({block:'start',behavior:'smooth'});}));row.append(secondary);results.append(row);}prepareBulk(r,items);return r.state;

 }catch(e){if(lastGigaJob!==requestedJob)return 'unknown';connected=false;signature='';updateButtons();for(const row of submitRows){row.submit.disabled=true;row.next.textContent='暂时连接不上，请恢复连接后刷新。';}renderProgress(progress,{state:'connection_lost'});return 'unknown';}finally{polling=false;if(refreshPending){refreshPending=false;queueMicrotask(refresh);}}};

 const start=async(op,list=selected(),parentJobId=null)=>{
  if(activeGigaQueue||starting)return;
  const batchCodes=[...new Set(list.map(code=>code.toUpperCase()))];
  if(!batchCodes.length)return;
  activeGigaQueue=true;
  starting=true;running=true;history.disabled=true;updateButtons();screeningResults.replaceChildren();
  progress.replaceChildren();
  let admitted=false, pendingJob=false, sentUnconfirmed=[];
  const screenExcluded=new Set();
  try{
   const result=await ensureGigaFavorites(progress,{site,codes:batchCodes,reuse:op==='giga_prepare'},async(receipt,part)=>{
    for(const row of receipt.excluded)screenExcluded.add(row.sku);
    if(receipt.excluded.length)screeningResults.append(table(['商品编码','详情退货率筛选'],receipt.excluded.map(row=>[
      row.sku,row.state==='RETURN_RATE_NOT_LOW'?'退货率不符合低或 N/A，排除':'详情页退货率无法核实，暂停'
    ])));
    if(!receipt.codes.length)return;
    const requestId=crypto.randomUUID();
    const accepted=new Set(receipt.codes);
    const browserScreen={id:receipt.screenId,site,items:receipt.items.filter(row=>accepted.has(row.sku))};
    part.update('收藏已核对，正在向服务器发送本段任务。');
    const remember=id=>{
     lastGigaJob=parentJobId||id;signature='';
     if(!parentJobId){
      const entry={id,created:Date.now()/1000,codes:receipt.codes,site};
      sessionGigaJobs.set(id,entry);addHistory(entry);
     }
     history.value=lastGigaJob;
    };
    let job;
    const rateRetryDeadline=Date.now()+45*60*1000;
    while(!job){
     try{
      job=await businessCall(op,{codes:receipt.codes,requestId,site,...(op==='giga_prepare'?{browserScreen}:{}),...(parentJobId?{parentJobId}:{})});
      if(!job?.id)throw Error('GIGA_ADMISSION_RECEIPT_INVALID');
     }catch(error){
      if(error.outcome!=='unknown'&&!String(error.message).includes('OUTCOME_UNKNOWN')&&String(error.message).includes('GIGA_RETURN_SCREEN_REQUIRED'))
       throw Object.assign(Error('收藏回执需要重新核验'),{verificationRequired:receipt.codes});
      const limited=!String(error.message).includes('OUTCOME_UNKNOWN')&&error.outcome!=='unknown'&&String(error.message).includes('GIGA_QUERY_RATE_LIMIT');
      if(!limited){
       pendingJob=true;sentUnconfirmed=receipt.codes;remember(requestId);
       throw Object.assign(error,{outcome:'unknown'});
      }
      if(Date.now()>=rateRetryDeadline)throw error;
      part.allowStop();
      part.update('服务器达到频率限制，等一分钟再检查。');
      const nextTry=Date.now()+60000;
      while(part.active()&&!part.stopRequested()&&Date.now()<nextTry){
       await new Promise(resolve=>setTimeout(resolve,1000));
      }
      if(!part.active()||part.stopRequested())throw error;
     }
    }
    admitted=true;pendingJob=true;sentUnconfirmed=receipt.codes;
    remember(job.rootJobId||job.id);
    if(part.count===1)return;
    part.update('服务器正在处理本段，完成后才开始下一段。');
    while(part.active()&&['queued','running'].includes(job.state)){
     await new Promise(resolve=>setTimeout(resolve,5000));
     if(!part.active())return;
     job=await businessCall('giga_job',{id:job.id});
    }
    if(!part.active())return;
    pendingJob=false;
    if(job.state!=='completed')throw Error(job.result?.code||'GIGA_SEGMENT_FAILED');
    sentUnconfirmed=[];
    const summary=el('section');
    summary.append(el('p','第 '+part.index+'/'+part.count+' 段完成 · '+receipt.codes.length+' 款'));
    if(op==='giga_query'&&job.result?.products?.length)summary.append(quoteTables(job.result.products));
    screeningResults.append(summary);
   });
   running=pendingJob;
   if(result.cancelled)return;
   const verificationRequired=result.verificationRequired||result.error?.verificationRequired;
   if(verificationRequired?.length){
    const hold=el('section',undefined,'operation-preview');
    hold.append(el('h3','请先读取待核验商品的云仓资料'),
     el('p','以下 '+verificationRequired.length+' 款缺少有效收藏回执。请先用「读取云仓详情、报价和库存」核验，再回到当前入口。'),
     el('pre',verificationRequired.join('\n')));
    screeningResults.append(hold);
    if((admitted||pendingJob)&&target.isConnected){starting=false;await refresh();}
    return;
   }
   if(result.remaining.length){
    const hold=el('section',undefined,'operation-preview');
    hold.append(el('h3','分段处理已暂停'),el('p','已处理 '+result.processed+' 款。'));
    if(result.error){
     const errorBox=el('div');message(errorBox,friendlyError(result.error));hold.append(errorBox);
    }
    const sent=new Set(sentUnconfirmed);
    const unsent=result.remaining.filter(sku=>!sent.has(sku)&&!screenExcluded.has(sku));
    for(const [label,skus] of [['已发送或发送结果待核对，请先查看历史批次',sentUnconfirmed],['尚未发送给服务器的 SKU',unsent]]){
     if(!skus.length)continue;
     const details=el('details');
     details.append(el('summary',label+'（'+skus.length+' 款）'),el('pre',skus.join('\n')));
     hold.append(details);
    }
    screeningResults.append(hold);
   }else if(!admitted){
    progress.append(el('p','本批没有通过退货率检查的商品。'));
   }
   if((admitted||pendingJob)&&target.isConnected){starting=false;await refresh();}
  }finally{
   activeGigaQueue=false;starting=false;running=pendingJob&&running;history.disabled=false;updateButtons();
  }
 };
 const query=button('读取云仓详情、报价和库存',()=>start('giga_query')),prepare=button('AI准备并检查上架',()=>start('giga_prepare')),resume=button('继续检查本批（复用已有结果）',async()=>{const value=continuation(currentJob);if(!value.rootId||!value.codes.length)throw Error('没有可继续检查的商品');await start('giga_prepare',value.codes,value.rootId);});updateButtons();actions.append(query,prepare,resume,button('刷新结果',refresh));target.append(actions,historyLabel,progress,screeningResults,bulk,results,review,materials,report,chat);

 history.onchange=()=>{if(history.value){currentJob=null;updateButtons();lastGigaJob=history.value;signature='';quoteKey='';quoteGeneration++;bulk.replaceChildren();review.replaceChildren();materials.replaceChildren();refresh();}};

 for(const entry of sessionGigaJobs.values())if(entry.site===site)addHistory(entry);
 businessCall('batch_chat_list').then(r=>{for(const b of r.batches)addHistory(b);if(!lastGigaJob&&r.batches.length)lastGigaJob=r.batches[0].id;if(lastGigaJob){history.value=lastGigaJob;refresh();}}).catch(()=>{});
 const timer=setInterval(()=>{if(!target.isConnected){clearInterval(timer);closeChat?.();return;}updateButtons();if(lastGigaJob)refresh();},5000);

 target.append(el('p','选择历史批次后可直接继续检查，不用重新输入编码。有效的已审资料、文案和模型缓存会复用；资料或类目要求改变时只重新处理受影响步骤，报价和库存会刷新。读取和AI准备都不会正式上架。检查通过的商品可在清单中核对价格和库存，再一键提交；服务器后台逐款处理，有问题的会留下说明。','muted'));

}

