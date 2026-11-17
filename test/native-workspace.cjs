// Hidden-window run of ui/workspace-v2.js (products + reports views) with a fixed fixture.
// It clicks through the views in a fixed order and records a hash of the page after every step,
// so a refactor of the workspace files can be compared with the recorded trace (test/workspace-trace.golden.json).
process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});
const {app,BrowserWindow,protocol,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const client=path.resolve(process.env.EDUP_CLIENT_DIR||path.join(__dirname,'..')),temp=fs.mkdtempSync(path.join(os.tmpdir(),'edup-workspace-'));
app.setPath('userData',path.join(temp,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'edup',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const out=process.env.EDUP_TRACE_OUT||path.join(temp,'trace.json');
const timeout=setTimeout(()=>{fs.writeFileSync(out,JSON.stringify({error:'TEST_TIMEOUT'}));app.exit(1)},90000);
app.whenReady().then(async()=>{
 const isolated=session.fromPartition('workspace-test');
 isolated.protocol.handle('edup',req=>{
  const u=new URL(req.url);
  if(u.pathname==='/')return new Response('<!doctype html><meta charset="utf-8"><main><section id="view"></section></main>',{headers:{'Content-Type':'text/html'}});
  const file=path.resolve(client,'ui','.'+u.pathname);
  if(!file.startsWith(path.join(client,'ui')+path.sep)||!fs.existsSync(file))return new Response('',{status:404});
  return new Response(fs.readFileSync(file),{headers:{'Content-Type':file.endsWith('.css')?'text/css':'text/javascript'}});
 });
 const win=new BrowserWindow({show:false,focusable:false,width:1200,height:900,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const errors=[];win.webContents.on('console-message',(_e,level,msg)=>{if(level>=2&&!msg.startsWith('Electron Security Warning'))errors.push(msg)});
 await win.loadURL('edup://console/');
 const trace=await win.webContents.executeJavaScript(`(async()=>{
  const {renderWorkspace}=await import('edup://console/workspace-v2.js');
  const sites=['DE','US','FR','GB','PL','IT'];
  const products=[];
  for(let i=0;i<70;i++){
   const site=sites[i%6],n=i%7;
   const issues=n===0?[{code:'300403',severity:'ERROR',message:'link',enforcements:{actions:[{action:'LISTING_SUPPRESSED'}]}}]:n===1?[{code:'99022',severity:'WARNING',message:'count'},{code:'8560',severity:'ERROR',message:'x'}]:n===2?[{code:'555',title:'Custom issue',severity:'WARNING',message:'m'}]:[];
   products.push({sku:'SKU-'+String(i).padStart(3,'0'),site,asin:'B0'+String(1000000+i*37),name:i%5===0?'':'Product '+i,available:i%9===0?0:i%11===0?null:i%13===0?4:20+i,reserved:i%3?2:null,status:i%4?['BUYABLE']:['DISCOVERABLE'],issues});
  }
  const daily=[],tdaily=[];
  for(let d=1;d<=20;d++){const day='2026-11-'+String(d).padStart(2,'0');daily.push({interval:day+'T00:00:00Z--'+day+'T23:59:59Z',totalSales:{currencyCode:d%2?'EUR':'GBP',amount:String(100+d*7)},unitCount:d%5+1});tdaily.push({date:day,sessions:200+d*3,units:d%4?10+d:null,pageViews:400+d*5,refundedUnits:d%6,shippedUnits:8+d});}
  const data={generatedAt:'2026-11-12T01:00:00Z',products,
   operating:{generatedAt:'2026-11-12T01:00:00Z',day:'2026-11-12',
    sites:{DE:{state:'ok',daily},FR:{state:'ok',daily:daily.slice(3)},US:{state:'ok',daily:daily.map(r=>({...r,totalSales:{currencyCode:'USD',amount:'50'}}))},GB:{state:'error'}},
    profit:{day:'2026-11-12',views:{ALL:{profitUSD:123.4,coveredUnits:8,totalUnits:10,taxEstimatedUnits:2,note:'ok note',basis:'basis text',hourly:Array.from({length:6},(_,h)=>({date:'2026-11-12T0'+h+':00:00Z',value:h===3?null:h*4.5})),missing:[{site:'DE',sku:'SKU-001',units:2,reasons:['cost','tax']}]},DE:{profitUSD:50,coveredUnits:3,totalUnits:4,taxEstimatedUnits:0,hourly:[]},US:{profitUSD:-5,coveredUnits:1,totalUnits:2,taxEstimatedUnits:1,hourly:[{date:'2026-11-12T01:00:00Z',value:2}]},FR:{profitUSD:null,totalUnits:0}}},
    traffic:{DE:{daily:tdaily,asins:products.filter(p=>p.site==='DE').slice(0,15).map((p,i)=>({asin:p.asin,units:30-i,sessions:i%3?100+i:0}))},FR:{daily:tdaily.slice(2),asins:products.filter(p=>p.site==='FR').slice(0,4).map((p,i)=>({asin:p.asin,units:5+i,sessions:50}))},US:{daily:tdaily.slice(5),asins:[]}}},
   fx:{date:'2026-11-11',toUSD:{EUR:1.1,GBP:1.3}},
   reports:{sku:{DE:{currency:'EUR',bySku:{'SKU-001':{'2026-09':{units:1,sales:5},'2026-10':{units:3,sales:100,promotions:-5,order_fba_fees:-20,refund_sales:-10,order_proceeds_ex_tax_before_refunds_ads_goods:60}},'SKU-002':{'2026-10':{units:2,sales:50,promotions:0,order_fba_fees:-8,refund_sales:0,order_proceeds_ex_tax_before_refunds_ads_goods:30}}}},GB:{currency:'GBP',bySku:{'SKU-003':{'2026-10':{units:1,sales:20,promotions:-1,order_fba_fees:-3,refund_sales:0,order_proceeds_ex_tax_before_refunds_ads_goods:12}}}}},
    promotions:{asOf:'2026-11-10T00:00:00Z',sites:{DE:{performance:[{type:'LIGHTNING_DEAL',start:'2026-10-01T00:00:00Z',end:'2026-10-02T00:00:00Z',units:4,revenue:120,currency:'EUR'},{type:'PRICE_DISCOUNT',start:'2026-10-10T00:00:00Z',end:'2026-10-20T00:00:00Z',units:0,revenue:0,currency:'EUR'}]}}}},
   compliance:{items:[{site:'DE',name:'VAT service',annual:1200},{site:'UK',name:'UK VAT',annual:800},{site:'EU',name:'Rep',annual:500}]}};
  const view=document.querySelector('#view'),mode={current:'products'};
  const draw=()=>{view.replaceChildren();view.classList.remove('workspace-v2');renderWorkspace(view,{data,mode:mode.current,offline:false,redraw:draw,navigate:m=>{mode.current=m;draw();}});};
  const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
  const trace=[];
  const snap=async label=>{const dlg=document.querySelector('#workspace-detail');const html=view.outerHTML+'|'+(dlg?dlg.open+dlg.outerHTML:'');trace.push([label,html.length,await sha(html)]);};
  const click=(el)=>{el.click();};
  const errs=[];
  const guard=async(label,fn)=>{try{await fn()}catch(e){errs.push(label+': '+e.message)}await snap(label);};
  const labelOf=b=>(b.className+'|'+b.textContent).slice(0,40);
  for(const m of ['products','reports']){
   mode.current=m;draw();await snap(m+' initial');
   for(let round=0;round<70;round++){
    const dlg=document.querySelector('#workspace-detail');
    if(dlg&&dlg.open){const bs=[...dlg.querySelectorAll('button')].filter(b=>!/调价|修改/.test(b.textContent));const pick=round%3===0?bs[0]:bs[bs.length-1];await guard(m+' r'+round+' dialog '+(pick?labelOf(pick):'none'),()=>pick&&click(pick));if(dlg.open)dlg.close();continue;}
    const bs=[...view.querySelectorAll('button')];
    const selects=[...view.querySelectorAll('select')],inputs=[...view.querySelectorAll('input')];
    const kind=round%10;
    if(kind===4&&selects.length){const s=selects[round%selects.length],opt=s.options[(round*3)%s.options.length];await guard(m+' r'+round+' select '+(opt?opt.text.slice(0,20):''),()=>{s.value=opt.value;s.dispatchEvent(new Event('change',{bubbles:true}));});continue;}
    if(kind===7&&inputs.length){const i=inputs[round%inputs.length];await guard(m+' r'+round+' input '+i.type,()=>{if(i.type==='checkbox'){i.checked=!i.checked;i.dispatchEvent(new Event('change',{bubbles:true}));}else{i.value=['SKU-01','zzz','','Product 3'][round%4];i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}});continue;}
    if(!bs.length)continue;
    const b=bs[(round*7+3)%bs.length];
    await guard(m+' r'+round+' click '+labelOf(b),()=>click(b));
   }
  }
  // every report type and every site once, in order
  mode.current='reports';draw();
  for(const label of [...view.querySelectorAll('.report-nav button')].map(b=>b.textContent)){
   const b=[...view.querySelectorAll('.report-nav button')].find(x=>x.textContent===label);
   await guard('report '+label,()=>click(b));
   const sel=view.querySelector('.report-scope select');
   if(sel)for(let k=0;k<sel.options.length;k++)await guard('report '+label+' site '+sel.options[k].text,()=>{view.querySelector('.report-scope select').value=sel.options[k].value;view.querySelector('.report-scope select').dispatchEvent(new Event('change',{bubbles:true}));});
  }
  // buttons that jump to another view or open a product from a report
  const goto=async(label,key)=>{mode.current='reports';draw();const nav=[...view.querySelectorAll('.report-nav button')].find(x=>x.textContent===key);if(nav)click(nav);const sel=view.querySelector('.report-scope select');if(sel&&sel.value!=='ALL'){sel.value='ALL';sel.dispatchEvent(new Event('change',{bubbles:true}));}await snap(label+' open');};
  await goto('sales report','销售趋势');
  await guard('sales report jump',()=>{view.querySelector('button.more').click();});
  await goto('inventory report','库存与刊登');
  await guard('inventory report jump',()=>{const b=view.querySelector('button.more');b.click();});
  await goto('rank report','商品排行');
  await guard('rank report product',()=>{view.querySelector('button.text-button').click();});
  {const dlg=document.querySelector('#workspace-detail');if(dlg&&dlg.open)dlg.close();}
  await snap('after dialog close');
  return {trace,errs};
 })()`);
 trace.consoleErrors=errors;
 clearTimeout(timeout);
 fs.writeFileSync(out,JSON.stringify(trace,null,1));
 app.exit(0);
}).catch(e=>{fs.writeFileSync(out,JSON.stringify({error:String(e&&e.stack||e)}));app.exit(2);});
