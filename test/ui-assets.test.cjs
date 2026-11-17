// ui-assets serves only real files that exist under ui/ when the window starts (bootstrap 3: module folders allowed).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createUIHandler}=require('../desktop/ui-assets.cjs');
const BS=String.fromCharCode(92);

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'edup-ui-assets-')),ui=path.join(root,'ui'),outside=path.join(root,'outside');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const dir of ['listing','listing/sheets','listing/sheets/deep','con'])fs.mkdirSync(path.join(ui,dir),{recursive:true});
  fs.mkdirSync(outside);
  const put=(rel,text)=>fs.writeFileSync(path.join(ui,...rel.split('/')),text);
  put('index.html','<p>index</p>');put('app.js','app');put('listing/app.js','listing app');put('listing/sheets/form.js','form');
  put('listing/sheets/deep/too-deep.js','deep');put('con/x.js','device');put('.hidden.js','hidden');put('listing/notes.txt','text');
  fs.writeFileSync(path.join(outside,'secret.js'),'secret');fs.writeFileSync(path.join(root,'private.js'),'private');
  let links=false;
  try{fs.symlinkSync(outside,path.join(ui,'linked'),'junction');fs.symlinkSync(path.join(outside,'secret.js'),path.join(ui,'link.js'),'file');links=true;}catch{}
  return {ui,links};
}
async function get(handler,url){const r=await handler({url});return {status:r.status,text:await r.text(),type:r.headers.get('content-type'),csp:r.headers.get('content-security-policy')};}

test('module folders are served with the same CSP; the root still serves index.html',async t=>{
  const {ui}=fixture(t),missing=[],h=createUIHandler(ui,{missing:p=>missing.push(p)});
  assert.equal((await get(h,'edup://console/')).text,'<p>index</p>');
  const app=await get(h,'edup://console/listing/app.js');
  assert.equal(app.status,200);assert.equal(app.text,'listing app');assert.match(app.type,/^text\/javascript/);
  assert.equal(app.csp,"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:");
  assert.equal((await get(h,'edup://console/listing/sheets/form.js')).text,'form');
  assert.equal((await get(h,'edup://console/app.js')).text,'app');
  assert.deepEqual(missing,[]);
});

test('traversal, encoded separators, backslashes, links, device names, hidden and deep files are not served',async t=>{
  const {ui,links}=fixture(t),missing=[],h=createUIHandler(ui,{missing:p=>missing.push(p)});
  const bad=['edup://console/../private.js','edup://console/listing/../../private.js','edup://console/%2e%2e/private.js','edup://console/listing/%2e%2e/%2e%2e/private.js',
    'edup://console/listing%2fapp.js','edup://console/listing%5capp.js','edup://console/listing'+BS+'app.js','edup://console/..'+BS+'private.js',
    'edup://console/linked/secret.js','edup://console/link.js','edup://console/con/x.js','edup://console/.hidden.js','edup://console/listing/notes.txt',
    'edup://console/listing/sheets/deep/too-deep.js','edup://console//listing/app.js','edup://console/listing/app.js/','edup://other/listing/app.js','edup://console/LISTING/app.js'];
  for(const url of bad){const r=await get(h,url);assert.equal(r.status,404,url);assert.notEqual(r.text,'secret');assert.notEqual(r.text,'private');}
  assert.ok(missing.length>=bad.length-1);
  if(!links)t.diagnostic('symlink fixtures could not be created here; link cases exercised as plain missing paths');
});
