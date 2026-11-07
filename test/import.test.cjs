const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {extractCodes,fileText,importCodes}=require('../desktop/import.cjs');

test('document import scans beyond the former size and text limits', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edup-large-import-'));
 const file = path.join(dir, 'fixture.txt');
 try {
  fs.writeFileSync(file, 'a'.repeat(11 * 1024 * 1024) + '\r\nSKU: 000123\r\nW9999S00001');
  const result = await importCodes(file);
  assert.deepEqual(result.items.map(item => [item.code, item.line]), [
   ['W9999S00001', 3], ['000123', 2],
  ]);
 } finally {
  fs.unlinkSync(file);
  fs.rmdirSync(dir);
 }
});
test('XLSX extracts referenced cells without importing unused shared strings',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edup-xlsx-'));try{const file=path.join(dir,'fixture.xlsx');fs.writeFileSync(file,Buffer.from('UEsDBBQAAAAIAGw+Yl2B+1avNgAAAF4AAAAUAAAAeGwvc2hhcmVkU3RyaW5ncy54bWyzKS4usbMpzrSzKbELNzQyNgkwNTO3sDSw0QcK64PEoXKWQBBsAASGGFIWQBBgCQYIOX2QwQBQSwMEFAAAAAgAbD5iXa3sYAY8AAAAYwAAABgAAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWyzKc8vyi7OSE0tsbMBUy6JJYl2NkX55XY2yQoltkrFSnY2ZXYGNvpldjb6ySiChnBBfbB6fSQD9BHmAgBQSwECFAAUAAAACABsPmJdgftWrzYAAABeAAAAFAAAAAAAAAAAAAAAgAEAAAAAeGwvc2hhcmVkU3RyaW5ncy54bWxQSwECFAAUAAAACABsPmJdrexgBjwAAABjAAAAGAAAAAAAAAAAAAAAgAFoAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sUEsFBgAAAAACAAIAiAAAANoAAAAAAA==','base64'));assert.deepEqual(extractCodes(fileText(file)).items.map(x=>x.code),['W1234P567890','W9999S00001']);}finally{if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir()))throw Error('TEST_PATH');fs.rmSync(dir,{recursive:true,force:true});}});
test('mixed text extracts and deduplicates item codes without treating dates/prices as codes',()=>{const r=extractCodes('日期 2026-11-02，价格 $99.99\n商品编码：W1234P567890\n再加入 W9999S00001 和 W1234P567890。\nSKU: 000123\n普通说明');assert.deepEqual(r.items.map(x=>x.code),['W1234P567890','W9999S00001','000123']);assert.equal(r.duplicates,1);assert.equal(extractCodes('日期2026-11-02，价格99元').unique,0);assert.throws(()=>extractCodes('x'.repeat(2100000)),/TOO_LARGE/);});
test('DOCX handles a code split across formatted text runs, and rejects invalid archives',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edup-doc-'));try{const file=path.join(dir,'fixture.docx');fs.writeFileSync(file,Buffer.from('UEsDBBQAAAAIALg9Yl0R8FyiUgAAAJcAAAARAAAAd29yZC9kb2N1bWVudC54bWyzKbdKyU8uzU3NK7GzKbcqABFFIKLE7unUtqeTG5/vmfZ8QeP7PbPCDY2MTWz0QTIgsghJZYCpmbmFpQGKpD7UMGQTwy2BINgACAyxqNVHcgoAUEsBAhQAFAAAAAgAuD1iXRHwXKJSAAAAlwAAABEAAAAAAAAAAAAAAIABAAAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAABAAEAPwAAAIEAAAAAAA==','base64'));assert.deepEqual(extractCodes(fileText(file)).items.map(x=>x.code),['W1234P567890','W9999S00001']);fs.writeFileSync(file,'not-a-zip');assert.throws(()=>fileText(file));}finally{if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir()))throw Error('TEST_PATH');fs.rmSync(dir,{recursive:true,force:true});}});
