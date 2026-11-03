const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),z=require('node:zlib');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),files={};
for(const folder of ['desktop','shared','ui','assets'])for(const name of fs.readdirSync(path.join(root,folder)).sort()){
 const rel=folder+'/'+name,file=path.join(root,rel);if(!fs.statSync(file).isFile()||!/^.+\.(cjs|mjs|js|css|html|png|pem)$/.test(name)||['desktop/bootstrap.cjs','desktop/patch-store.cjs'].includes(rel))continue;files[rel]=fs.readFileSync(file).toString('base64');
}
const raw=Buffer.from(JSON.stringify({format:1,version:pkg.version,files})),patch=z.gzipSync(raw,{level:9}),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});const file=`EDUPLINK-App-${pkg.version}.eduppatch`;fs.writeFileSync(path.join(root,'dist',file),patch);
const descriptor={format:1,bootstrap:1,version:pkg.version,platform:'win32-x64',electron:pkg.devDependencies.electron,size:patch.length,sha256:hash(patch),unpackedSize:raw.length,unpackedSha256:hash(raw),url:'https://console.eduplinkaudio.com/updates/files/'+file};fs.writeFileSync(path.join(root,'dist',file+'.json'),JSON.stringify(descriptor,null,2));console.log(JSON.stringify({file,bytes:patch.length,unpackedBytes:raw.length,files:Object.keys(files).length}));
