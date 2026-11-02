const {createHash,sign,verify,createPublicKey}=require('node:crypto');
const API_VERSION=1,VERSION='0.4.0';
const digest=value=>createHash('sha256').update(value).digest('hex');
function canonical(method,route,body,time,nonce,version){return ['edup-request-v1',method,route,digest(body),String(time),nonce,version].join('\n');}
function pairMessage(code,publicKey){return 'edup-pair-v1\n'+digest(code)+'\n'+publicKey;}
function deviceId(publicKey){const key=createPublicKey(publicKey);if(key.asymmetricKeyType!=='ed25519')throw Error('KEY_TYPE');return digest(key.export({format:'der',type:'spki'})).slice(0,32);}
function signRequest(privateKey,{method,route,body='',time,nonce,version=VERSION}){return sign(null,Buffer.from(canonical(method,route,body,time,nonce,version)),privateKey).toString('base64');}
function verifyRequest(publicKey,signature,args){try{return verify(null,Buffer.from(canonical(args.method,args.route,args.body,args.time,args.nonce,args.version)),publicKey,Buffer.from(signature,'base64'));}catch{return false;}}
function compareVersions(a,b){const parse=v=>{if(!/^\d+\.\d+\.\d+$/.test(v))throw Error('VERSION_FORMAT');return v.split('.').map(Number);};const x=parse(a),y=parse(b);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i]?1:-1;}return 0;}
module.exports={API_VERSION,VERSION,digest,canonical,pairMessage,deviceId,signRequest,verifyRequest,compareVersions};
