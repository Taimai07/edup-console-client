import {el} from './analytics.js';
const active=new Set(['starting','queued','running']);
export function issueDetails(item={}){
 const code=item.reason||item.failure?.code||'',details=item.failure?.details||{},attention=item.attention||[],out=[];let matched=false;
 const add=(key,title,why,next,needsInput)=>{matched=true;if(!out.some(x=>x.key===key))out.push({key,title,why,next,needsInput});};
 if(details.reason==='plan_usage_paused')add('service','模型服务暂停，本步骤未执行',details.upstreamDispatched===false?'调用服务返回暂停状态；回执确认这次请求没有发给上游模型。':'调用服务返回暂停状态，尚未取得可用结果；结果不明时不会自动重复请求。','这是服务侧事项，不需要补商品资料。服务恢复后点击“继续检查本批”。',false);
 const imageCodes=['IMAGE_SOURCE_SIZE'];
 if(imageCodes.includes(code))add('image-transfer','图片处理未完成','供应商原图触发程序的大小或编码保护；这不是平台已禁止上架。','由后台保留原图并生成符合要求的发布副本；无需重新提供编码或已有原图。',false);
 if(['IMAGE_SOURCE_RESOURCE_LIMIT','IMAGE_PUBLICATION_ENCODING_REQUIRED','IMAGE_COLOR_PROFILE_REVIEW_REQUIRED'].includes(code))add('image-maintenance','这张图片暂时无法自动处理','原图超出当前处理资源或自动编码/色彩转换未通过；原始资料会保留。','需要维护者核对原图与处理日志，不能靠重复续检解决；无需补商品事实。',false);
 if(['IMAGE_SOURCE_TIMEOUT','IMAGE_SOURCE_UNAVAILABLE','IMAGE_SOURCE_EMPTY','IMAGE_SOURCE_INCOMPLETE'].includes(code))add('image-network','读取供应商图片失败','图片服务器响应超时、暂不可达或返回空内容，尚未取得完整图片。','保留本批结果，连接恢复后只继续未完成步骤，不重新提供商品事实。',false);
 if(['DOCUMENT_PAGE_STILL_UNREADABLE','DOCUMENT_MODEL_CONTRACT_INVALID','DOCUMENT_MODEL_QUOTE_INVALID'].includes(code))add('document-model','说明书已交模型处理，仍需核对','备用读取未获得可确认的完整结果，原件、错误和调用回执均保留。','维护者核对具体页码和回执后处理；不重复上传或盲目重发同一模型请求。',false);
 if(code==='DOCUMENT_SIZE')add('document-size','说明书下载大小检查未通过','这是程序读取设置或下载完整性问题，不是亚马逊已拒绝该商品。','在原批次继续检查，由新程序流式处理原件并按页读取，不需要重传已有资料。',false);
 if(['DOCUMENT_TEXT_REVIEW_REQUIRED','DOCUMENT_OCR_REVIEW_REQUIRED','DOCUMENT_VISUAL_REVIEW_REQUIRED','DOCUMENT_NATIVE_PARSE_FAILED'].includes(code))add('document-reader','说明书的文字或图形页尚未完成读取','原件可能是图片型、矢量绘图，或文字解析器不兼容；不等于资料不存在。','继续检查时由程序读取原件，必要时转GPT分页识别并保留不确定区域与回执。',false);
 if(['DOCUMENT_SOURCE_UNAVAILABLE','DOCUMENT_DOWNLOAD_TIMEOUT','DOCUMENT_SOURCE_INCOMPLETE','DOCUMENT_SOURCE_EMPTY'].includes(code))add('document-download','读取供应商说明书失败','说明书下载未完成，已有错误和兼容性记录会保留。','先核对供应商文件可用性及后台诊断；不需要补商品事实，也不重复发起未知结果的模型请求。',false);
 if(code==='FACT_SOURCE_REF_INVALID'||code==='DOCUMENT_REF_INVALID')add('reference','模型引用的资料位置无法核对','引用路径没有对应到可验证的原始字段或具体文档页；这是来源解析问题。','维护者核对已保存模型结果与原件，修复引用兼容性；无需重新输入编码或重复上传。',false);
 if(code==='DOCUMENT_CLAIMS_NEED_REVIEW')add('document-claims','说明书引用的事实仍需复核','已对照原页，但当前声明仍有无法确认或不一致之处。','先修正有问题的声明；无法辨认的内容不能猜成商品事实，已有原件和回执保留。',false);
 if(code==='PLANNER_INPUT_INVALID'||code==='PLANNER_REQUEST_BODY_TOO_LARGE')add('request-size','模型请求尚未发送','程序生成的请求格式或大小未通过本地校验，本次没有发给模型。','维护者调整分段或上下文整理；无需补商品事实，也不把这次当成未知付费调用重试。',false);
 if(code==='DOCUMENT_TEXT_TIMEOUT')add('document-timeout','说明书解析超时','已保存的说明书未在时限内完成解析，不能当作商品缺少资料。','由后台核对已保存文件和解析日志后继续；不要求你重复上传已有资料。',false);
 if(code==='TimeoutExpired')add('process-timeout','准备子程序执行超时','原记录只确认子程序超时，没有记录足以核实的具体原因。','由后台核对该步骤的原始日志和调用回执；不要求补商品事实，也不盲目重发模型请求。',false);
 for(const [index,row] of attention.entries()){matched=false;const field=typeof row==='object'?row.field||row.id||'':'',text=typeof row==='string'?row:row.reason||field;
  if(field==='country_of_origin'||/country.of.origin|manufacturing country/i.test(text))add('origin','制造国家尚未核实','当前准备报告没有找到可用的制造国家，不能用仓库或卖家所在国家代替。','填写制造国家，并注明供应商说明、铭牌或其他依据。',true);
  if(field==='fabric_type'||/fabric.type|fabric composition/i.test(text))add('fabric','平台要求的“面料信息”尚未处理','商品是镜柜时，这可能是类目字段适用值的问题；当前报告尚未核实。','先由程序核对该字段及“不适用”等实际允许值，不需要你编造面料成分。',false);
  if(/power|electrical|voltage|frequency|batter|电池|供电/i.test(text))add('power','供电方式或电池情况尚未核实','当前证据不足以完成供电、电池范围或相关字段判断；这不等于已认定商品属于危险品。','补充插电、硬接线或电池供电方式；若使用电池，说明类型及是否随附，并附说明书或铭牌依据。',true);
  if(field==='item_depth_width_height'||field==='item_dimensions')add('dimensions','商品尺寸或测量范围尚未核实','当前报告需要区分商品、包装、单个组件或整套尺寸。','说明各尺寸测量的对象和单位，或提供对应尺寸图。',true);
  if(/crop|whitespace|white.background|主图|图片裁切/i.test(text))add('image','商品图片需要处理或重新复核','原报告指出主图、裁切或背景方面的问题。','先处理已有商品素材并复核，不需要你重新输入编码或重复提供已有原图。',false);
  const names={material:'材质',color:'颜色',assembly_required:'是否需要组装',batteries_included:'是否随附电池',included_components:'随附配件'};
  if(!matched&&names[field])add(field,names[field]+'尚未核实','当前报告未找到可确认的这项商品信息。','在本商品入口补充“'+names[field]+'”及说明书、供应商说明或实物依据。',true);
  if(!matched)add('unmapped-'+index,'有一项问题尚未说明清楚','当前报告没有给出可直接操作的中文缺项说明。','先让本批助手解释具体缺项及依据；不需要你猜测或重交全部资料。',false);
 }
 if(code==='DG_REVIEW_REQUIRED'&&!out.some(x=>x.key==='power'))add('dg','危险品声明依据尚未核实','当前记录尚未说明具体哪项依据不足；这不等于认定商品属于危险品。','先由本批助手读取原报告列出具体问题，不需要你猜着补资料。',false);
 if(code==='DG_BATTERY_UNKNOWN_OR_PRESENT')add('lithium','锂电池情况尚未核实','供应商锂电字段为空、无法识别或表明含锂电，当前流程不能据此生成“不适用”声明。','提供准确电池信息及依据；可确认的空白事实通过本商品入口保存，有矛盾时先核对原资料。',true);
 if(code==='CONFIRMED_SUPPLIER_FACT_CONFLICT')add('conflict','已确认资料与供应商原文冲突','系统保留双方依据，没有擅自覆盖其中一方。','核对冲突原文与证据，再确认准确的商品事实。',true);
 if(['PRODUCT_TYPE_SELECTION_NEEDS_REVIEW','PRODUCT_TYPE_NOT_IN_AMAZON_RESULTS','AMAZON_PRODUCT_TYPE_NO_MATCH'].includes(code))add('taxonomy','商品类目尚未完成核对','当前商品与亚马逊候选类目尚未匹配，不是平台已经禁止上架。','先由程序核对已有资料与真实候选；如确需商品事实，会明确列出，不要求你猜类目名称。',false);
 if(code==='SEMANTIC_REVIEW_REJECTED'&&!out.length)add('review','图片、文案或字段复核未通过','现有准备结果还有未解决的复核意见，尚未达到提交条件。','先由程序结合原资料修正；确需额外事实时会逐项说明。',false);
 if(['PLANNER_CONTRACT_INVALID','PLANNER_JSON_INVALID_SEE_CACHE'].includes(code))add('format','模型返回格式不正确','这不是商品资料缺失；原响应与调用回执已保留。','由维护者检查缓存响应和解析，不会自动重复付费请求。',false);
 if(code==='CATEGORY_MAPPING_REQUIRED')add('category','旧任务停在类目匹配','这是旧版准备程序留下的失败记录，不能据此认定亚马逊禁止该类商品。','点击“继续检查本批”，按当前程序重新核对类目，保留仍有效的结果。',false);
 if(!out.length&&attention.length)add('facts','报告中有资料需要核实','具体依据保留在下方详情，尚未自动改写商品事实。','查看详细依据，再用“核对并补充”提供确认内容。',true);
 return out;
}
export function continuation(job){const items=job?.result?.pipeline?.items||[],blocked=new Set([...items.filter(x=>['ALREADY_SUBMITTED','PUBLICATION_PENDING'].includes(x.state)).map(x=>x.sku),...(job?.submissions||[]).flatMap(x=>x.items||[]).filter(x=>['queued','checking','submitting','accepted','verified','needs_reconciliation'].includes(x.state)).map(x=>x.sku)]);return {rootId:job?.rootJobId||job?.id,codes:[...new Set([...(job?.codes||[]),...(job?.result?.products||[]).map(x=>x.code)])].filter(x=>!blocked.has(x)),running:active.has(job?.state)};}
const phaseNames={DOCUMENT_READING:'读取商品说明书',DOCUMENT_MODEL_READING:'GPT正在识别说明书页面',document:'GPT正在识别说明书页面',document_context:'整理说明书证据',document_review:'核对说明书引用',copy:'GPT正在生成商品文案',PRODUCT_TYPE_DISCOVERY:'查询商品类目',facts:'核对商品事实和图片',field_selection:'选择商品字段',attributes:'整理类目字段',required_fields:'检查必填字段',review:'复核图片与文案',repair:'修正复核问题',FACTS_PREPARING:'核对商品事实和图片',FIELDS_PREPARING:'整理类目字段',COPY_GENERATING:'生成商品文案',SEMANTIC_REVIEW:'复核图片与文案',PREPARING:'准备上架资料'};
export function itemIssue(item={},mode='ai_workflow'){const problems=issueDetails(item),code=item.reason||item.failure?.code||'',stage=phaseNames[item.failure?.stage||item.failedStage]||'AI准备',attention=(item.attention||[]).map(x=>typeof x==='string'?x:x.field==='batteries_included'?'是否随附电池尚未确认':x.field||'商品事实待确认');
 if(item.state==='ALREADY_SUBMITTED')return {level:'info',title:item.publication?.result?.platformReviewPending?'已提交，等待亚马逊审核':'已提交亚马逊',reason:'已有正式提交记录。旧准备报告保留，不代表需要重新上架。',next:'查看亚马逊审核、图片及目录结果；不要重新创建。',ready:false,needsInput:false,submitted:true};
 if(item.state==='PUBLICATION_PENDING')return {level:'info',title:'已有提交任务，等待核对',reason:'已有排队、处理或待核对记录，暂不接受重复提交。',next:'等待原任务完成或核对原提交结果。',ready:false,needsInput:false,submitted:true};
 if(item.latestAttempt)return {level:'error',title:'原准备结果已保留，本次续检未完成',reason:'最近一次继续检查失败或中断，没有抹掉原资料与已通过步骤。',next:'服务恢复或问题处理后，直接在原批次继续检查；本次未提交，不需要重输编码。',ready:false,needsInput:false,owner:'继续核对'};
 if(item.state==='PREVIEW_VALID')return {level:'success',title:'准备和预检已通过',next:'点击「提交到亚马逊」，核对价格与库存后确认。',ready:true,needsInput:false};
 if(['PREPARATION_EXCEPTION','EXCEPTION'].includes(item.state)||/^(PLANNER_|MODEL_|INFERENCE_)/.test(code)){if(problems.length)return {level:'error',title:problems.map(x=>x.title).join('；'),reason:problems.map(x=>x.why).join(' '),next:problems.map(x=>x.next).join(' '),problems,code,ready:false,needsInput:problems.some(x=>x.needsInput),owner:problems.some(x=>x.needsInput)?'有资料需要确认':'程序侧核对'};let reason='准备程序发生异常，未完成后续检查。',next='这是程序侧问题，不需要补商品资料。维护核对并修复后重新准备。';if(/UNCERTAIN|CHECK_PENDING/.test(code))reason='上次模型请求没有得到确认结果，程序已停止继续上架。';if(code==='PLANNER_REQUEST_REJECTED')reason='模型接口拒绝了请求，准备没有完成。';if(/BUDGET|DAILY_CALL_CAP/.test(code)){reason='该次请求触发调用次数保护上限，没有完成准备。';next='额度恢复后重新准备；不需要补商品资料。';}return {level:'error',title:stage+'失败',reason,next,problems,code,ready:false,needsInput:false,owner:'程序侧处理'};}
 if(mode!=='ai_workflow'&&['NEEDS_INPUT','MODEL_EXECUTION_DISABLED','COPY_READY_REVIEW_REQUIRED'].includes(item.state))return {level:'info',title:'等待AI准备',reason:'商品资料已经读取，尚未经过AI整理和检查。',next:'点击「AI准备并检查上架」。',ready:false,needsInput:false};
 if(item.state==='PREVIEW_REJECTED')return {level:'error',title:'亚马逊预检未通过',reason:'平台检查发现问题，尚未正式提交。',next:'先处理平台反馈，再重新预检。',code,ready:false,needsInput:false,owner:'需核对平台反馈'};
 if(item.state==='NEEDS_SOURCE_REVIEW'){if(problems.length)return {level:'info',title:problems.map(x=>x.title).join('；'),reason:problems.map(x=>x.why).join(' '),next:'按下方逐项说明处理后，在原批次继续检查。',problems,code,ready:false,needsInput:problems.some(x=>x.needsInput),owner:problems.some(x=>x.needsInput)?'有资料需要确认':'程序侧核对'};const image=/crop|whitespace|main.image|主图/i.test(attention.join(' '));return {level:image?'error':'info',title:image?'商品主图复核未通过':'报告尚未列明具体缺项',reason:image?'主图需要修正后重新复核。':attention.length?attention.join('；'):'当前报告没有明确指出可补充的具体事实。',next:image?'这是图片处理事项；现有素材能处理的由程序侧修正，不要求你重复提供已有资料。':'先由本批助手读取原报告说明具体问题，不需要你猜测补资料。',code,ready:false,needsInput:false,owner:image?'需处理商品图片':'报告需完善'};}
 if(['PREVIEW_VALID_DRAFT_STOCK_HOLD','PREPARED_OUT_OF_STOCK'].includes(item.state))return {level:'info',title:'当前库存或刊登方式需要重新核对',next:'在原批次继续检查；新建FBM缺货可按库存0准备，已有链接修改按真实操作范围核对。',ready:false,needsInput:false};
 if(item.state==='COLOR_FAMILY_REVIEW_REQUIRED')return {level:'info',title:'同款颜色关系待核对',next:'先核对父子变体关系，避免重复建立同款链接。',ready:false,needsInput:false};
 return {level:'info',title:phaseNames[item.state]||'尚未完成准备',next:'等待程序完成；若任务已经停止，请查看本批次说明。',code,ready:false,needsInput:false};}
