const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),z=require('node:zlib');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),files={};
// Bootstrap 3: module folders are packed too (up to two levels below each top folder); the installed
// patch-store applies the same path rule, so anything packed here must pass its appPath check.
const {appPath}=require('../desktop/patch-store.cjs');
function walk(rel,depth){for(const name of fs.readdirSync(path.join(root,rel)).sort()){const child=rel+'/'+name,s=fs.lstatSync(path.join(root,child));if(s.isSymbolicLink())continue;
 if(s.isDirectory()){if(depth<2&&/^[a-zA-Z0-9_-]+$/.test(name))walk(child,depth+1);continue;}
 if(!s.isFile()||!/^.+\.(cjs|mjs|js|css|html|png|pem)$/.test(name)||/^(?:bootstrap|patch-store)\.cjs$/i.test(name))continue;
 if(!appPath(child))throw Error('PATCH_PATH_INVALID '+child);files[child]=fs.readFileSync(path.join(root,child)).toString('base64');}}
for(const folder of ['desktop','shared','ui','assets'])walk(folder,0);
const raw=Buffer.from(JSON.stringify({format:1,version:pkg.version,files})),patch=z.gzipSync(raw,{level:9}),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});const file=`EDUPLINK-App-${pkg.version}.eduppatch`;fs.writeFileSync(path.join(root,'dist',file),patch);
const descriptor={format:1,bootstrap:3,version:pkg.version,platform:'win32-x64',electron:pkg.devDependencies.electron,size:patch.length,sha256:hash(patch),unpackedSize:raw.length,unpackedSha256:hash(raw),url:'https://console.eduplinkaudio.com/updates/files/'+file};fs.writeFileSync(path.join(root,'dist',file+'.json'),JSON.stringify(descriptor,null,2));console.log(JSON.stringify({file,bytes:patch.length,unpackedBytes:raw.length,files:Object.keys(files).length}));
