// The 大健 view: start a query / prepare / re-verify run (segments, favourites, admission).
// Split out of operations-giga.js unchanged (client round 3); shared state is passed in as `g`.
import {ensureGigaFavorites,favoriteEvidenceText,reconcileGigaFavorites} from '../giga/giga-browser.js';
import {openSegmentJournal} from '../giga/giga-segment-journal.js';
import {el,table} from './analytics.js';
import {message,friendlyError} from '../common/notices.js';
import {businessCall,button,quoteTables} from './operations-core.js';
import {gstate,sessionGigaJobs} from './operations-giga-state.js';

export function createStart(g){
 const {target,codes,site,screeningResults,history,progress,review}=g;
 g.start=async(op,list=g.selected(),parentJobId=null)=>{
  if(gstate.activeGigaQueue||g.starting)return;
  const batchCodes=[...new Set(list.map(code=>code.toUpperCase()))];
  if(!batchCodes.length)return;
  gstate.activeGigaQueue=true;
  g.starting=true;g.running=true;history.disabled=true;g.updateButtons();screeningResults.replaceChildren();
  progress.replaceChildren();
  let admitted=false, pendingJob=false, sentUnconfirmed=[];
  const screenExcluded=new Set();
  const reverifyOnly=op==='giga_reverify';
  try{
   const journal=reverifyOnly?null:await openSegmentJournal(window.localStorage,{site,operation:op,parent:parentJobId,codes:batchCodes});
   const previouslyProcessed=new Set();
   for(const [segment, prior] of journal?.entries()||[]){
    if(prior.state==='completed'){for(const sku of prior.codes)previouslyProcessed.add(sku);continue;}
    if(!['admitting','queued','running'].includes(prior.state))continue;
    const id=prior.jobId||prior.requestId;
    let job;
    try{job=await businessCall('giga_job',{id});}
    catch(error){
     pendingJob=true;sentUnconfirmed=prior.codes;gstate.lastGigaJob=id;
     throw Object.assign(error,{outcome:'unknown'});
    }
    journal.seen(segment,job);
    if(['queued','running'].includes(job.state)){
     pendingJob=true;sentUnconfirmed=prior.codes;gstate.lastGigaJob=job.rootJobId||job.id;
     throw Object.assign(Error('GIGA_BROWSER_RECEIPT_UNKNOWN'),{outcome:'unknown'});
    }
    if(job.state==='completed')for(const sku of prior.codes)previouslyProcessed.add(sku);
   }
   const remaining=batchCodes.filter(sku=>!previouslyProcessed.has(sku));
   if(!remaining.length){g.running=false;progress.replaceChildren(el('p','这些商品的分组已处理，已有结果保留。'));return;}
   const result=await ensureGigaFavorites(progress,{site,codes:remaining,reuse:op==='giga_prepare'},async(receipt,part)=>{
    for(const row of receipt.excluded)screenExcluded.add(row.sku);
    if(receipt.excluded.length)screeningResults.append(table(['商品编码','详情退货率筛选'],receipt.excluded.map(row=>[
      row.sku,favoriteEvidenceText(row.rate||row.reason||row.state)
    ])));
    if(receipt.id&&receipt.excluded.some(row=>row.reason==='RECONCILIATION_PENDING')){
     const review=el('section',undefined,'operation-preview'),status=el('p','部分收藏待核对。');
     let receiptId=receipt.id;
     const retry=button('再试一次',async()=>{
      if(g.starting){status.textContent='请等当前分组处理结束再核对。';return;}
      const checked=await reconcileGigaFavorites(receiptId,()=>review.isConnected,text=>{status.textContent=text;});
      receiptId=checked.id;
      status.textContent=checked.excluded.length?'部分收藏仍待核对。':'收藏状态已核对，可继续原流程。';
      retry.hidden=!checked.excluded.some(row=>row.reason==='RECONCILIATION_PENDING');
     });
     review.append(status,retry);screeningResults.append(review);
    }
    if(reverifyOnly||!receipt.codes.length)return;
    const segment=part.codes.join(',');
    const requestId=journal.reserve(segment,receipt.codes);
    const accepted=new Set(receipt.codes);
    const browserScreen={id:receipt.screenId,site,items:receipt.items.filter(row=>accepted.has(row.sku)),
     ...(receipt.buyerHash?{buyerHash:receipt.buyerHash}:{})};
    part.update('收藏已核对，正在向服务器发送本段任务。');
    const remember=id=>{
     gstate.lastGigaJob=parentJobId||id;g.signature='';
     if(!parentJobId){
      const entry={id,created:Date.now()/1000,codes:receipt.codes,site};
      sessionGigaJobs.set(id,entry);g.addHistory(entry);
     }
     history.value=gstate.lastGigaJob;
    };
    let job;
    const rateRetryDeadline=Date.now()+45*60*1000;
    while(!job){
     try{
      job=await businessCall(op,{codes:receipt.codes,requestId,site,...(op==='giga_prepare'?{browserScreen}:{}),...(parentJobId?{parentJobId}:{})});
      if(!job?.id)throw Error('GIGA_ADMISSION_RECEIPT_INVALID');
     }catch(error){
      if(error.outcome!=='unknown'&&!String(error.message).includes('OUTCOME_UNKNOWN')&&String(error.message).includes('GIGA_RETURN_SCREEN_REQUIRED')){
       journal.seen(segment,{id:requestId,state:'not_admitted'});
       throw Object.assign(Error('收藏回执需要重新核验'),{verificationRequired:receipt.codes});
      }
      const limited=!String(error.message).includes('OUTCOME_UNKNOWN')&&error.outcome!=='unknown'&&String(error.message).includes('GIGA_QUERY_RATE_LIMIT');
      if(!limited){
       pendingJob=true;sentUnconfirmed=receipt.codes;remember(requestId);
       throw Object.assign(error,{outcome:'unknown'});
      }
      if(Date.now()>=rateRetryDeadline){journal.seen(segment,{id:requestId,state:'not_admitted'});throw error;}
      part.allowStop();
      part.update('服务器达到频率限制，等一分钟再检查。');
      const nextTry=Date.now()+60000;
      while(part.active()&&!part.stopRequested()&&Date.now()<nextTry){
       await new Promise(resolve=>setTimeout(resolve,1000));
      }
      if(!part.active()||part.stopRequested()){journal.seen(segment,{id:requestId,state:'not_admitted'});throw error;}
     }
    }
    admitted=true;pendingJob=true;sentUnconfirmed=receipt.codes;
    journal.seen(segment,job);
    remember(job.rootJobId||job.id);
    if(part.count===1)return;
    part.update('服务器正在处理本段，完成后才开始下一段。');
    while(part.active()&&['queued','running'].includes(job.state)){
     await new Promise(resolve=>setTimeout(resolve,5000));
     if(!part.active())return;
     job=await businessCall('giga_job',{id:job.id});
    }
    if(!part.active())return;
    journal.seen(segment,job);
    pendingJob=false;
    if(job.state!=='completed')throw Error(job.result?.code||'GIGA_SEGMENT_FAILED');
    sentUnconfirmed=[];
    const summary=el('section');
    summary.append(el('p','第 '+part.index+'/'+part.count+' 段完成 · '+receipt.codes.length+' 款'));
    if(op==='giga_query'&&job.result?.products?.length)summary.append(quoteTables(job.result.products));
    screeningResults.append(summary);
   });
   g.running=pendingJob;
   if(result.cancelled)return;
   const verificationRequired=result.verificationRequired||result.error?.verificationRequired;
   if(verificationRequired?.length){
    const hold=el('section',undefined,'operation-preview');
    const details=new Map((result.verificationDetails||[]).map(row=>[row.sku,row.reason]));
    const defaultReason=result.error?.verificationRequired?'SERVER_RECHECK':'NO_FAVORITE_EVIDENCE';
    hold.append(el('h3','请先读取待核验商品的云仓资料'),
     el('p','以下 '+verificationRequired.length+' 款暂时无法进入本次准备。详情页明确显示「低」或 N/A 的商品通过退货率筛选，详情未核实的商品会暂停。'),
     table(['商品编码','暂停或排除原因'],verificationRequired.map(sku=>[sku,favoriteEvidenceText(details.get(sku)||defaultReason)])),
     button('读取并核验这 '+verificationRequired.length+' 款',()=>g.start('giga_reverify',verificationRequired)));
    screeningResults.append(hold);
    if((admitted||pendingJob)&&target.isConnected){g.starting=false;await g.refresh();}
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
   }else if(reverifyOnly&&result.processed>screenExcluded.size){
    const count=result.processed-screenExcluded.size;
    progress.append(el('p','已更新 '+count+' 款的收藏回执。'+(screenExcluded.size?'可以逐款继续检查已通过核验的商品。':'请再次点击刚才的准备或续检按钮。')));
   }else if(!admitted){
    progress.append(el('p','本批没有通过退货率检查的商品。'));
   }
   if((admitted||pendingJob)&&target.isConnected){g.starting=false;await g.refresh();}
  }finally{
   gstate.activeGigaQueue=false;g.starting=false;g.running=pendingJob&&g.running;history.disabled=false;g.updateButtons();
  }
 };
}
