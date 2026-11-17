// The 大健 view: buyer reviews, bulk quote, history, button state and job refresh.
// Split out of operations-giga.js unchanged (client round 3); shared state is passed in as `g`.
import {renderModelUsage} from '../giga/giga-lists.js';
import {renderProgress,itemIssue,continuation} from './batch-progress.js';
import {batchChat} from './batch-chat.js';
import {el,table} from './analytics.js';
import {friendlyError} from '../common/notices.js';
import {businessCall,button,proposalCard,publicationExplanation,openMaterialReview,quoteTables} from './operations-core.js';
import {gstate} from './operations-giga-state.js';

export function createRefresh(g){
 const {target,codes,offline,site,siteAvailable,siteChecking,history,chat,progress,bulk,results,review,buyerReviews,modelUsage,submitRows}=g;
 g.refreshBuyerReviews=async()=>{
  if(site!=='US'||offline)return;
  const value=await businessCall('service_status');
  if(!target.isConnected)return;
  renderModelUsage(modelUsage,value.modelUsage);
  const rows=value?.giga?.buyerReviews||[];
  buyerReviews.replaceChildren();buyerReviews.hidden=!rows.length;
  if(rows.length)buyerReviews.append(el('h3','待核对买家页面'));
  for(const row of rows){
   const item=el('p',row.sku+' · '+(row.state==='offer_verified_page_review_pending'?'本店报价已核对，实际页面待核对。':'本店报价尚待核实。'));
   if(window.edup?.maintenance)item.append(button('打开买家页面',()=>window.edup.maintenance('giga-open-buyer-page',{asin:row.asin})));
   buyerReviews.append(item);
  }
 };

 g.prepareBulk=async(r,items)=>{const ready=items.filter(x=>x.state==='PREVIEW_VALID'&&!x.latestAttempt).map(x=>x.sku),key=JSON.stringify([r.rootJobId||r.id,items,r.submissions]);if(key===g.quoteKey)return;g.quoteKey=key;const generation=++g.quoteGeneration;bulk.replaceChildren();if(!ready.length)return;bulk.append(el('p','正在整理可提交商品的价格和数量……'));try{const p=await businessCall('proposal_prepare',{action:{target:'giga',operation:'giga_batch_import',site,value:ready.join(','),batchJobId:r.rootJobId||r.id,reason:'用户核对本批商品固定价格和库存后，一次确认后台提交'}});if(generation!==g.quoteGeneration||gstate.lastGigaJob!==(r.rootJobId||r.id))return;bulk.replaceChildren();bulk.append(el('h3','本批可提交商品'),table(['商品编码','售价（USD）','刊登库存'],p.preview.items.map(x=>[x.sku,Number(x.price).toFixed(2),x.quantity])),el('p','点击下面按钮即确认以上价格和库存。服务器会在后台逐款检查并提交；有问题的留下，其他继续。库存为0的只建链接，不接受订单。'));const submit=button('一键提交这 '+p.preview.items.length+' 款商品',async()=>{submit.dataset.locked='true';const response=await businessCall('proposal_decide',{id:p.id,hash:p.hash,decision:'confirm'});const decision=response?.proposal||response;if(decision?.state==='rejected'){let result=decision;if(typeof decision.result==='string'){try{result=JSON.parse(decision.result);}catch{}}if(result?.outcome==='not_admitted'){g.quoteKey='';g.signature='';await g.refresh();throw Error(result.code);}}if(!['submitted','queued','running','completed'].includes(decision?.state))throw Error('EXECUTION_UNCERTAIN_CHECK_RECEIPT');bulk.replaceChildren(el('h3','已交给服务器后台提交'),el('p','可以离开此页面或关闭软件；逐款结果会自动同步。'));g.signature='';await g.refresh();});submit.classList.add('primary-action');bulk.append(submit);if(p.preview.skipped?.length)bulk.append(el('p','其余 '+p.preview.skipped.length+' 款未加入提交，将保留处理说明。','muted'));for(const skipped of p.preview.skipped||[]){if(['PRICING_RULE_CHANGED_REPREPARE','GIGA_RETURN_RATE_REVERIFY_REQUIRED','GIGA_OPENING_REVERIFY_REQUIRED'].includes(skipped.reason))bulk.append(el('p',skipped.sku+' · '+friendlyError(skipped.reason).message,'muted'));}}catch(e){if(generation!==g.quoteGeneration)return;bulk.replaceChildren(el('p',e.message==='NO_READY_PRODUCTS'?'没有新的可提交商品；已提交、处理中或待修正的商品不会重复提交。':['PRICING_RULE_CHANGED_REPREPARE','GIGA_RETURN_RATE_REVERIFY_REQUIRED','GIGA_OPENING_REVERIFY_REQUIRED'].includes(e.message)?friendlyError(e).message:'暂时无法整理提交清单，请刷新后重试。','muted'));}};

 g.showChat=id=>{if(g.chatId===id)return;g.closeChat?.();g.chatId=id;g.closeChat=batchChat(chat,id,{call:businessCall,offline});};

 g.selected=()=>[...codes];g.updateButtons=()=>{const locked=gstate.activeGigaQueue||!g.connected||!siteAvailable||g.running||!g.selected().length;g.query.disabled=g.prepare.disabled=locked;g.query.dataset.locked=g.prepare.dataset.locked=String(locked);const resumeLocked=gstate.activeGigaQueue||!g.connected||!siteAvailable||g.running||!continuation(g.currentJob).codes.length;g.resume.disabled=resumeLocked;g.resume.dataset.locked=String(resumeLocked);};

 g.addHistory=({id,created,codes:historyCodes})=>{
  if([...history.options].some(option=>option.value===id))return;
  const option=el('option',new Date(created*1000).toLocaleString('zh-CN')+' · '+historyCodes.length+'款 · '+id.slice(0,8));
  option.value=id;history.append(option);
 };

 g.refresh=async()=>{if(g.starting||!gstate.lastGigaJob)return;if(g.polling){g.refreshPending=true;return;}g.polling=true;const requestedJob=gstate.lastGigaJob;try{const r=await businessCall('giga_job',{id:requestedJob});if(g.starting||gstate.lastGigaJob!==requestedJob)return;g.connected=true;g.currentJob=r;g.running=['queued','running'].includes(r.state);g.updateButtons();const nextSignature=JSON.stringify([r.id,r.state,r.result,r.childJobs,r.submissions,g.connected,siteAvailable,siteChecking]);if(nextSignature===g.signature)return r.state;g.signature=nextSignature;renderProgress(progress,r);const mode=r.preparationMode||r.result?.preparationMode;if(mode==='ai_workflow')g.showChat(r.rootJobId||r.id);const items=r.result?.pipeline?.items||[];results.replaceChildren();submitRows.length=0;if(r.result?.products)results.append(quoteTables(r.result.products));const quoteHolds=(r.result?.products||[]).filter(x=>x.quoteScreen);if(quoteHolds.length)results.append(table(['采购筛选','结果'],quoteHolds.map(x=>[x.code,x.quoteScreen==='GIGA_LANDED_QUOTE_OVER_3000_USD'?'采购单价加配送费超过 3,000 USD，排除':'报价或币种待核实，暂停'])));

 const byCode=new Map((r.result?.products||[]).map(x=>[x.code,x]));const products=[...new Set([...(r.codes||[]),...byCode.keys()])].map(code=>byCode.get(code)||{code});for(const product of products){const submission=(r.submissions||[]).flatMap(x=>x.items||[]).filter(x=>x.sku===product.code).at(-1);const item=items.find(x=>x.sku===product.code)||{},issue=itemIssue(item,mode),row=el('section',undefined,'listing-action-row'+(issue.level==='error'||['needs_review','needs_reconciliation','rejected'].includes(submission?.state)?' has-error':'')),heading=el('div',undefined,'toolbar');heading.append(el('strong',product.code),el('span',submission?({queued:'等待后台检查',checking:'正在核对提交条件',submitting:'正在提交',accepted:'亚马逊已接收',verified:'已核对',needs_review:'暂停，请查看原因',not_sent:'未发出（可以放心重试）',needs_reconciliation:'提交结果待核对',rejected:'亚马逊未接受'}[submission.state]||submission.state):issue.title,'tag'));

 const submit=button('提交到亚马逊',async()=>{review.replaceChildren();const p=await businessCall('proposal_prepare',{action:{target:'giga',operation:'giga_import',site,sku:product.code,value:product.code,batchJobId:r.rootJobId||r.id,reason:'用户从商品列表核对并提交；先显示价格和库存，确认后才正式提交'}});proposalCard(review,p);if(p.state==='preparing'&&p.jobId){gstate.lastGigaJob=r.rootJobId||r.id;g.signature='';await g.refresh();}});submit.classList.add('primary-action');submit.disabled=!g.connected||!siteAvailable||!issue.ready||!!submission;heading.append(submit);row.append(heading);

 if(submission)row.append(el('p',submission.state==='needs_review'?publicationExplanation(submission):submission.state==='needs_reconciliation'?'已进入提交，但回执尚不能确认。请等待核对，不要重复提交。':'提交进度和结果已保存，关闭软件不会丢失。'));if(issue.problems?.length){if(item.attentionTotal)row.append(el('p','原报告共 '+item.attentionTotal+' 条待处理说明，归纳如下。','muted'));for(const problem of issue.problems){const box=el('section',undefined,'listing-problem');box.append(el('h4',problem.title),el('p','哪里有问题：'+problem.why),el('p','怎么处理：'+problem.next));row.append(box);}if(item.attention?.length){const detail=el('details');detail.append(el('summary','查看报告原文与依据'),el('pre',JSON.stringify(item.attention,null,2)));row.append(detail);}}else if(issue.reason)row.append(el('p',issue.reason));const next=el('p',!siteAvailable?(siteChecking?'正在检查上架站点，请稍候。':'请先在页面上方选择可用的上架站点；若无法读取站点，请刷新。'):!g.connected?'暂时连接不上，请恢复连接后刷新。':g.running?(issue.level==='error'?'此款保存有未解决问题，原因见上方；请以当前批次进度为准，整批结束后可原地续检。':'本批仍在处理，请等待检查结束。'):issue.submitted?issue.next:issue.ready?'尚未提交。点击右侧按钮，核对库存和价格后再确认。':'暂不能提交：'+issue.title+'。'+issue.next,'listing-next');row.append(next);submitRows.push({submit,next,issue});

 

 const secondary=el('div',undefined,'toolbar');if(submission?.operationId&&['accepted','verified','needs_reconciliation'].includes(submission.state))secondary.append(button('核对亚马逊结果',async()=>{await businessCall('operation_readback',{id:submission.operationId});g.signature='';await g.refresh();}));if(!issue.submitted&&(!issue.ready||submission?.state==='needs_review')&&!g.running)secondary.append(button('继续检查此商品',()=>g.start('giga_prepare',[product.code],r.rootJobId||r.id)));

 secondary.append(button(issue.needsInput?'核对并补充':'补充或修改资料',()=>openMaterialReview({jobId:r.rootJobId||r.id,reportJobId:r.id,sku:product.code,issues:item.attention||[],openChat:g.showChat})),button('查看处理说明',()=>{g.showChat(r.rootJobId||r.id);chat.scrollIntoView({block:'start',behavior:'smooth'});}));row.append(secondary);results.append(row);}g.prepareBulk(r,items);return r.state;

 }catch(e){if(gstate.lastGigaJob!==requestedJob)return 'unknown';g.connected=false;g.signature='';g.updateButtons();for(const row of submitRows){row.submit.disabled=true;row.next.textContent='暂时连接不上，请恢复连接后刷新。';}renderProgress(progress,{state:'connection_lost'});return 'unknown';}finally{g.polling=false;if(g.refreshPending){g.refreshPending=false;queueMicrotask(g.refresh);}}};
}