export function describeProgress(job){const items=job.result?.pipeline?.items||[],mode=job.preparationMode||job.result?.preparationMode,ai=mode==='ai_workflow',running=active.has(job.state),issues=items.map(x=>itemIssue(x,mode)),errors=issues.filter(x=>x.level==='error'),ready=issues.filter(x=>x.ready).length,submitted=issues.filter(x=>x.submitted).length;let title,next,owner='',level='info';
 if(job.state==='connection_lost'){title='暂时无法确认服务器进度';next='连接已中断，服务器可能仍在处理。请先恢复连接或刷新历史批次，不要重复提交。';level='error';}
 else if(running){title=job.state==='starting'?'正在发送准备请求':job.state==='queued'?'任务已排队':phaseNames[items.find(x=>phaseNames[x.state])?.state]|| (ai?'AI正在准备上架资料':'正在读取详情、报价和库存');next='程序正在处理，结果会自动更新；暂不能提交。';owner='处理中';}
 else if(['failed','interrupted'].includes(job.state)){title='本次处理失败，尚未提交';next='程序执行出现异常，需核对服务器记录；不需要你补商品资料。';level='error';}
 else if(errors.length){title=items.length===1?errors[0].title:errors.length+'款准备失败';next=items.length===1?(errors[0].reason+' '+errors[0].next):'失败原因见下面对应商品的红框。已经通过的商品可以单独核对提交。';owner=errors[0].owner;level='error';}
 else if(submitted){title=submitted+'款已有提交记录'+(ready?'，'+ready+'款可提交':items.length>submitted?'，其余仍有待办':'');next='已提交商品按原回执继续核对；其余商品的真实待办见下方，不重复创建已提交商品。';}
 else if(!ai&&!ready){title='资料读取完成，等待AI准备';next='要上架，请点击上方「AI准备并检查上架」；只查询价格和库存则已完成。';owner='下一步由你选择';}
 else if(ready===items.length&&ready){title='准备和预检已通过，可以提交';next='点击商品旁的「提交到亚马逊」，核对价格与库存，再确认提交。当前还没有正式上架。';level='success';}
 else{title=ready?ready+'款可提交，其余仍有待办':'准备尚未通过，暂不能提交';next='下面逐款说明原因和下一步。只有明确缺少商品事实时才需要你补资料。';}
 return {title,next,owner,level,running,ai,items,issues,ready,submitted,total:items.length};}
export function renderProgress(target,job){const d=describeProgress(job);target.replaceChildren();target.className='batch-progress'+(d.level==='error'?' is-error':'');target.setAttribute('role',d.level==='error'?'alert':'status');const h=el('div',undefined,'batch-progress-heading');if(d.running)h.append(el('span',undefined,'batch-spinner'));h.append(el('h3',d.title));if(d.owner)h.append(el('span',d.owner,'batch-owner'));target.append(h,el('p',d.next));if(job.created)target.append(el('p','任务开始：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date(job.created*1000))+'（北京时间）','muted'));if(d.total&&d.ai)target.append(el('p','本批 '+d.total+' 款 · 已有提交 '+d.submitted+' 款 · 可提交 '+d.ready+' 款；未通过的不会被提交。','muted'));}
