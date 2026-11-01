const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),png=Buffer.from(fs.readFileSync(path.join(root,'assets/icon.png.base64'),'utf8').trim(),'base64');
fs.mkdirSync(path.join(root,'build'),{recursive:true});fs.writeFileSync(path.join(root,'assets/icon.png'),png);
const h=Buffer.alloc(22);h.writeUInt16LE(1,2);h.writeUInt16LE(1,4);h.writeUInt16LE(1,10);h.writeUInt16LE(32,12);h.writeUInt32LE(png.length,14);h.writeUInt32LE(22,18);fs.writeFileSync(path.join(root,'build/icon.ico'),Buffer.concat([h,png]));
