const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {createHash,randomBytes}=require('node:crypto');
const sha=b=>createHash('sha256').update(b).digest('hex');
function fileHash(file){const fd=fs.openSync(file,'r'),h=createHash('sha256'),b=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
function applyDelta(patch,base,target,manifest,delta){
 if(patch.length!==delta.size||sha(patch)!==delta.sha256)throw Error('DELTA_HASH_MISMATCH');
 const old=fs.openSync(base,'r');let out,temp;
 try{
  if(fs.fstatSync(old).size!==delta.fromSize)throw Error('DELTA_BASE_MISMATCH');
  const baseHash=createHash('sha256'),buf=Buffer.alloc(1024*1024);let n,pos=0;
  while((n=fs.readSync(old,buf,0,buf.length,pos))){baseHash.update(buf.subarray(0,n));pos+=n;}
  if(baseHash.digest('hex')!==delta.fromSha256)throw Error('DELTA_BASE_MISMATCH');
  const raw=zlib.gunzipSync(patch,{maxOutputLength:96*1024*1024});
  if(raw.length<12||raw.subarray(0,8).toString()!=='EDUPDLT1')throw Error('DELTA_FORMAT_INVALID');
  const len=raw.readUInt32LE(8);if(len<2||len>4*1024*1024||12+len>raw.length)throw Error('DELTA_FORMAT_INVALID');
  const plan=JSON.parse(raw.subarray(12,12+len)),data=raw.subarray(12+len);
  if(plan.fromSha256!==delta.fromSha256||plan.toSha256!==manifest.sha256||plan.toSize!==manifest.size||!Array.isArray(plan.ops)||plan.ops.length>100000)throw Error('DELTA_PLAN_INVALID');
  fs.mkdirSync(path.dirname(target),{recursive:true});const disk=fs.statfsSync(path.dirname(target));if(disk.bavail*disk.bsize<manifest.size+32*1024*1024)throw Error('UPDATE_DISK_FULL');
  temp=target+'.'+randomBytes(8).toString('hex')+'.partial';out=fs.openSync(temp,'wx',0o600);const hash=createHash('sha256');let size=0,head=Buffer.alloc(0);
  for(const op of plan.ops){if(!Array.isArray(op)||op.length!==3||!['copy','data'].includes(op[0])||!Number.isSafeInteger(op[1])||op[1]<0||!Number.isSafeInteger(op[2])||op[2]<1||op[1]+op[2]>(op[0]==='copy'?delta.fromSize:data.length)||size+op[2]>manifest.size)throw Error('DELTA_RANGE_INVALID');
   let done=0;while(done<op[2]){const take=Math.min(buf.length,op[2]-done);let chunk;if(op[0]==='copy'){if(fs.readSync(old,buf,0,take,op[1]+done)!==take)throw Error('DELTA_READ_FAILED');chunk=buf.subarray(0,take);}else chunk=data.subarray(op[1]+done,op[1]+done+take);
    hash.update(chunk);if(head.length<2)head=Buffer.concat([head,chunk]).subarray(0,2);let written=0;while(written<take){const w=fs.writeSync(out,chunk,written,take-written);if(w<=0)throw Error('UPDATE_DISK_WRITE_FAILED');written+=w;}done+=take;size+=take;
   }
  }
  if(size!==manifest.size||hash.digest('hex')!==manifest.sha256||head.toString()!=='MZ')throw Error('UPDATE_FILE_MISMATCH');
  fs.fsyncSync(out);fs.closeSync(out);out=undefined;fs.renameSync(temp,target);return target;
 }finally{fs.closeSync(old);if(out!==undefined)fs.closeSync(out);if(temp)try{fs.unlinkSync(temp);}catch{}}
}
module.exports={applyDelta,fileHash};
