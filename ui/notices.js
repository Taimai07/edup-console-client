const known={PROXY_SETTINGS_INVALID:['代理设置不正确','请填写有效的代理地址和1—65535范围内的端口。'],NETWORK_BUSY:['请稍后切换网络','当前有请求或更新正在处理，完成后再保存代理设置。'],ERR_PROXY_CONNECTION_FAILED:['无法连接代理','请检查代理软件是否运行、地址和端口是否一致。'],PROXY_APPLY_FAILED:['代理设置未生效','请核对配置后重试。'],STORE_BINDING_NOT_VERIFIED:['请先确认紫鸟店铺绑定','请核对站点、紫鸟店铺与当前登录用户后保存。'],STORE_BINDING_MISMATCH:['尚未绑定对应紫鸟店铺','请先为这个站点设置正确的店铺绑定。'],ZINIAO_VERSION_NEEDS_VERIFICATION:['需要核对紫鸟版本','此方式需要已登录的紫鸟v5.290或v6.25以上兼容版本。'],ZINIAO_OPEN_FAILED:['紫鸟未能打开','请确认这台电脑已安装并登录紫鸟，绑定的店铺和用户正确。'],DEVICE_UNAUTHORIZED:['这台电脑尚未配对','请进入“同步与维护”，使用一次性配对码连接。'],PAIR_EXPIRED:['配对码已失效','请使用新生成的配对码。'],DEVICE_LIMIT:['设备名额已满','请先确认需要保留的两台电脑，再撤销旧设备。'],CLOCK_SKEW:['电脑时间需要校准','请同步Windows系统时间后重试。'],MODEL_NOT_CONNECTED:['AI模型尚未连接','请先完成服务器模型配置。'],EXECUTOR_NOT_CONNECTED:['这项操作暂不可执行','实际业务接口尚未连接，本次没有修改平台。'],BASELINE_CHANGED_REVIEW_AGAIN:['商品资料已经变化','请重新读取商品并核对这次修改。'],FILE_CONFLICT:['这份文件已被更新','重新打开最新内容后再保存，避免覆盖。'],REQUEST_FAILED:['暂时无法完成请求','请稍后重试；若重复出现，可导出诊断包排查。'],INTERNAL_UNAVAILABLE:['服务器暂时无法提供数据','请稍后重试，已有资料仍会保留。'],AMAZON_VALIDATION_REJECTED:['亚马逊未接受这次修改','请核对字段要求。本次没有提交正式修改。']};
Object.assign(known,{GIGA_QUERY_RATE_LIMIT:['云仓处理达到服务频率限制','已完成分段保留。请稍后核对未完成的商品，再继续。'],GIGA_BROWSER_RECEIPT_UNKNOWN:['浏览器回执待核对','先核对当前分段的收藏结果，再继续未完成商品。'],GIGA_SEGMENT_FAILED:['当前分段处理失败','可从历史批次查看本段回执，已完成的分段保留。'],AI_SERVICE_TIMEOUT:['后台响应超时','工作台等待后台响应超过时限，原任务可能仍在处理。请核对原批次，不要重复提交。'],OPERATIONS_TIMEOUT_CHECK_STATUS:['执行器暂未及时响应','没有收到本次进度回执，不能据此认定任务停止或商品被拒绝。请核对原批次状态。'],OPERATIONS_BUSY:['后台暂时繁忙','服务器暂时无法及时处理查询，已有批次和资料仍保留。请稍后刷新。'],AI_SERVICE_NOT_CONNECTED:['后台连接暂不可用','请等待服务器连接恢复；这不是商品资料缺项。'],DOCUMENT_TEXT_TIMEOUT:['说明书解析超时','原文件仍保留，需后台核对解析日志；不需要重复上传。']});
Object.assign(known,{GIGA_VERIFICATION_REQUIRED:['大健要求人工验证','请在大健页面随便搜一个商品、完成拼图验证，再回到软件继续。程序不会自动处理验证。'],
  GIGA_BROWSER_READ_INTERRUPTED:['大健读取连接已中断','浏览器连接已重新建立，旧读取没有返回结果。原记录会保留，新的读取仍遵守节奏限制。'],
  GIGA_READ_RECEIPT_EXPIRED:['退货率回执已超过三天','请重新读取。正在执行的任务超时与已完成回执的有效期分别计算。'],
  GIGA_DETAIL_REVIEW_REQUIRED:['请检查大健商品页面','商品详情页未能核实。请处理页面上的验证、登录或商品异常提示后继续。'],
  GIGA_RESPONSE_INVALID:['大健返回了异常页面','可能需要人工验证。请到大健页面看一下，处理后再继续。'],
  GIGA_REQUEST_TIMEOUT:['大健页面响应超时','稍后会自动重试；也可以检查网络后再继续。'],
  GIGA_REQUEST_FAILED:['大健请求没发出去','请检查网络和大健页面是否还开着。']});
