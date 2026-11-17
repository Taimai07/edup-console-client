import '../common/human-report.js';

import {el} from './analytics.js';
import {message,friendlyError} from '../common/notices.js';
import {businessCall,button,proposalCard} from './operations-core.js';
export {businessCall,publicationExplanation,proposalCard,openMaterialReview,quoteTables} from './operations-core.js';
export {gigaQueries} from './operations-giga.js';

export function productEditor(target,product,{offline=false}={}){target.replaceChildren();const kind=el('select');for(const [value,label] of [['price','常规售价'],['item_name','商品标题'],['bullet_point','五点描述（每行一条）'],['product_description','商品描述'],['generic_keyword','后台搜索关键词']]){const o=el('option',label);o.value=value;kind.append(o);}const input=el('textarea');input.placeholder='填写需要设置的完整值；价格使用站点币种。';const out=el('div'),prepare=button('检查并生成修改预览',async()=>{const operation=kind.value==='price'?'update_price':'update_listing_text',value=kind.value==='price'?input.value.trim():JSON.stringify({field:kind.value,values:kind.value==='bullet_point'?input.value.split('\n').map(x=>x.trim()).filter(Boolean):[input.value.trim()]});const p=await businessCall('proposal_prepare',{action:{target:'amazon',operation,site:product.site,sku:product.sku,value,reason:'用户在商品管理页面手动填写并请求预览'}});out.replaceChildren();proposalCard(out,p);});prepare.disabled=offline;target.append(el('h3',product.site+' · '+product.sku),kind,input,prepare,out,el('p','暂停／恢复销售尚未接通。FBA商品不能用库存设为零代替停售。','muted'));

}

export function preparationReport(target,id,sku,initialSection='status'){target.replaceChildren();const select=el('select'),body=el('pre'),status=el('div'),more=button('继续读取报告',async()=>load(false));let next=0,sha=null;more.hidden=true;

 for(const [value,label] of [['failure','本次错误原因'],['task_log','程序运行日志'],['status','阶段状态'],['required','待确认的必填字段'],['mapping','商品字段与来源'],['semantic','语义和图片复核'],['repair','复核修正记录'],['copy_check','文案机械检查'],['schema','本地字段校验'],['source','商品原始资料'],['usage','模型调用记录'],['preview','亚马逊预检结果']]){const o=el('option',label);o.value=value;select.append(o);}

 async function load(reset){if(reset){next=0;sha=null;body.textContent='';}const r=await businessCall('giga_report',{id,sku,section:select.value,offset:next,expectedSha:sha});if(r.state==='not_ready'){body.textContent=r.content;more.hidden=true;return;}body.textContent+=r.content;sha=r.sha256;next=r.nextOffset;more.hidden=next===null;message(status,{level:'info',title:sku+' · VPS原始阶段报告',message:next===null?'本报告已完整显示。':'内容较长，可继续读取后续部分。'});}

 select.value=initialSection;select.addEventListener('change',()=>load(true).catch(e=>message(status,friendlyError(e))));target.append(el('h3','准备报告 · '+sku),select,status,body,more);load(true).catch(e=>message(status,friendlyError(e)));

}
