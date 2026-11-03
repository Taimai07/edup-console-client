const {verify,createHash}=require('node:crypto');
const {compareVersions}=require('./protocol.cjs');
const UPDATE_ORIGIN='https://console.eduplinkaudio.com';
function trustedArtifact(value){try{const u=new URL(value);return u.origin===UPDATE_ORIGIN&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/updates\/files\/(?:EDUPLINK-App-\d+\.\d+\.\d+\.eduppatch|EDUPLINK-Setup-\d+\.\d+\.\d+\.exe|EDUPLINK-\d+\.\d+\.\d+-to-\d+\.\d+\.\d+\.edupdelta)$/.test(u.pathname);}catch{return false;}}
function validateRelease(envelope,{publicKey,currentVersion,apiVersion=1,allowedHosts=['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']}={}){
 if(!publicKey)throw Error('UPDATE_TRUST_NOT_CONFIGURED');
 if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>32768||typeof envelope.signature!=='string')throw Error('UPDATE_MANIFEST_INVALID');
 if(!verify(null,Buffer.from(envelope.payload),publicKey,Buffer.from(envelope.signature,'base64')))throw Error('UPDATE_SIGNATURE_INVALID');
 const m=JSON.parse(envelope.payload),url=new URL(m.url);
 if(!trustedArtifact(m.url)||!m.url.endsWith('.exe'))throw Error('UPDATE_URL_INVALID');
 if(!/^[a-f0-9]{64}$/.test(m.sha256||'')||!Number.isSafeInteger(m.size)||m.size<1||m.size>500*1024*1024||m.platform!=='win32-x64'||m.apiVersion!==apiVersion||m.channel!=='stable')throw Error('UPDATE_MANIFEST_INVALID');
 if(m.deltas!==undefined){if(!Array.isArray(m.deltas)||m.deltas.length>4)throw Error('UPDATE_DELTA_INVALID');for(const d of m.deltas){if(!/^\d+\.\d+\.\d+$/.test(d.fromVersion)||compareVersions(d.fromVersion,m.version)>=0||!trustedArtifact(d.url)||!d.url.endsWith('.edupdelta')||!Number.isSafeInteger(d.size)||d.size<1||d.size>64*1024*1024||!Number.isSafeInteger(d.fromSize)||d.fromSize<1||d.fromSize>500*1024*1024||![d.sha256,d.fromSha256].every(s=>/^[a-f0-9]{64}$/.test(s||'')))throw Error('UPDATE_DELTA_INVALID');}}
 if(compareVersions(m.version,currentVersion)<=0)return {available:false,version:m.version};
 return {available:true,...m};
}
function verifyDownload(buffer,manifest){if(buffer.length!==manifest.size||createHash('sha256').update(buffer).digest('hex')!==manifest.sha256)throw Error('UPDATE_FILE_MISMATCH');return true;}
module.exports={validateRelease,verifyDownload,trustedArtifact,UPDATE_ORIGIN};
