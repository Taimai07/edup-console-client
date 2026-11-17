import {ws,el,$,names,rank,fmt,money,button,info} from './workspace-base.js';
import {products,stat,render} from './workspace-products.js';
import {reportProducts} from './workspace-report-parts.js';
function series(){
const map=new Map();
for(const [site,s]of Object.entries(ws.DATA.sites)){
if(s.state!=='ok'||ws.reportSite!=='ALL'&&site!==ws.reportSite)continue;
for(const r of s.daily||[]){
const day=r.interval.slice(0,10);
if(day>=ws.DATA.day)continue;
const cur=r.totalSales?.currencyCode,rate=cur==='USD'?1:ws.DATA.fx.toUSD[cur];
if(!Number.isFinite(rate))continue;
const prev=map.get(day)||{date:day,value:0,units:0};
prev.value+=Number(r.totalSales.amount)*rate;
prev.units+=r.unitCount;
map.set(day,prev);}}
return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));}
function salesReport(v){
const rows=series(),last=rows.slice(-7),before=rows.slice(-14,-7),total=last.reduce((a,r)=>a+r.value,0),old=before.reduce((a,r)=>a+r.value,0),units=last.reduce((a,r)=>a+r.units,0),delta=old?(total-old)/old*100:null,errors=reportProducts().filter(p=>rank(p)<=1).length,zero=reportProducts().filter(p=>p.available===0).length;
const stats=el('div',undefined,'stats');
stats.append(stat('近7个完整日销售额',money(total),last[0]?.date+' — '+last.at(-1)?.date,()=>{}),stat('较前7日',delta==null?'暂缺':(delta>=0?'+':'')+fmt(delta)+'%','按同一参考汇率折算美元',()=>{}),stat('售出件数',fmt(units),'商品件数，不是订单数',()=>{}),stat('广告数据','待接入','不能据此判断广告投入回报',()=>{}));
v.append(stats);
const summary=el('section',undefined,'summary'),left=el('div'),right=el('div',undefined,'actions');
left.append(el('span','经营总结','summary-label'),el('h2',delta==null?'先处理刊登问题，补齐经营依据':delta<0?'销售回落，先核查流量与购买条件':'销售增长，扩量前先核对利润与库存'),el('p','本期已统计销售额 '+money(total)+'，售出 '+fmt(units)+' 件。'+(delta==null?'':('较前7日'+(delta<0?'下降':'增长')+' '+fmt(Math.abs(delta))+'%。'))+'这一变化说明成交结果，尚不能单独确定原因。'),el('p','商品快照中有 '+errors+' 条链接需要优先核对，'+zero+' 条零库存链接已单独收纳。'));
for(const [n,title,body]of [['01','优先处理刊登问题','先看平台限制和ERROR，再看资料完善；字段提示不直接等于整条停售。'],['02','分地区核查销售变化','结合访问量、转化和活动起止判断原因；零库存单独复查补货计划。'],['03','补齐利润与广告依据','今日估算毛利不能当成近7日净利润；广告、退款和部分成本仍需补齐。']]){
const a=el('div',undefined,'action'),t=el('div');
t.append(el('strong',title),el('p',body));
a.append(el('b',n),t);
right.append(a);}
summary.append(left,right);
v.append(summary);
const grid=el('div',undefined,'report-grid'),trend=el('section',undefined,'panel');
trend.append(el('h2','销售额趋势 · USD'),el('p','最近14个完整日 · 鼠标悬停查看日期与金额'));
const points=rows.slice(-14),W=650,H=240,L=52,T=18,R=20,B=37,max=Math.max(1,...points.map(x=>x.value)),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
svg.classList.add('chart');
function draw(tag,attrs,text){
const e=document.createElementNS(svg.namespaceURI,tag);
for(const [k,val]of Object.entries(attrs))e.setAttribute(k,val);
if(text)e.textContent=text;
svg.append(e);
return e;}
for(let i=0;i<5;i++){
const y=T+i*(H-T-B)/4;
draw('line',{x1:L,x2:W-R,y1:y,y2:y,stroke:'#e4ebe6'});
draw('text',{x:L-9,y:y+4,fill:'#8b9e8f','font-size':10,'text-anchor':'end'},fmt(max*(4-i)/4));}
const x=i=>L+i*(W-L-R)/Math.max(1,points.length-1),y=value=>T+(1-value/max)*(H-T-B);
draw('path',{d:points.map((p,i)=>(i?'L':'M')+x(i)+','+y(p.value)).join(' '),fill:'none',stroke:'#3e9273','stroke-width':2.5});
for(let i=0;i<points.length;i++){
const c=draw('circle',{cx:x(i),cy:y(points[i].value),r:3,fill:'#3e9273'}),title=document.createElementNS(svg.namespaceURI,'title');
title.textContent=points[i].date+' '+money(points[i].value);
c.append(title);
if(i%3===0||i===points.length-1)draw('text',{x:x(i),y:H-10,fill:'#8b9e8f','font-size':10,'text-anchor':'middle'},points[i].date.slice(5));}
trend.append(svg);
const markets=el('section',undefined,'panel');
markets.append(el('h2','主要站点贡献'),el('p','同一7日区间 · 销售额美元折算'));
const values=[];
for(const [s,d]of Object.entries(ws.DATA.sites)){
if(ws.reportSite!=='ALL'&&s!==ws.reportSite)continue;
let amount=0;
for(const p of d.daily||[]){
if(!last.some(x=>x.date===p.interval.slice(0,10)))continue;
const c=p.totalSales.currencyCode,rate=c==='USD'?1:ws.DATA.fx.toUSD[c];
if(rate)amount+=Number(p.totalSales.amount)*rate;}
if(amount>0)values.push({site:s,value:amount});}
values.sort((a,b)=>b.value-a.value);
for(const r of values.slice(0,5)){
const row=el('div',undefined,'bar-row'),label=el('div',undefined,'bar-label'),bar=el('div',undefined,'bar'),fill=el('i');
label.append(el('span',names[r.site]||r.site),el('strong',money(r.value)));
fill.style.width=(r.value/values[0].value*100)+'%';
bar.append(fill);
row.append(label,bar);
markets.append(row);}
grid.append(trend,markets);
v.append(grid,el('div','统计口径：完整自然日销售按北京时间归集，采用 '+ws.DATA.fx.date+' 参考汇率；利润、平台流量报表、广告分别保留自身时间口径。此页总结由快照规则计算，用于界面预览。','info-strip'),button('查看优先商品 →',()=>{
ws.view='products';
ws.onlyIssues=true;
ws.bucket='active';
ws.focus=null;
render();},'more'));}
export {salesReport};
