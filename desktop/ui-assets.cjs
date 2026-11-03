const fs=require('node:fs'),path=require('node:path');
const CSP="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:";
function createUIHandler(dir,{missing=()=>{}}={}){
 const names=new Set(fs.readdirSync(dir).filter(n=>/^[a-zA-Z0-9_-]+\.(?:html|css|js)$/.test(n)&&fs.lstatSync(path.join(dir,n)).isFile()));
 return req=>{const u=new URL(req.url),name=u.pathname==='/'?'index.html':u.pathname.slice(1);
  if(u.host!=='console'||!names.has(name)||u.pathname!==('/'+name)&&u.pathname!=='/'){missing(u.pathname);return new Response('Not found',{status:404});}
  const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html';
  return new Response(fs.readFileSync(path.join(dir,name)),{headers:{'Content-Type':type+'; charset=utf-8','Content-Security-Policy':CSP}});
 };
}
module.exports={createUIHandler};
