const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ProtectedState}=require('../desktop/state.cjs'),{downloadFile}=require('../desktop/maintenance.cjs');
function codec(){const key=crypto.randomBytes(32);return {isEncryptionAvailable:()=>true,encryptString:s=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const b=Buffer.concat([c.update(s,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]);},decryptString:b=>{const c=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString();}};}
test('protected cache and upgrade backup preserve identity bytes and fail closed on key changes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edup-state-'));
 try{const c=codec(),s=new ProtectedState(dir,c),snapshot={products:[{sku:'PRIVATE-SKU'}],markets:[]};
 fs.writeFileSync(path.join(dir,'connection.json'),'fixture-config');fs.writeFileSync(path.join(dir,'device-identity.bin'),'fixture-key');
 s.writeCache(snapshot);assert.deepEqual(s.readCache(),snapshot);assert.equal(fs.readFileSync(s.cache).includes(Buffer.from('PRIVATE-SKU')),false);
 const b=s.backup({version:'0.2.2',sha256:'a'.repeat(64)});assert.equal(b.files,3);assert.equal(s.inspectUpgrade('0.2.1').state,'previous_version');assert.equal(s.inspectUpgrade('0.2.2').state,'awaiting_ui');assert.equal(s.confirmUi().state,'installed');
 s.backup({version:'0.2.3',sha256:'b'.repeat(64)});assert.equal(s.inspectUpgrade('0.2.2').state,'previous_version');s.confirmUi();assert.equal(fs.existsSync(s.pending),false);
 s.backup({version:'0.2.3',sha256:'b'.repeat(64)});s.cancelUpgrade();assert.equal(fs.existsSync(s.pending),false);
 s.backup({version:'0.2.3',sha256:'b'.repeat(64)});fs.writeFileSync(path.join(dir,'device-identity.bin'),'changed');assert.throws(()=>s.inspectUpgrade('0.2.3'),/UPGRADE_DATA_CHANGED/);assert.equal(fs.readFileSync(path.join(dir,'device-identity.bin'),'utf8'),'changed');
 assert.throws(()=>new ProtectedState(dir,{isEncryptionAvailable:()=>false}).writeCache(snapshot),/PROTECTION_UNAVAILABLE/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('corrupt encrypted cache is rejected rather than interpreted as plaintext',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edup-cache-'));try{const s=new ProtectedState(dir,codec());s.writeCache({products:[],markets:[]});const b=fs.readFileSync(s.cache);b[b.length-1]^=1;fs.writeFileSync(s.cache,b);assert.throws(()=>s.readCache());}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('streamed update verifies bytes before replacement and removes partial data on failure',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edup-download-')),before=global.fetch,target=path.join(dir,'setup.exe'),bytes=Buffer.from('MZfixture'),m={size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 try{global.fetch=async()=>new Response(bytes,{headers:{'Content-Length':String(bytes.length)}});await downloadFile('https://console.eduplinkaudio.com/updates/files/EDUPLINK-Setup-0.2.2.exe',m,target);assert.deepEqual(fs.readFileSync(target),bytes);
 global.fetch=async()=>new Response(Buffer.from('MZbadfile'),{headers:{'Content-Length':String(bytes.length)}});await assert.rejects(downloadFile('https://github.com/test',m,target));assert.deepEqual(fs.readFileSync(target),bytes);assert.equal(fs.readdirSync(dir).some(x=>x.endsWith('.partial')),false);
 await assert.rejects(downloadFile('http://github.com/test',m,target),/HOST_INVALID/);
 }finally{global.fetch=before;fs.rmSync(dir,{recursive:true,force:true});}
});
