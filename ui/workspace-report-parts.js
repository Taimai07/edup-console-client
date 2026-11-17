import {ws,el,$,names,inventory,rank,fmt,button} from './workspace-base.js';
import {stat,render} from './workspace-products.js';
const reportTypes=[['sales','销售趋势'],['profit','毛利与成本'],['traffic','流量与转化'],['refunds','退款与发货'],['rank','商品排行'],['finance','财务收支'],['inventory','库存与刊登'],['promotions','促销活动'],['ads','广告表现'],['compliance','合规费用']];
const reportEntries=obj=>Object.entries(obj||{}).filter(([s])=>ws.reportSite==='ALL'||s===ws.reportSite||(ws.reportSite==='GB'&&s==='UK'));
const reportProducts=()=>ws.DATA.products.filter(p=>ws.reportSite==='ALL'||p.site===ws.reportSite);
function reportTabs(v){
const row=el('div',undefined,'report-nav');
for(const [key,label]of reportTypes)row.append(button(label,()=>{
ws.reportType=key;
render();},ws.reportType===key?'active':''));
v.append(row);
const line=el('div',undefined,'report-scope'),select=el('select');
select.setAttribute('aria-label','报表站点');
for(const site of ['ALL',...[...new Set(ws.DATA.products.map(p=>p.site))].sort()]){
const o=el('option',site==='ALL'?'全部站点':names[site]);
o.value=site;
select.append(o);}
select.value=ws.reportSite;
select.onchange=()=>{
ws.reportSite=select.value;
render();};
line.append(select,el('span','每类报表分别保留自身日期与统计口径'));
v.append(line);}
function summaryBlock(v,title,body,actions){
const box=el('section',undefined,'summary'),left=el('div'),right=el('div',undefined,'actions');
left.append(el('span','本报表总结','summary-label'),el('h2',title),el('p',body));
actions.forEach(([label,desc],i)=>{
const row=el('div',undefined,'action'),t=el('div');
t.append(el('strong',label),el('p',desc));
row.append(el('b',String(i+1).padStart(2,'0')),t);
right.append(row);});
box.append(left,right);
v.append(box);}
function metrics(v,items){
const row=el('div',undefined,'stats');
items.forEach(([a,b,c])=>row.append(stat(a,b,c,()=>{})));
v.append(row);}
function dataTable(headers,rows){
const wrap=el('div',undefined,'data-table'),table=el('table'),head=el('tr');
headers.forEach(h=>head.append(el('th',h)));
table.append(head);
for(const row of rows){
const tr=el('tr');
row.forEach(c=>{
const td=el('td');
c instanceof Node?td.append(c):td.textContent=c==null?'—':String(c);
tr.append(td);});
table.append(tr);}
wrap.append(table);
return wrap;}
function panel(title,note){
const p=el('section',undefined,'panel');
p.append(el('h2',title),el('p',note));
return p;}
function bars(title,rows,unit=''){
const p=panel(title,'按当前报表范围统计');
const max=Math.max(1,...rows.map(x=>Math.abs(x.value)));
if(!rows.length)p.append(el('div','当前站点暂无这一类报表','empty'));
for(const r of rows.slice(0,8)){
const row=el('div',undefined,'bar-row'),label=el('div',undefined,'bar-label'),bar=el('div',undefined,'bar'),fill=el('i');
label.append(el('span',r.label),el('strong',fmt(r.value)+unit));
fill.style.width=Math.abs(r.value)/max*100+'%';
if(r.value<0)fill.style.background='#b77768';
bar.append(fill);
row.append(label,bar);
p.append(row);}
return p;}
function lineChart(title,rows,unit,note){
const p=panel(title,note),valid=rows.filter(x=>Number.isFinite(x.value));
if(!valid.length){
p.append(el('div','当前没有可绘制的数据','empty'));
return p;}
const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),W=620,H=240,L=60,R=18,T=20,B=40,lo=Math.min(0,...valid.map(x=>x.value)),hi=Math.max(1,...valid.map(x=>x.value));
svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
svg.classList.add('chart');
const x=i=>L+i*(W-L-R)/Math.max(1,rows.length-1),y=n=>T+(hi-n)/(hi-lo)*(H-T-B),draw=(tag,attrs,text)=>{
const e=document.createElementNS(ns,tag);
for(const [k,val]of Object.entries(attrs))e.setAttribute(k,val);
if(text)e.textContent=text;
svg.append(e);
return e;};
for(let i=0;i<5;i++){
const val=lo+(hi-lo)*i/4,yy=y(val);
draw('line',{x1:L,x2:W-R,y1:yy,y2:yy,stroke:'#e3ebe6'});
draw('text',{x:L-8,y:yy+4,'font-size':10,fill:'#81968b','text-anchor':'end'},fmt(val));}
let d='',connected=false;
rows.forEach((r,i)=>{
if(!Number.isFinite(r.value)){
connected=false;
return;}
d+=(connected?'L':'M')+x(i)+','+y(r.value);
connected=true;
const c=draw('circle',{cx:x(i),cy:y(r.value),r:3,fill:'#438c71'});
const tip=document.createElementNS(ns,'title');
tip.textContent=r.date+' · '+fmt(r.value)+unit;
c.append(tip);
if(i%Math.max(1,Math.ceil(rows.length/6))===0||i===rows.length-1)draw('text',{x:x(i),y:H-10,'font-size':10,fill:'#81968b','text-anchor':'middle'},r.date.includes('T')?r.date.slice(11,16):r.date.slice(5));});
draw('path',{d,fill:'none',stroke:'#438c71','stroke-width':2.5});
p.append(svg);
return p;}
function trafficRows(){
const dates=new Map();
for(const [site,t]of reportEntries(ws.DATA.traffic)){
for(const r of t.daily||[]){
const row=dates.get(r.date)||{date:r.date,sessions:0,units:0,pageViews:0,refundedUnits:0,shippedUnits:0};
for(const key of ['sessions','units','pageViews','refundedUnits','shippedUnits'])row[key]=row[key]===null||r[key]==null?null:row[key]+r[key];
dates.set(r.date,row);}}
return [...dates.values()].sort((a,b)=>a.date.localeCompare(b.date));}
export {reportTypes,reportEntries,reportProducts,reportTabs,summaryBlock,metrics,dataTable,panel,bars,lineChart,trafficRows};
