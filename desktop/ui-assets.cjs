const fs=require('node:fs'),path=require('node:path');
const CSP="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:";
// Bootstrap 3: ui/ may hold module folders, at most two levels deep. Only real files and real folders whose
// every name part is [a-zA-Z0-9_-] (no dots, links or Windows device names) are listed once at start; a request
// is served only when its path is exactly one listed name, so traversal and encoded separators cannot match.
const PART=/^[a-zA-Z0-9_-]+$/,FILE=/^[a-zA-Z0-9_-]+\.(?:html|css|js)$/,DEVICE=/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
function listUI(dir,prefix='',depth=0,names=new Set()){
 for(const n of fs.readdirSync(dir).sort()){const full=path.join(dir,n),s=fs.lstatSync(full);if(s.isSymbolicLink())continue;
  if(s.isFile()&&FILE.test(n)&&!DEVICE.test(n.replace(/\.[a-z]+$/,'')))names.add(prefix+n);
  else if(s.isDirectory()&&depth<2&&PART.test(n)&&!DEVICE.test(n))listUI(full,prefix+n+'/',depth+1,names);}
 return names;
}
function createUIHandler(dir,{missing=()=>{}}={}){
 const names=listUI(dir);
 return req=>{const u=new URL(req.url),name=u.pathname==='/'?'index.html':u.pathname.slice(1);
  if(u.host!=='console'||!names.has(name)||u.pathname!==('/'+name)&&u.pathname!=='/'){missing(u.pathname);return new Response('Not found',{status:404});}
  const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html';
  return new Response(fs.readFileSync(path.join(dir,name)),{headers:{'Content-Type':type+'; charset=utf-8','Content-Security-Policy':CSP}});
 };
}
module.exports={createUIHandler,listUI};
