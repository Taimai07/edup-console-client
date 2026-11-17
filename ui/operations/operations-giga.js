// The 大健 query / screening view (gigaQueries); the work is split over the operations-giga-* files.
// Split out of operations-giga.js unchanged (client round 3); shared state is passed in as `g`.
import {skuListPanel,renderModelUsage} from '../giga/giga-lists.js';
import {continuation} from './batch-progress.js';
import {el} from './analytics.js';
import {businessCall,button} from './operations-core.js';
import {gstate,sessionGigaJobs} from './operations-giga-state.js';
import {createRefresh} from './operations-giga-refresh.js';
import {createStart} from './operations-giga-start.js';

export function gigaQueries(target,codes,{offline=false,site='US',siteAvailable=true,siteChecking=false,readOnMount=false}={}){

 const screeningResults=el('section'),history=el('select'),historyLabel=el('label','历史上架批次 '),chat=el('section'),materials=el('section'),progress=el('section'),bulk=el('section',undefined,'operation-preview'),results=el('div'),report=el('section',undefined,'operation-preview'),review=el('section',undefined,'operation-preview'),actions=el('div',undefined,'toolbar');history.setAttribute('aria-label','历史上架批次');historyLabel.append(history);history.append(el('option','选择历史批次'));
 const buyerReviews=el('section',undefined,'operation-preview');buyerReviews.hidden=true;
 const modelUsage=el('section',undefined,'operation-preview');
 const g={};
 Object.assign(g,{chatId:null,closeChat:null,polling:false,refreshPending:false,signature:'',running:false,starting:false,connected:!offline,quoteKey:'',quoteGeneration:0,currentJob:null});const submitRows=[];g.submitRows=submitRows;
 Object.assign(g,{target,codes,offline,site,siteAvailable,siteChecking,readOnMount,screeningResults,history,historyLabel,chat,materials,progress,bulk,results,report,review,actions,buyerReviews,modelUsage});
 createRefresh(g);createStart(g);
 g.query=button('读取云仓详情、报价和库存',()=>g.start('giga_query'));g.prepare=button('AI准备并检查上架',()=>g.start('giga_prepare'));g.resume=button('继续检查本批（复用已有结果）',async()=>{const value=continuation(g.currentJob);if(!value.rootId||!value.codes.length)throw Error('没有可继续检查的商品');await g.start('giga_prepare',value.codes,value.rootId);});g.updateButtons();actions.append(g.query,g.prepare,g.resume,button('刷新结果',g.refresh));target.append(actions,historyLabel,progress,screeningResults,bulk,results,review,materials,report,chat);

 history.onchange=()=>{if(history.value){g.currentJob=null;g.updateButtons();gstate.lastGigaJob=history.value;g.signature='';g.quoteKey='';g.quoteGeneration++;screeningResults.replaceChildren();bulk.replaceChildren();review.replaceChildren();materials.replaceChildren();g.refresh();}};

 for(const entry of sessionGigaJobs.values())if(entry.site===site)g.addHistory(entry);
 target.append(buyerReviews,skuListPanel({call:businessCall,site,offline:offline||!siteAvailable,
  onResume:list=>g.start('giga_prepare',list)}),modelUsage);
 renderModelUsage(modelUsage,null);
 g.refreshBuyerReviews().catch(()=>{});
 businessCall('batch_chat_list').then(r=>{for(const b of r.batches)g.addHistory(b);if(!gstate.lastGigaJob&&r.batches.length)gstate.lastGigaJob=r.batches[0].id;if(gstate.lastGigaJob){history.value=gstate.lastGigaJob;g.refresh();}}).catch(()=>{});
 const timer=setInterval(()=>{if(!target.isConnected){clearInterval(timer);g.closeChat?.();return;}g.updateButtons();if(gstate.lastGigaJob)g.refresh();},5000);

 target.append(el('p','选择历史批次后可直接继续检查，不用重新输入编码。有效的已审资料、文案和模型缓存会复用；资料或类目要求改变时只重新处理受影响步骤，报价和库存会刷新。读取和AI准备都不会正式上架。检查通过的商品可在清单中核对价格和库存，再一键提交；服务器后台逐款处理，有问题的会留下说明。','muted'));

 if(readOnMount)queueMicrotask(()=>{if(target.isConnected&&!g.query.disabled)g.query.onclick();});
}
