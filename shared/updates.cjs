const {verify,createHash}=require('node:crypto');
const {compareVersions}=require('./protocol.cjs');
function validateRelease(envelope,{publicKey,currentVersion,apiVersion=1,allowedHosts=['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']}={}){
 if(!publicKey)throw Error('UPDATE_TRUST_NOT_CONFIGURED');
 if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>32768||typeof envelope.signature!=='string')throw Error('UPDATE_MANIFEST_INVALID');
 if(!verify(null,Buffer.from(envelope.payload),publicKey,Buffer.from(envelope.signature,'base64')))throw Error('UPDATE_SIGNATURE_INVALID');
 const m=JSON.parse(envelope.payload),url=new URL(m.url);
 if(url.protocol!=='https:'||url.username||url.password||!allowedHosts.includes(url.hostname)||!/^https:\/\/github\.com\/Taimai07\/edup-console-client\/releases\/download\//.test(m.url))throw Error('UPDATE_URL_INVALID');
 if(!/^[a-f0-9]{64}$/.test(m.sha256||'')||!Number.isSafeInteger(m.size)||m.size<1||m.size>500*1024*1024||m.platform!=='win32-x64'||m.apiVersion!==apiVersion||m.channel!=='stable')throw Error('UPDATE_MANIFEST_INVALID');
 if(compareVersions(m.version,currentVersion)<=0)return {available:false,version:m.version};
 return {available:true,...m};
}
function verifyDownload(buffer,manifest){if(buffer.length!==manifest.size||createHash('sha256').update(buffer).digest('hex')!==manifest.sha256)throw Error('UPDATE_FILE_MISMATCH');return true;}
module.exports={validateRelease,verifyDownload};
