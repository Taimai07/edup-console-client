const crypto=require('node:crypto');
function record(x){if(!x||typeof x!=='object')throw Error('CLIENT_LOG_INVALID');const out={};for(const k of ['at','version','event','code','status','route','durationMs','requestId','level']){if(x[k]===undefined)continue;const s=String(x[k]);if(s.length>160||! /^[A-Za-z0-9_./: +\-]*$/.test(s))continue;if(k==='route'&&!/^[a-z0-9_-]+$/.test(s))continue;out[k]=s;}if(!out.at||!Number.isFinite(Date.parse(out.at))||!out.event)throw Error('CLIENT_LOG_INVALID');return out;}
const id=x=>crypto.createHash('sha256').update(JSON.stringify(record(x))).digest('hex');
module.exports={record,id};
