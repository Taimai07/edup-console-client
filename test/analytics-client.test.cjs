const {test}=require('node:test'),assert=require('node:assert/strict');
test('Beijing dashboard handles midnight, unknown values and different currencies',async()=>{const {bjtDay,today,number,totals}=await import('../ui/analytics.js');assert.equal(bjtDay(new Date('2026-11-01T15:59:59Z')),'2026-11-01');assert.equal(bjtDay(new Date('2026-11-01T16:00:00Z')),'2026-11-02');assert.equal(number(null),'—');const state=c=>({state:'ok',hourly:[{unitCount:1,orderCount:1,totalSales:{currencyCode:c,amount:10}}]});const d={operating:{day:today(),sites:{DE:state('EUR'),US:state('USD')}}};assert.deepEqual(totals(d,'ALL').money,{EUR:10,USD:10});d.operating.day='2000-01-01';assert.equal(totals(d,'ALL').ready,false);});

test('USD aggregation preserves missing FX, negative margin and combines the same hour',async()=>{
 const {usd,sumUSD,salesSeries,profitSeries,axisScale,today,totals}=await import('../ui/analytics.js');
 const fx={date:'2026-10-30',toUSD:{EUR:1.2,USD:1,GBP:1.3}};
 assert.equal(usd(10,'EUR',fx),12);assert.equal(usd(0,'UNKNOWN',fx),0);assert.equal(usd(4,'UNKNOWN',fx),null);assert.equal(usd(null,'USD',fx),null);
 assert.equal(sumUSD({EUR:10,USD:5,GBP:10},fx).amount,30);assert.equal(sumUSD({EUR:10,ABC:1},fx).amount,null);
 const interval=today()+'T00:00:00+08:00--'+today()+'T01:00:00+08:00';
 const state=c=>({state:'ok',hourly:[{interval,unitCount:3,orderCount:1,totalSales:{currencyCode:c,amount:10}}],m6Estimate:{currency:c,amount:-2,units:3,hourly:[{interval,amount:-2}]}});
 const d={fx,operating:{day:today(),sites:{DE:state('EUR'),US:state('USD'),NL:{state:'ok',hourly:[]}},profit:{day:today(),views:{ALL:{profitUSD:-4.4,coveredUnits:6,totalUnits:6,hourly:[{date:interval.split('--')[0],currency:'USD',value:-4.4}]}}}}};
 assert.equal(totals(d,'ALL').salesUSD,22);assert.equal(totals(d,'ALL').profitUSD,-4.4);assert.equal(totals(d,'ALL').units,6);
 assert.deepEqual(salesSeries(d,'ALL','sales','today').map(x=>x.value),[22]);assert.deepEqual(profitSeries(d,'ALL').map(x=>x.value),[-4.4]);
 for(const values of [[0],[.002,.003],[-20,-1],[1,10000]]){const a=axisScale(values);assert.ok(a.min<=Math.min(...values)&&a.max>=Math.max(...values)&&a.max>a.min&&a.step>0);}
});