const pricingChanged=['定价规则已变','请在原批次按新价续检，核对新售价后再确认。'];
known.PRICING_RULE_CHANGED_REPREPARE=pricingChanged;
Object.assign(known,{
  NO_READY_PRODUCTS:['目前没有可进入确认单的商品','请在清单里查看逐款状态。已有提交或失败回执的商品要先核对原记录，再按提示处理。'],
  UNCHANGED_PLAN_ALREADY_ATTEMPTED:['这份方案已有提交尝试','请先核对原回执，或按清单提示续检。暂时无需重复提交。'],
  PREVIEW_EXPIRED_OR_CHANGED:['提交清单已过期或改变','本次未进入提交。请核对重新整理后的售价和库存，再确认。'],
  OPERATION_RATE_LIMIT:['提交频率达到限制','本次未入队。稍后刷新清单并重新核对。'],
  SKU_ALREADY_SUBMITTED_OR_PENDING:['有商品已有提交任务','请刷新原批次，核对已有任务后再确认其他商品。'],
  GIGA_RETURN_RATE_REVERIFY_REQUIRED:['退货率需要重新核验','请从原批次重新读取该商品的退货率，再确认提交。'],
  GIGA_OPENING_REVERIFY_REQUIRED:['新链接需先以零库存提交','请在原批次继续检查，核对新版零库存清单。开卖前还需核对属性和图片。'],
  BATCH_CONFIRMED_ITEMS_CHANGED:['待提交商品或价格已经改变','本次未入队，请核对重新生成的清单。'],
  BATCH_PREVIEW_REQUIRED:['需要重新生成提交清单','本次未入队，请核对最新清单。']
});
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function friendlyError(value){const raw=String(value?.message||value||''),code=Object.keys(known).find(k=>raw.includes(k))||'REQUEST_FAILED',id=raw.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0];if(value?.outcome==='unknown'||raw.includes('OUTCOME_UNKNOWN'))return {level:'error',title:'操作结果尚未确认',message:'服务器可能已接收这次操作。请先核对原批次或原提交记录，不要重复点击提交或准备。',code,requestId:id,outcome:'unknown'};return {level:'error',title:known[code][0],message:known[code][1],code,requestId:id};}
export function message(target,{level='info',title='',message:text='',code='',requestId=''}={}){const box=el('div',undefined,'feedback feedback--'+level),mark=el('span',level==='error'?'!':level==='success'?'✓':'i','feedback-icon'),body=el('div',undefined,'feedback-body');if(title)body.append(el('strong',title));if(text)body.append(el('p',text));if(code||requestId){const details=el('details'),summary=el('summary','查看排查编号');details.append(summary,el('code',[code,requestId].filter(Boolean).join(' · ')));body.append(details);}box.append(mark,body);target.replaceChildren(box);return box;}
export function notify(data){let region=document.querySelector('#notifications');if(!region){region=el('div',undefined,'notifications');region.id='notifications';region.setAttribute('aria-live','polite');document.body.append(region);}const item=el('div'),box=message(item,data),close=el('button','×','feedback-close');close.setAttribute('aria-label','关闭提示');close.onclick=()=>item.remove();box.append(close);region.append(item);while(region.children.length>3)region.firstElementChild.remove();if(data.level!=='error')setTimeout(()=>item.remove(),5000);}
export function syncStatus(target,{data,offline=false,cacheWarning='',error=null,onSettings,onRetry}={}){target.replaceChildren();target.className='status-line'+(offline&&data?' is-offline':'');target.setAttribute('role','status');const dot=el('span',undefined,'status-dot');target.append(dot);
 if(!data){const auth=String(error?.message||'').includes('DEVICE_UNAUTHORIZED');target.append(el('span',auth?'这台电脑尚未配对':'暂未连接到服务器'));const b=el('button',auth?'前往设置':'重试','status-button');b.onclick=auth?onSettings:onRetry;target.append(b);return;}
 let time='时间待同步';try{time=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(data.operating?.generatedAt||data.sourceAsOf));}catch{}
 target.append(el('span',offline?'离线查看已保存数据':'数据已同步'),el('span','更新于 '+time+'（北京时间）','status-time'));if(cacheWarning)target.append(el('span','离线副本暂未保存','status-time'));if(offline){const b=el('button','重新连接','status-button');b.onclick=onRetry;target.append(b);}target.title='数据来源时间：'+(data.operating?.generatedAt||data.sourceAsOf||'未知');
}
