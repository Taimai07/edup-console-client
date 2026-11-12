const test=require('node:test'),assert=require('node:assert/strict');
const data=new Map();global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
global.window={edup:{maintenance:async()=>{},ai:async()=>{throw Error('No business call expected')}}};
test('nested terminal resource failures are visible without classifying normal jobs as blocked',async()=>{
 const {storageCode,storageMessage}=await import('../ui/storage-state.js');
 assert.equal(storageCode({result:{pipeline:{items:[{reason:'GIGA_SERVER_STORAGE_LOW'}]}}}),'GIGA_SERVER_STORAGE_LOW');
 assert.equal(storageCode({state:'completed',result:{pipeline:{items:[{state:'PREVIEW_VALID'}]}}}),null);
 assert.match(storageMessage({blocked:true,freeBytes:1073741824,freePercent:1.5}),/服务器存储不足.*1.00 GiB.*1.5%/);
 const {friendlyError}=await import('../ui/notices.js');assert.equal(friendlyError(Error('GIGA_SERVER_STORAGE_LOW')).title,'服务器存储不足');
});
