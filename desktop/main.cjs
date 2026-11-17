const {protocol}=require('electron');
const {GigaBrowser}=require('./giga-browser/giga-browser.cjs');
const {start}=require('./main-lifecycle.cjs');
const gigaBrowser=new GigaBrowser();
protocol.registerSchemesAsPrivileged([{scheme:'edup',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
start({gigaBrowser});
