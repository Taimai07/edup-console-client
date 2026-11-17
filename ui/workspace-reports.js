import {ws,el,$,names,inventory,rank,problem,fmt,money,button,info} from './workspace-base.js';
import {showDetail,render,products} from './workspace-products.js';
import {salesReport} from './workspace-sales.js';
import {reportEntries,reportProducts,reportTabs,summaryBlock,metrics,dataTable,panel,bars,lineChart,trafficRows} from './workspace-report-parts.js';
function reports(v){
reportTabs(v);
if(ws.reportType==='sales'){
salesReport(v);
return;}
const grid=el('div',undefined,'report-grid');
if(ws.reportType==='profit'){
const p=ws.DATA.profit?.views?.[ws.reportSite],hourly=p?.hourly||[];
metrics(v,[['当日估算毛利',p?.profitUSD==null?'暂缺':money(p.profitUSD),'按服务器计算结果显示'],['成本覆盖件数',p?fmt(p.coveredUnits)+' / '+fmt(p.totalUnits):'—','已覆盖 / 已取得订单件数'],['税额估算件数',p?fmt(p.taxEstimatedUnits):'—','实际税项优先，缺失时采用估算'],['统计日期',ws.DATA.profit?.day||'待生成','北京时间当日']]);
summaryBlock(v,'先看覆盖范围，再判断盈利',p?.note||'这个站点尚无可用毛利结果。',[['毛利口径',p?.basis||'缺失数据不按0补齐。'],['优先补齐缺项',p?.missing?.length?'下方列出未计入的SKU及原因。':'当前已取得订单的成本覆盖情况以服务器回执为准。']]);
grid.append(lineChart('当日分时毛利 · USD',hourly,' USD','各小时金额，非累计净利润'),bars('站点毛利 · USD',reportEntries(ws.DATA.profit?.views).filter(([s,p])=>s!=='ALL'&&p.totalUnits>0&&p.profitUSD!=null).map(([s,p])=>({label:names[s]||s,value:p.profitUSD}))));
v.append(grid);
if(p?.missing?.length){
const box=panel('未计入的商品','这些商品不会按零成本计入利润');
box.append(dataTable(['站点','SKU','件数','缺项'],p.missing.map(x=>[names[x.site]||x.site,x.sku,x.units,x.reasons.join('、')])));
v.append(box);}
return;}
if(ws.reportType==='traffic'||ws.reportType==='refunds'){
grid.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';
const rows=trafficRows().slice(-14),sum=k=>!rows.length||rows.some(r=>r[k]==null)?null:rows.reduce((n,r)=>n+r[k],0),period=(rows[0]?.date||'—')+' — '+(rows.at(-1)?.date||'—'),num=n=>n==null?'暂缺':fmt(n);
if(ws.reportType==='traffic'){
metrics(v,[['访问次数',num(sum('sessions')),period],['页面浏览量',num(sum('pageViews')),'平台报表日期口径'],['售出件数',num(sum('units')),'同份流量报表'],['件数转化率',sum('sessions')&&sum('units')!=null?fmt(sum('units')/sum('sessions')*100)+'%':'暂缺','售出件数 / 访问次数']]);
summaryBlock(v,'流量和转化分开看','当前展示已保存流量报表中最近14个报告日；访问减少和转化下降对应不同的处理方向。',[['流量下降时','核对曝光、关键词、活动结束与广告；广告来源仍需独立数据。'],['转化下降时','核对售价、配送承诺、页面内容、评价及购买条件。']]);
grid.append(lineChart('访问次数',rows.map(r=>({date:r.date,value:r.sessions})),' 次',period),lineChart('件数转化率',rows.map(r=>({date:r.date,value:r.sessions&&r.units!=null?r.units/r.sessions*100:null})),'%',period));}else{
metrics(v,[['退款件数',num(sum('refundedUnits')),period],['发货件数',num(sum('shippedUnits')),'同份平台报表'],['售出件数',num(sum('units')),'不作为同批订单退款率分母'],['退货原因','待补齐','退款不等于实物退回仓库']]);
summaryBlock(v,'先定位退款集中日期，再追查原因','退款与发货可能来自不同时间下单的订单，不能直接相除作为同批订单退款率。',[['核对异常日期','结合具体SKU和退款原因判断问题。'],['区分退款与退货','实际退回、退款到账、仓库处理需要分别核对。']]);
grid.append(lineChart('退款件数',rows.map(r=>({date:r.date,value:r.refundedUnits})),' 件',period),lineChart('发货件数',rows.map(r=>({date:r.date,value:r.shippedUnits})),' 件',period));}
v.append(grid,el('div','目前预览载入德国、法国、美国的已保存流量报表；站点无数据时留空。此处日期为平台报告日。','info-strip'));
return;}
if(ws.reportType==='rank'){
const rows=reportEntries(ws.DATA.traffic).flatMap(([s,t])=>(t.asins||[]).filter(x=>x.asin).map(x=>({...x,site:s}))).sort((a,b)=>b.units-a.units);
metrics(v,[['子ASIN记录',fmt(rows.length),'按站点分别统计'],['排行指标','售出件数','可比较跨币种商品'],['报表范围','已保存整段','不标为今日商品排行'],['站点范围',ws.reportSite==='ALL'?'德 / 法 / 美':names[ws.reportSite],'仅统计已有报表']]);
summaryBlock(v,'先找销量主力，再检查利润','当前排行按整份已保存报告的件数排序，不能仅靠销量判断利润贡献。',[['销量主力','核查库存是否足以覆盖补货周期。'],['高访问低成交','结合流量与转化报表定位页面或购买条件问题。']]);
const box=panel('商品排行 · 前12条','点击商品编号查看现有商品快照');
box.append(dataTable(['站点','ASIN','售出件数','访问次数','件数转化率'],rows.slice(0,12).map(x=>[names[x.site],button(x.asin,()=>{
const p=ws.DATA.products.find(p=>p.site===x.site&&p.asin===x.asin);
if(p)showDetail(p);},'text-button'),x.units,x.sessions,x.sessions?fmt(x.units/x.sessions*100)+'%':'—'])));
v.append(box);
return;}
if(ws.reportType==='finance'){
const availableMonths=[...new Set(reportEntries(ws.DATA.historical.sku).flatMap(([,t])=>Object.values(t.bySku||{}).flatMap(x=>Object.keys(x).filter(k=>/^\d{4}-\d{2}$/.test(k)))))].sort();
const month=availableMonths.at(-1)||'暂无月份',rows=reportEntries(ws.DATA.historical.sku).flatMap(([s,t])=>Object.entries(t.bySku||{}).map(([sku,d])=>({site:s,sku,currency:t.currency,...d[month]}))).filter(x=>x.units||x.sales||x.refund_sales);
const usd=(x,k)=>(Number(x[k])||0)*(x.currency==='USD'?1:ws.DATA.fx.toUSD[x.currency]),total=k=>rows.length?rows.reduce((n,x)=>n+usd(x,k),0):null;
metrics(v,[['商品销售额',money(total('sales')),month+' 入账月份'],['促销让利',money(total('promotions')),'按财务原始正负号展示'],['订单FBA费用',money(total('order_fba_fees')),'不包含所有经营费用'],['订单结余',money(total('order_proceeds_ex_tax_before_refunds_ads_goods')),'尚未扣采购、广告等']]);
summaryBlock(v,'订单结余与经营利润分开看','本页采用历史财务入账文件的月份口径，不能与首页下单销售额直接逐日对账。',[['费用核对','查看促销让利、配送费用及退款销售额。'],['利润核对','再结合采购、头程、广告、仓储和固定支出。']]);
grid.append(bars('收支构成 · USD',[['商品销售额','sales'],['促销让利','promotions'],['FBA费用','order_fba_fees'],['退款销售额','refund_sales']].map(([label,k])=>({label,value:total(k)}))),bars('各站点订单结余 · USD',reportEntries(ws.DATA.historical.sku).map(([site])=>({label:names[site],value:rows.filter(x=>x.site===site).reduce((n,x)=>n+usd(x,'order_proceeds_ex_tax_before_refunds_ads_goods'),0)}))));
v.append(grid);
return;}
if(ws.reportType==='inventory'){
const rows=reportProducts(),a=rows.filter(p=>inventory(p)==='active'),z=rows.filter(p=>inventory(p)==='zero'),u=rows.filter(p=>inventory(p)==='unknown'),issues=rows.filter(problem);
metrics(v,[['有库存链接',fmt(a.length),'按链接条数'],['零库存链接',fmt(z.length),'已单独收纳'],['库存待核实',fmt(u.length),'不归入缺货'],['待处理链接',fmt(issues.length),'不重复累计同条链接的问题数']]);
summaryBlock(v,'先处理有库存但销售受限的商品','库存以站点链接展示，共享FBA库存不跨站点相加。零库存商品保留问题记录。',[['有库存且存在问题','优先处理平台限制、刊登错误及购买状态。'],['无库存商品','按补货和清库计划管理，不能把无库存自动当成停售。']]);
grid.append(bars('地区零库存链接',Object.keys(names).map(s=>({label:names[s],value:z.filter(p=>p.site===s).length})).filter(x=>x.value).sort((a,b)=>b.value-a.value),' 条'),bars('地区待处理链接',Object.keys(names).map(s=>({label:names[s],value:issues.filter(p=>p.site===s).length})).filter(x=>x.value).sort((a,b)=>b.value-a.value),' 条'));
v.append(grid,button('进入商品问题筛选 →',()=>{
ws.view='products';
ws.onlyIssues=true;
render();},'more'));
return;}
if(ws.reportType==='promotions'){
const rows=reportEntries(ws.DATA.historical.promotions?.sites).flatMap(([site,x])=>(x.performance||[]).map(p=>({...p,site})));
metrics(v,[['已保存活动记录',fmt(rows.length),'可能不覆盖平台全部活动'],['有成交的记录',fmt(rows.filter(x=>x.units>0).length),'依原始活动汇总'],['数据取得日期',ws.DATA.historical.promotions.asOf.slice(0,10),'不能据此判断今天仍在进行'],['分析口径','单场活动累计','跨月活动不按单月分摊']]);
summaryBlock(v,'活动是否有效，要结合毛利和活动后表现','这里保留活动各自的日期和整场结果。活动销售额不是利润，也不能直接认定带来了长期自然流量。',[['活动期间','核对让利、费用、销量和库存消耗。'],['活动结束后','比较后续流量、转化和累计收益。']]);
const box=panel('活动效果 · 最近保存记录','金额保持原币种，日期以活动记录为准');
box.append(dataTable(['站点','类型','开始','结束','件数','销售额'],rows.sort((a,b)=>b.start.localeCompare(a.start)).slice(0,10).map(x=>[names[x.site],x.type==='LIGHTNING_DEAL'?'秒杀':'促销',x.start.slice(0,10),x.end.slice(0,10),x.units,fmt(x.revenue)+' '+x.currency])));
v.append(box);
return;}
if(ws.reportType==='ads'){
metrics(v,[['广告花费','—','等待广告API授权'],['广告销售额','—','等待归因数据'],['ACOS / ROAS','—','数据缺失不补0'],['搜索词表现','—','接入后按报告日期分析']]);
summaryBlock(v,'广告报表入口已预留，当前没有真实广告数据','此页会按活动、广告组、商品和搜索词切换；授权到位后再展示实际效果。',[['预算分析','比较花费、成交和盈利空间。'],['搜索词分析','识别高效词与无效消耗，再制定调整建议。']]);
const box=panel('广告活动表现','当前没有可显示的记录');
box.append(el('div','等待广告数据接入','empty'));
v.append(box);
return;}
if(ws.reportType==='compliance'){
const rows=ws.DATA.historical.compliance.items.filter(x=>ws.reportSite==='ALL'||x.site===ws.reportSite||(ws.reportSite==='GB'&&x.site==='UK')),total=rows.reduce((n,x)=>n+x.annual,0);
metrics(v,[['年度固定费用',rows.length?'¥'+fmt(total):'未提供','用户提供的年度清单'],['月度摊销参考',rows.length?'¥'+fmt(total/12):'未提供','管理口径，非付款记录'],['费用项目',fmt(rows.length),'共享费用不重复分到各站'],['币种','人民币','VAT服务费与销售税额分开']]);
summaryBlock(v,'固定费用用于判断站点长期收益','这是年度费用清单，不能当作当天经营指标，也不代表已经支付。',[['站点决策','结合完整利润判断续费与市场投入。'],['共享费用','欧代暂列共享，确认覆盖范围后再分摊。']]);
const box=panel('年度合规费用明细','来源：用户提供的年度人民币费用');
box.append(dataTable(['地区','费用项目','年度费用'],rows.map(x=>[names[x.site]||x.site,x.name,'¥'+fmt(x.annual)])));
v.append(box);
return;}}


export {reports};
