import {renderMaintenance} from './maintenance.js';
import {el,card,number,table,names,siteNames,today,totals,moneyText,usdText,fxNote,salesSeries,profitSeries,chart,strategies} from './analytics.js';
const tabs=['经营总览','商品管理','经营报表','云仓上架','广告分析','同步与维护'];
let data=null,current=0,site='ALL',offline=false,cacheWarning='',detail=null,span='30',from='',to='',report='sales',gigaText='',extraction=null,selected=new Set();
const api=async(route,body)=>{if(window.edup)return window.edup.request(route,body);const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}:{},body:body?JSON.stringify(body):undefined});const v=await r.json();if(!r.ok)throw Error(v.error);return v;};
tabs.forEach((t,i)=>{const b=el('button',t);b.onclick=()=>{current=i;detail=null;render();};document.querySelector('#nav').append(b);});
async function load(){
 const desktop=!!window.edup?.maintenance;cacheWarning='';
 if(desktop){try{const old=localStorage.getItem('edup-A-snapshot');if(old){if(!await window.edup.maintenance('read-cache'))await window.edup.maintenance('write-cache',JSON.parse(old));localStorage.removeItem('edup-A-snapshot');}}catch{cacheWarning='旧版缓存迁移未完成。';}}
 try{data=await api('snapshot');offline=false;if(desktop){try{await window.edup.maintenance('write-cache',data);localStorage.removeItem('edup-A-snapshot');}catch{cacheWarning='离线副本保存失败，本次数据仍可查看。';}}else localStorage.setItem('edup-A-snapshot',JSON.stringify(data));}
 catch{try{data=desktop?await window.edup.maintenance('read-cache'):JSON.parse(localStorage.getItem('edup-A-snapshot'));}catch{data=null;}offline=true;}render();
}
function marketFilter(parent,allowAll=true){const select=el('select');const sites=[...new Set([...Object.keys(data.operating?.sites||{}),...Object.keys(data.operating?.traffic||{}),...data.products.map(p=>p.site)])].sort();for(const s of allowAll?['ALL',...sites]:sites){const o=el('option',s==='ALL'?'全部站点':(siteNames[s]||s)+' · '+s);o.value=s;select.append(o);}select.value=site;select.onchange=()=>{site=select.value;render();};parent.append(select);}
function render(){
 document.querySelector('#title').textContent=detail?names[detail]+'趋势':tabs[current];[...document.querySelector('#nav').children].forEach((b,i)=>b.className=i===current?'active':'');
 const v=document.querySelector('#view');v.replaceChildren();
 document.querySelector('#notice').textContent=data?(offline?'离线查看 · ':'')+(data.operating?'北京时间 '+data.operating.day+' · 上次同步 '+data.operating.generatedAt+' · 平台数据有延迟。':'当前仅有历史资料，尚无当日统计。')+' '+cacheWarning:'首次使用请进入“同步与维护”完成电脑配对。';
 if(current===5){renderMaintenance(v,{api,reload:load});return;}if(!data)return;
 const toolbar=el('div',undefined,'toolbar');if(current!==3)marketFilter(toolbar);else toolbar.append(el('span','上架任务目标：美国站','tag'));v.append(toolbar);
 if(detail){const back=el('button','返回经营总览');back.onclick=()=>{detail=null;render();};toolbar.append(back);renderDetail(v,detail);return;}
 if(current===0)overview(v);
 if(current===1)products(v);
 if(current===2)reports(v);
 if(current===3)giga(v);
 if(current===4){v.append(card('广告花费与投放效果','广告数据尚未接通，当前不能统计实际花费、ACOS或ROAS。接通后按报表日期展示，不能按0元处理。'));}
}
function overview(v){
 const t=totals(data,site),grid=el('div',undefined,'grid kpis');
 const metrics=[['sales',usdText(t.salesUSD),'北京时间今天零点起；所有已统计站点折算美元'],['units',number(t.units),'按下单商品件数统计'],['profit',usdText(t.profitUSD),'已知成本部分合计，覆盖 '+t.coverage+' / '+(t.units??'—')+' 件；其余商品成本未齐'],['ads','—','尚无同口径当日广告数据'],['sessions','—','访问报表有延迟，点击查看已生成趋势'],['refunds','—','点击查看平台报表退款件数；不等于实物退货']];
 for(const [key,value,note]of metrics){const x=card(names[key]);x.classList.add('kpi');x.tabIndex=0;x.setAttribute('role','button');x.append(el('div',value,'metric'),el('p',note,'muted'));x.onclick=()=>{detail=key;span='today';render();};x.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();x.click();}};grid.append(x);}v.append(grid,el('p',fxNote(data),'muted'));if(t.missingRates?.length)v.append(card('汇率待补齐','缺少 '+t.missingRates.join('、')+' 汇率，总销售额暂不显示不完整合计。'));if(t.siteCount!==Object.keys(data.operating?.sites||{}).length)v.append(card('统计范围提示','当前合计仅覆盖成功同步的 '+(t.siteCount||0)+' 个站点，请核对下方同步提示。'));
 const box=card('重点发现与经营建议','结论使用已注明日期的数据，需与当期活动、库存和毛利一起判断。'),row=el('div',undefined,'strategy-row');
 for(const i of strategies(data,site)){const c=el('div',undefined,'strategy');c.append(el('h3',(i.site?(siteNames[i.site]||i.site)+' · ':'')+i.title),el('p',i.body),el('p','依据时间 '+i.asOf,'muted'));row.append(c);}box.append(row);v.append(box);
 if(data.operating){const states=Object.entries(data.operating.sites).filter(([,x])=>x.state!=='ok');if(states.length)v.append(card('同步覆盖提示',states.map(([s,x])=>s+'：'+(x.error||'未完成')).join('；')));}
}
function controls(parent,platform=false){const tools=el('div',undefined,'toolbar');for(const [key,label]of [['today',platform?'最新报表日':'今天分时'],['7',platform?'最近7个报表日':'近7天'],['30',platform?'最近30个报表日':'近30天'],['all','全部已存日期']]){const b=el('button',label);b.className=span===key?'selected':'';b.onclick=()=>{span=key;from='';to='';render();};tools.append(b);}for(const [label,value,set]of [['开始日期',from,x=>from=x],['结束日期',to,x=>to=x]]){const input=el('input');input.type='date';input.value=value;input.setAttribute('aria-label',label);input.onchange=()=>{set(input.value);render();};tools.append(input);}parent.append(tools);}
function renderDetail(v,key){
 controls(v,key==='sessions'||key==='refunds');
 if(['sales','units','orders'].includes(key)){const series=salesSeries(data,site,key,span);for(const c of new Set(series.map(x=>x.currency)))v.append(chart(names[key]+' · '+c,series.filter(x=>x.currency===c),{unit:key==='sales'?c:key==='units'?'件':'单',start:from,end:to,note:'北京时间口径；'+(key==='sales'?fxNote(data):'鼠标移动查看时间和值。')}));if(!series.length)v.append(card(names[key],'当前没有该范围的可用数据。'));return;}
 if(key==='profit'){const t=totals(data,site);v.append(card('今日已知成本商品的总毛利估算',usdText(t.profitUSD)+'，覆盖 '+t.coverage+' / '+(t.units??'—')+' 件。按历史单件余额乘今日SKU销量后汇总，并统一折算美元；已计采购及头程，未扣广告、退款、仓储。其他款成本未齐，尚不能得到与全部销售额对应的完整毛利。'));if(span==='today'){v.append(chart('估算总毛利 · USD',profitSeries(data,site),{unit:'USD',start:from,end:to,note:fxNote(data)+' 仅已知成本普通M6；按历史单位余额估算。'}));}else v.append(card('历史毛利曲线暂缺','当前只采集了当日的SKU分时毛利估算；不能据此推算历史整店毛利。'));return;}
 if(key==='ads'){v.append(card('暂无广告趋势','等待广告数据接入；不会绘制虚构的0元曲线。'));return;}
 const field=key==='sessions'?'sessions':'refundedUnits';trafficCharts(v,[field]);
}
function trafficCharts(v,fields){const maps={sales:'销售额',units:'售出件数',sessions:'访问次数',pageViews:'页面浏览量',refundedUnits:'退款件数',shippedUnits:'发货件数',conversion:'件数转化率',buyBoxPct:'购物车获得率'};
 let available=false;for(const [s,t]of Object.entries(data.operating?.traffic||{})){if(site!=='ALL'&&s!==site)continue;available=true;for(const field of fields){const range=span==='today'?t.daily.slice(-1):span==='7'?t.daily.slice(-7):span==='30'?t.daily.slice(-30):t.daily;const rows=range.map(x=>({date:x.date,value:field==='conversion'?(x.sessions?x.units/x.sessions*100:null):x[field]})).filter(x=>x.value!==null&&x.value!==undefined);
 v.append(chart((siteNames[s]||s)+' · '+maps[field],rows,{start:from,end:to,unit:field==='conversion'||field==='buyBoxPct'?'%':'',note:'按亚马逊报表日期，尚不能转换为北京时间当天；范围 '+(t.daily[0]?.date||'—')+' 至 '+(t.daily.at(-1)?.date||'—')}));}}
 if(!available)v.append(card('暂无已生成报表','报表生成完成后显示；未把未返回的数据当成0。'));
}
function products(v){
 const box=card('商品与销售状态',data.operating?'本次同步返回的商品；分页或站点失败会单独说明。':'当前为历史商品资料。');
 const rows=el('table'),head=el('tr');['站点 / 商品','ASIN / 销售状态','库存','需要处理的事项','操作'].forEach(x=>head.append(el('th',x)));rows.append(head);
 for(const p of data.products.filter(x=>site==='ALL'||x.site===site)){const tr=el('tr');const status=p.status.includes('BUYABLE')?'可以买到':p.status.length?p.status.join(' / '):'状态待核实';tr.append(el('td',p.site+' / '+p.sku+(p.name?'\n'+p.name:'')),el('td',p.asin+'\n'+status),el('td','可售 '+(p.available??'待核实')+' / 保留 '+(p.reserved??'待核实')));
 const issues=el('td');if(!p.issues.length)issues.append(el('span','本次未返回刊登提示'));for(const i of p.issues){const x=el('details');x.append(el('summary',i.title||i.message||'刊登提示'),el('p',i.why||i.message||'原因待核对'),el('p',i.impact||'影响范围待核对','muted'),el('p',i.next||'请核对卖家后台的原始提示'),el('small','参考编号 '+i.code));issues.append(x);}tr.append(issues);
 const cell=el('td'),b=el('button','管理销售状态');b.onclick=()=>{cell.replaceChildren(el('strong',p.site+' · '+p.sku),el('p','当前版本尚未开通软件内暂停／恢复销售。请先在卖家后台处理，避免误操作。','muted'));for(const label of ['暂停销售（尚未开通）','恢复销售（尚未开通）']){const x=el('button',label);x.disabled=true;cell.append(x);}};cell.append(b);tr.append(cell);rows.append(tr);}
 const scroll=el('div',undefined,'scroll');scroll.append(rows);box.append(scroll);if(data.operating?.catalogComplete===false)box.append(el('p','部分站点或分页未同步完整，请查看同步结果。','danger'));v.append(box);
}
function reports(v){
 const choices=[['sales','销售趋势'],['traffic','流量与转化'],['refunds','退款与发货'],['rank','商品排行'],['cost','SKU收支与成本'],['markets','站点对比'],['promotions','促销活动'],['inventory','库存与刊登'],['compliance','合规费用']];
 const nav=el('div',undefined,'report-tabs');for(const [k,label]of choices){const b=el('button',label);b.className=report===k?'selected':'';b.onclick=()=>{report=k;render();};nav.append(b);}v.append(nav);
 if(report==='sales'){controls(v);for(const k of ['sales','units']){const points=salesSeries(data,site,k,span);for(const c of new Set(points.map(x=>x.currency)))v.append(chart(names[k]+' · '+c,points.filter(x=>x.currency===c),{start:from,end:to,unit:k==='sales'?'USD':'件',note:'下单时间口径，北京时间。'+(k==='sales'?fxNote(data):'')}));}return;}
 if(report==='traffic'){controls(v,true);trafficCharts(v,['sessions','pageViews','conversion','buyBoxPct']);return;}
 if(report==='refunds'){controls(v,true);trafficCharts(v,['refundedUnits','shippedUnits']);v.append(card('口径说明','退款件数来自销售流量报表，不等于当天实际退回仓库的件数；目前尚无同口径的北京时间当天退货数据。'));return;}
 if(report==='rank'){for(const [s,t]of Object.entries(data.operating?.traffic||{})){if(site!=='ALL'&&site!==s)continue;const c=card((siteNames[s]||s)+' · 商品排行','整份报表范围的子ASIN汇总，不是今天；按销售额降序。');c.append(table(['ASIN','销售额','件数','访问次数','件数转化率'],t.asins.filter(x=>x.asin).sort((a,b)=>b.sales-a.sales).map(x=>[x.asin,number(x.sales),number(x.units),number(x.sessions),x.sessions?number(x.units/x.sessions*100)+'%':'—'])));v.append(c);}return;}
 if(report==='cost'){
 for(const [s,t]of Object.entries(data.reports?.sku||{})){if(site!=='ALL'&&site!==s)continue;const c=card((siteNames[s]||s)+' · SKU收支（历史财务入账口径）','按原始交易文件的整段日期汇总；订单结余尚未扣采购、头程、广告和全部退款/仓储等费用。不是净利润。'),search=el('input');search.placeholder='搜索 SKU';c.append(search);const body=el('div');const show=()=>{const rows=Object.entries(t.bySku||{}).filter(([sku])=>sku.toLowerCase().includes(search.value.toLowerCase())).sort((a,b)=>b[1].all.sales-a[1].all.sales);body.replaceChildren(table(['SKU','售出件数','商品销售额 '+t.currency,'促销让利','FBA费用','订单结余','退款销售额'],rows.map(([sku,x])=>[sku,number(x.all.units),number(x.all.sales),number(x.all.promotions),number(x.all.order_fba_fees),number(x.all.order_proceeds_ex_tax_before_refunds_ads_goods),number(x.all.refund_sales)])));};search.oninput=show;show();c.append(body);v.append(c);}
 const cost=data.reports?.cost;if(cost){const c=card('普通M6成本情景',cost.basis);c.append(table(['站点 / SKU','日期范围','件数','单件余额','总余额（人民币）'],cost.rows.filter(x=>site==='ALL'||x.site===site).map(x=>[x.site+' / '+x.sku,x.period,x.units,number(x.unit_balance_local)+' '+x.currency,number(x.total_balance_CNY)])));v.append(c);}return;}
 if(report==='markets'){for(const m of data.markets.filter(x=>site==='ALL'||x.site===site)){const c=card(m.site+' · 历史等长窗口对比','财务入账日期，与首页下单统计口径不同；不同币种不直接相加。');c.append(table(['窗口','销售额 '+m.currency,'件数'],m.periods.map(x=>[x.period,number(x.sales),number(x.units)])));v.append(c);}return;}
 if(report==='promotions'){const p=data.reports?.promotions;for(const [s,x]of Object.entries(p?.sites||{})){if(site!=='ALL'&&site!==s)continue;const c=card(s+' · 已保存的促销活动','资料时间 '+p.asOf+'；不能据此判断当前仍在活动中。');c.append(table(['活动','类型','开始','结束'],x.promotions.map(x=>[x.name,x.type,x.start,x.end])));if(x.performance?.length)c.append(el('h3','活动效果'),table(['类型','状态','浏览','售出件数','销售额','开始','结束'],x.performance.map(p=>[p.type,p.status,number(p.views),number(p.units),number(p.revenue)+' '+p.currency,p.start,p.end])));if(x.coupons?.length)c.append(el('h3','优惠券效果'),table(['折扣','领取次数','兑换次数','销售额','优惠券已用预算','开始','结束'],x.coupons.map(p=>[number(p.discount)+(p.type?.includes('PERCENT')?'%':''),number(p.clips),number(p.redemptions),number(p.sales)+' '+p.currency,number(p.spent)+' '+p.currency,p.start,p.end])));v.append(c);}return;}
 if(report==='inventory'){products(v);return;}
 if(report==='compliance'){v.append(card('年度合规固定费用','人民币 '+number(data.compliance.annual_total)+' 元／年。属于经营固定费用，按用户提供的年度清单；不放在首页当作当天经营指标。'));return;}
}
function giga(v){
 const box=card('批量识别云仓商品编码','可以粘贴带说明的整段文字，或选择TXT、CSV、TSV、DOCX、XLSX。先提取、去重和核对，再创建任务。'),input=el('textarea');input.placeholder='例如：商品编码：W1234P567890，另一个是 W9999S00001';input.value=gigaText;input.oninput=()=>gigaText=input.value;
 const tools=el('div',undefined,'toolbar'),extract=el('button','识别文字中的编码'),file=el('button','从文档识别'),result=el('div');extract.onclick=async()=>{try{extraction=window.edup?.maintenance?await window.edup.maintenance('extract-codes',{text:gigaText}):(()=>{const matches=(gigaText.match(/[A-Z]\d{2,8}[PS]\d{3,12}/gi)||[]).map(x=>x.toUpperCase()),codes=[...new Set(matches)];return {items:codes.map(code=>({code,reason:'编码格式',occurrences:matches.filter(x=>x===code).length})),duplicates:matches.length-codes.length};})();selected=new Set(extraction.items.map(x=>x.code));render();}catch(e){result.textContent=e.message;}};
 file.disabled=!window.edup?.maintenance;file.onclick=async()=>{try{const r=await window.edup.maintenance('extract-document');if(r.canceled)return;extraction=r;selected=new Set(r.items.map(x=>x.code));render();}catch(e){result.textContent=e.message;}};
 tools.append(extract,file);box.append(input,tools,result);v.append(box);
 if(extraction){const c=card('识别结果','识别到 '+extraction.items.length+' 个不同编码，重复 '+(extraction.duplicates||0)+' 次。请核对并勾选；普通数字、日期和金额不会直接作为编码。');
 for(const item of extraction.items){const label=el('label',undefined,'code-row'),check=el('input');check.type='checkbox';check.checked=selected.has(item.code);check.onchange=()=>{check.checked?selected.add(item.code):selected.delete(item.code);count.textContent='已选择 '+selected.size+' 个';};label.append(check,el('strong',item.code),el('span',item.reason+' · 出现 '+item.occurrences+' 次','muted'));c.append(label);}
 const count=el('p','已选择 '+selected.size+' 个'),submit=el('button','创建上架任务'),status=el('div');submit.disabled=offline;submit.onclick=async()=>{try{if(!selected.size||selected.size>100)throw Error('每批请选择1—100个编码');const r=await api('drafts',{account:data.account,action:'giga_import',site:'US',skus:[...selected]});status.textContent='任务已记录，编号 '+r.id+'。云仓执行器尚未接通，本次没有在亚马逊发布商品。';}catch(e){status.textContent=e.message;}};c.append(count,submit,status);v.append(c);}
 v.append(card('识别与上架是两个步骤','本地规则识别不产生模型费用。请先核对编码再创建任务；当前版本还不能直接发布商品。扫描件和PDF需先转换为支持的文档格式。'));
}
document.querySelector('#refresh').onclick=load;load();setInterval(()=>{if(!document.hidden&&(current===0||current===2))load();},60000);
