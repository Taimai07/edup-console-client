import {ws,issueNames} from './workspace-base.js';
import {products} from './workspace-products.js';
import {reports} from './workspace-reports.js';
export function renderWorkspace(target,options){
ws.context=options;
ws.view=options.mode;
const d=options.data;
ws.DATA={asOf:d.operating?.generatedAt||d.sourceAsOf||d.generatedAt||'',day:d.operating?.day||'',products:d.products||[],sites:d.operating?.sites||{},profit:d.operating?.profit||{},fx:d.fx||{date:'暂缺',toUSD:{}},traffic:d.operating?.traffic||{},historical:{...(d.reports||{}),sku:d.reports?.sku||{},promotions:d.reports?.promotions||{asOf:'暂缺',sites:{}},compliance:d.compliance||{items:[]}}};
 for(const p of ws.DATA.products)for(const i of p.issues||[])if(i.title&&!issueNames[i.code])issueNames[i.code]=i.title;
 let dialog=document.querySelector('#workspace-detail');
if(!dialog){
dialog=document.createElement('dialog');
dialog.id='workspace-detail';
dialog.className='workspace-v2';
document.body.append(dialog);
dialog.addEventListener('click',e=>{
if(e.target===dialog)dialog.close();});}
 target.classList.add('workspace-v2');
if(ws.view==='products')products(target);else reports(target);
}
