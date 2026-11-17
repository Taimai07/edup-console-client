import {productEditor} from './operations/operations.js';
import {nativeBrowserPanel} from './settings/browser-settings.js';
import {ws,el,$,names,issueNames,inventory,rank,ordered,problem,fmt,button,info} from './workspace-base.js';
function showDetail(p){
const d=$('#workspace-detail');
d.replaceChildren(button('关闭',()=>d.close(),'close'),el('div',(names[p.site]||p.site)+' · '+p.asin,'meta'),el('h2',p.sku),el('p',p.name||'暂无商品标题'),el('p','可售库存：'+(p.available??'待核实')+'　保留库存：'+(p.reserved??'待核实')),el('p','平台状态：'+(p.status.join(' / ')||'待核实'),'meta'));
if(!p.issues.length)d.append(el('p','本次快照未返回刊登问题。'));
for(const i of p.issues){
const x=el('details');
x.append(el('summary',(issueNames[i.code]||'刊登提示')+' · '+i.code),el('p',i.message||'请核对平台原始要求'),el('p','级别：'+(i.severity||'未提供'),'meta'));
d.append(x);}
d.append(el('div',undefined,'divider'),el('p','修改会先生成操作预览，核对并确认后才会提交。','meta'));
browserPanel(p);
const edit=el('div');
d.append(button('调价／修改文案',()=>productEditor(edit,p,{offline:ws.context.offline}),'more'),edit);
d.showModal();}
function product(p){
const r=rank(p),b=button('',()=>showDetail(p),'product '+(r<=1?'urgent':r<=3?'watch':'')),top=el('div',undefined,'card-top'),[label,tone]=info(p);
top.append(el('span',label,'badge '+tone),el('span',p.available===0?'暂无可售库存':p.available==null?'库存待核实':'可售 '+fmt(p.available),'stock'));
b.append(top,el('strong',p.sku,'sku'),el('p',p.name||p.asin,'name'),el('div',p.issues.length?(issueNames[p.issues.find(x=>issueTags.has(String(x.code)))?.code||p.issues.find(x=>x.severity==='ERROR')?.code||p.issues[0].code]||'刊登资料待核对')+(p.issues.length>1?' · '+p.issues.length+'项':''):r===2?'核对购买状态':r===4?'关注补货时间':'暂无待处理事项','issue '+(r>3?'good':'')));
return b;}
function stat(label,value,note,fn,cls=''){
const n=button('',fn,'stat '+cls);
n.append(el('label',label),el('strong',value),el('small',note));
return n;}
function render(){
if(ws.view!==ws.context.mode)ws.context.navigate(ws.view);else ws.context.redraw();}
function products(v){
const ps=ws.DATA.products,a=ps.filter(x=>inventory(x)==='active'),z=ps.filter(x=>inventory(x)==='zero'),u=ps.filter(x=>inventory(x)==='unknown'),problems=ps.filter(problem);
const stats=el('div',undefined,'stats');
stats.append(stat('有可售库存',fmt(a.length),'条商品链接',()=>{
ws.bucket='active';
ws.focus=null;
render();},ws.bucket==='active'?'selected':''),stat('优先与待处理',fmt(problems.length),'含收纳区中的 '+z.filter(problem).length+' 条',()=>{
ws.onlyIssues=true;
render();},'alert'),stat('零库存已收纳',fmt(z.length),'单独管理，随时可展开',()=>{
ws.bucket='zero';
ws.focus=null;
render();},ws.bucket==='zero'?'selected':''),stat('库存待核实',fmt(u.length),'未返回库存，不作为缺货',()=>{
ws.bucket='unknown';
ws.focus=null;
render();},ws.bucket==='unknown'?'selected':''));
v.append(stats);
const tools=el('div',undefined,'controls'),tabs=el('div',undefined,'tabs');
for(const [k,l]of [['active','有库存商品'],['zero','零库存收纳'],['unknown','库存待核实']])tabs.append(button(l,()=>{
ws.bucket=k;
ws.page=0;
render();},ws.bucket===k?'active':''));
const check=el('label',undefined,'check'),input=el('input');
input.type='checkbox';
input.checked=ws.onlyIssues;
input.onchange=()=>{
ws.onlyIssues=input.checked;
ws.page=0;
render();};
check.append(input,document.createTextNode('只看待处理'));
const search=el('input',undefined,'search');
search.placeholder='搜索 SKU / ASIN / 商品名称';
search.value=ws.query;
search.onchange=()=>{
ws.query=search.value;
ws.page=0;
render();};
search.onkeydown=e=>{
if(e.key==='Enter')search.blur();};
tools.append(tabs,check,search);
v.append(tools);
tagControls(v);
const filtered=ordered(ps.filter(p=>tagsMatch(p)&&inventory(p)===ws.bucket&&(!ws.onlyIssues||problem(p))&&(!ws.query||(p.sku+' '+p.asin+' '+p.name).toLowerCase().includes(ws.query.toLowerCase()))));
const countries=[...new Set(ps.map(x=>x.site))];
const line=el('div',undefined,'section-line');
line.append(el('h2',ws.focus?'地区商品':'按地区查看'),el('span','平台限制 → 刊登错误 → 待核实 / 待完善 → 普通商品'));
v.append(line);
if(ws.focus){
v.append(button('← 返回地区总览',()=>{
ws.focus=null;
ws.page=0;
render();},'more'));
const rows=filtered.filter(p=>p.site===ws.focus),grid=el('div',undefined,'focus-cards');
grid.style.marginTop='18px';
for(const p of rows.slice(ws.page*12,ws.page*12+12))grid.append(product(p));
if(!rows.length)grid.append(el('div','当前条件下没有商品','empty'));
v.append(grid);
const pager=el('div',undefined,'pagination'),prev=button('上一页',()=>{
ws.page--;
render();},'more'),next=button('下一页',()=>{
ws.page++;
render();},'more');
prev.disabled=ws.page===0;
next.disabled=(ws.page+1)*12>=rows.length;
pager.append(prev,el('span',(ws.page+1)+' / '+Math.max(1,Math.ceil(rows.length/12))+' 页 · 共 '+rows.length+' 条'),next);
v.append(pager);
return;}
const primary=['DE','US','FR','GB'].filter(s=>countries.includes(s)),grid=el('div',undefined,'market-grid');
for(const s of primary){
const rows=filtered.filter(x=>x.site===s),all=ps.filter(x=>x.site===s),box=el('section',undefined,'market'),head=el('div',undefined,'market-head'),title=el('div');
title.append(el('h3',names[s]),el('p',rows.length+' 条当前分类 · '+rows.filter(problem).length+' 条待处理'));
head.append(el('div',s,'country'),title,button('查看全部 →',()=>{
ws.focus=s;
ws.page=0;
render();}));
const cards=el('div',undefined,'cards');
for(const p of rows.slice(0,4))cards.append(product(p));
if(!rows.length)cards.append(el('div','这个分类下暂无商品','empty'));
box.append(head,cards);
grid.append(box);}
v.append(grid);
const chips=el('div',undefined,'market-chips');
for(const s of countries.filter(x=>!primary.includes(x)))chips.append(button((names[s]||s)+' · '+filtered.filter(p=>p.site===s).length,()=>{
ws.focus=s;
ws.page=0;
render();}));
v.append(chips,el('p','地区总览每区最多展示4条，进入地区后每页12条。零库存链接仅在此视图收纳，不下架、不删除；同一ASIN在不同站点分别展示。','footnote'));}
const issueTags=new Set(),browserBindings={};
function tagsMatch(p){
return !issueTags.size||p.issues.some(i=>issueTags.has(String(i.code)));}
function tagControls(parent){
const box=el('section',undefined,'tag-filter'),head=el('div',undefined,'tag-heading');
head.append(el('strong','问题标签'),el('span',issueTags.size?'匹配任一已选标签':'可多选，按报错类型筛选'));
const counts=new Map();
for(const p of ws.DATA.products.filter(p=>inventory(p)===ws.bucket&&(!ws.focus||p.site===ws.focus))){
for(const code of new Set(p.issues.map(i=>String(i.code))))counts.set(code,(counts.get(code)||0)+1);}
const chips=el('div',undefined,'tag-chips'),orderedTags=[...counts].sort((a,b)=>b[1]-a[1]),shown=[...new Set([...issueTags,...orderedTags.slice(0,7).map(x=>x[0])])];
for(const code of shown)chips.append(button((issueNames[code]||'刊登提示')+' · '+code+'  '+(counts.get(code)||0),()=>{
issueTags.has(code)?issueTags.delete(code):issueTags.add(code);
ws.page=0;
render();},'filter-tag'+(issueTags.has(code)?' chosen':'')));
const select=el('select');
select.setAttribute('aria-label','全部报错类型');
select.append(el('option','更多报错类型…'));
for(const [code,n]of orderedTags){
const o=el('option',(issueNames[code]||'刊登提示')+' · '+code+' ('+n+')');
o.value=code;
select.append(o);}
select.onchange=()=>{
if(select.selectedIndex){
issueTags.add(select.value);
ws.page=0;
render();}};
chips.append(select);
if(issueTags.size)chips.append(button('清除标签',()=>{
issueTags.clear();
render();},'tag-clear'));
box.append(head,chips);
parent.append(box);}
const sellerHosts={DE:'sellercentral.amazon.de',FR:'sellercentral.amazon.fr',US:'sellercentral.amazon.com',GB:'sellercentral.amazon.co.uk',NL:'sellercentral.amazon.nl',IT:'sellercentral.amazon.it',ES:'sellercentral.amazon.es',BE:'sellercentral.amazon.com.be',PL:'sellercentral.amazon.pl',SE:'sellercentral.amazon.se',IE:'sellercentral.amazon.ie',CA:'sellercentral.amazon.ca',MX:'sellercentral.amazon.com.mx',BR:'sellercentral.amazon.com.br',SA:'sellercentral.amazon.sa'};
function sellerTarget(p){
if(!sellerHosts[p.site])return null;
const u=new URL('https://'+sellerHosts[p.site]+'/myinventory/inventory');
u.searchParams.set('searchField','all');
u.searchParams.set('searchTerm',p.sku);
return u.href;}
function browserPanel(p){
nativeBrowserPanel(document.querySelector('#workspace-detail'),p,ws.context);}
export {showDetail,product,stat,render,products};
