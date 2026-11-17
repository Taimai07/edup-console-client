// The operating report: site names, sales / profit totals, series, currency conversion and strategy hints.
// Split out of analytics.js unchanged (client round 3); analytics.js still exports every name.
import {number} from '../common/index.js';
export const names={sales:'总销售额（美元）',units:'售出件数',orders:'订单数',profit:'估算总毛利（美元）',ads:'广告花费',sessions:'访问次数',refunds:'退货／退款'};
export const siteNames={DE:'德国',FR:'法国',US:'美国',GB:'英国',UK:'英国',NL:'荷兰',IT:'意大利',ES:'西班牙',SE:'瑞典',CA:'加拿大',MX:'墨西哥',BR:'巴西',IE:'爱尔兰',SA:'沙特'};
export const bjtDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
export const today=()=>bjtDay(new Date());
export const entries=(d,site)=>Object.entries(d.operating?.sites||{}).filter(([s,v])=>(site==='ALL'||s===site)&&v.state==='ok');
export function usd(amount,currency,fx){if(amount===null||amount===undefined||amount===''||!Number.isFinite(Number(amount)))return null;const n=Number(amount);if(n===0)return 0;const rate=currency==='USD'?1:fx?.toUSD?.[currency];return Number.isFinite(rate)&&rate>0?n*rate:null;}
export function sumUSD(money,fx){let total=0;const missing=[];for(const [c,n]of Object.entries(money)){const v=usd(n,c,fx);if(v===null)missing.push(c);else total+=v;}return {amount:missing.length||!Object.keys(money).length?null:total,missing};}
export const usdText=n=>n===null||n===undefined?'—':'USD '+number(n);
export const fxNote=d=>d.fx?'参考汇率日 '+d.fx.date+' · '+d.fx.source+'；全段趋势使用同一参考汇率，非实际结算金额。':'参考汇率尚未取得，非美元金额暂不汇总。';
export function profitView(d,site){const p=d.operating?.profit;return p?.day===today()?p.views?.[site]||null:null;}
export function totals(d,site){const rows=entries(d,site);if(!rows.length||d.operating.day!==today())return {ready:false,money:{},units:null,orders:null,coverage:0,profitUSD:null};const money={};let units=0,orders=0;
 for(const [,v]of rows){for(const b of v.hourly||[]){units+=b.unitCount;orders+=b.orderCount;const c=b.totalSales.currencyCode;money[c]=(money[c]||0)+Number(b.totalSales.amount);}}
 const sales=sumUSD(money,d.fx),margin=profitView(d,site);return {ready:true,money,units,orders,coverage:margin?.coveredUnits||0,profitUnits:margin?.totalUnits??null,profitNote:margin?.note||'服务器毛利尚未生成',profitBasis:margin?.basis||'',profitMissing:margin?.missing||[],siteCount:rows.length,salesUSD:sales.amount,profitUSD:margin?.profitUSD??null,missingRates:sales.missing};}
export const moneyText=x=>Object.entries(x).map(([c,v])=>`${c} ${number(v)}`).join(' · ')||'—';
export function salesSeries(d,site,key,span){const buckets=new Map();for(const [,v]of entries(d,site)){for(const b of (span==='today'?v.hourly:v.daily)||[]){const start=b.interval.split('--')[0],label=span==='today'?start:start.slice(0,10),currency=key==='sales'?'USD':key==='units'?'件':'单',id=label;const row=buckets.get(id)||{date:label,currency,value:0};const value=key==='sales'?usd(b.totalSales.amount,b.totalSales.currencyCode,d.fx):key==='units'?b.unitCount:b.orderCount;row.value=row.value===null||value===null?null:row.value+value;buckets.set(id,row);}}
 const days=span==='7'?7:span==='30'?30:0,cutoff=days?bjtDay(new Date(new Date(today()+'T00:00:00+08:00').getTime()-(days-1)*864e5)):'';return [...buckets.values()].filter(x=>!cutoff||x.date>=cutoff).sort((a,b)=>a.date.localeCompare(b.date));}
export function profitSeries(d,site,span='today',start='',end=''){
 const current=profitView(d,site);
 if(span==='today'&&!start&&!end)return current?.hourly||[];
 const history=d.operating?.profit?.history;
 const daily=new Map((history?.views?.[site]||[]).map(row=>[row.date,row]));
 const todayKey=today();
 if(current)daily.set(todayKey,{date:todayKey,currency:'USD',value:current.profitUSD,
  coveredUnits:current.coveredUnits,totalUnits:current.totalUnits,complete:current.complete});
 const windowDays=(!start&&!end)&&(span==='7'?7:span==='30'?30:0);
 const cutoff=windowDays?bjtDay(new Date(Date.parse(todayKey+'T00:00:00+08:00')-(windowDays-1)*864e5)):'';
 const available=[...daily.keys()].sort();
 const first=[available[0],start,cutoff].filter(Boolean).sort().at(-1);
 const last=[todayKey,end].filter(Boolean).sort()[0];
 if(!available.length||!first||first>last)return [];
 const rows=[];
 for(let t=Date.parse(first+'T00:00:00Z');t<=Date.parse(last+'T00:00:00Z');t+=864e5){
  const date=new Date(t).toISOString().slice(0,10);
  rows.push(daily.get(date)||{date,currency:'USD',value:null});
 }
 return rows;
}
export function strategies(d,site){const out=[];for(const [s,v]of entries(d,site)){const points=(v.daily||[]).filter(x=>x.interval.slice(0,10)!==today()).slice(-14);if(points.length===14){if(points.reduce((n,x)=>n+x.unitCount,0)<5)continue;const a=points.slice(0,7).reduce((n,x)=>n+Number(x.totalSales.amount),0),b=points.slice(7).reduce((n,x)=>n+Number(x.totalSales.amount),0);out.push({site:s,_change:a>0?(b-a)/a:0,title:a>0?`近7天销售额${b>=a?'上升':'下降'} ${number(Math.abs((b-a)/a*100))}%`:'近7天销售变化',body:`前7天 ${number(a)} → 最近7天 ${number(b)} ${points[0].totalSales.currencyCode}。${b<a?'先区分流量减少、转化下降和活动结束，再调整投放。':'结合库存和毛利验证后再决定扩量。'}`,asOf:v.asOf});}}
 const issues=d.products.filter(p=>(site==='ALL'||p.site===site)&&p.issues.length);if(issues.length)out.push({title:`${issues.length}条商品有刊登提示`,body:'优先核对合规资料能否访问；字段展示受限与整条停售分开处理。',asOf:d.operating?.generatedAt||d.sourceAsOf});
 if(!out.length)return d.insights.filter(i=>site==='ALL'||i.site===site).map(x=>({...x,asOf:x.asOf}));return out.sort((a,b)=>(a._change??0)-(b._change??0)).slice(0,6);}
