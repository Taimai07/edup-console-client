const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {extractCodes,fileText,importCodes}=require('../desktop/import.cjs');

test('recognizes SKU text from multiple sheets in a binary XLS workbook', async () => {
 const xls = require('../desktop/sheetjs-0-20-3.cjs');
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edup-xls-'));
 const file = path.join(dir, 'fixture.XLS');
 try {
  const workbook = xls.utils.book_new();
  xls.utils.book_append_sheet(workbook, xls.utils.aoa_to_sheet([
   ['货号', '报价', 'W123P456789'], ['SKU: 123456', 1299, 'W1234P567890'],
  ]), '云仓');
  xls.utils.book_append_sheet(workbook, xls.utils.aoa_to_sheet([
   ['X1234P567890', 'W9999S00001', 'W123P456789'],
  ]), '第二页');
  const bytes = Buffer.from(xls.write(workbook, {type: 'buffer', bookType: 'biff8'}));
  assert.equal(bytes.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
  fs.writeFileSync(file, bytes);
  const result = await importCodes(file);
  assert.deepEqual(result.items.map(item => item.code), ['W123P456789', 'W1234P567890', 'W9999S00001']);
  assert.equal(result.duplicates, 1);
  fs.writeFileSync(file, 'W123P456789');
  await assert.rejects(importCodes(file), /无法读取这个 XLS 工作簿/);
 } finally {
  fs.rmSync(file, {force: true});
  fs.rmdirSync(dir);
 }
});

test('document import scans beyond the former size and text limits', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edup-large-import-'));
 const file = path.join(dir, 'fixture.txt');
 try {
  fs.writeFileSync(file, 'a'.repeat(11 * 1024 * 1024) + '\r\nSKU: 000123\r\nW9999S00001');
  const result = await importCodes(file);
  assert.deepEqual(result.items.map(item => [item.code, item.line]), [
   ['W9999S00001', 3],
  ]);
 } finally {
  fs.unlinkSync(file);
  fs.rmdirSync(dir);
 }
});
test('XLSX extracts referenced cells without importing unused shared strings',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edup-xlsx-'));try{const file=path.join(dir,'fixture.xlsx');fs.writeFileSync(file,Buffer.from('UEsDBBQAAAAIAGw+Yl2B+1avNgAAAF4AAAAUAAAAeGwvc2hhcmVkU3RyaW5ncy54bWyzKS4usbMpzrSzKbELNzQyNgkwNTO3sDSw0QcK64PEoXKWQBBsAASGGFIWQBBgCQYIOX2QwQBQSwMEFAAAAAgAbD5iXa3sYAY8AAAAYwAAABgAAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWyzKc8vyi7OSE0tsbMBUy6JJYl2NkX55XY2yQoltkrFSnY2ZXYGNvpldjb6ySiChnBBfbB6fSQD9BHmAgBQSwECFAAUAAAACABsPmJdgftWrzYAAABeAAAAFAAAAAAAAAAAAAAAgAEAAAAAeGwvc2hhcmVkU3RyaW5ncy54bWxQSwECFAAUAAAACABsPmJdrexgBjwAAABjAAAAGAAAAAAAAAAAAAAAgAFoAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sUEsFBgAAAAACAAIAiAAAANoAAAAAAA==','base64'));assert.deepEqual(extractCodes(fileText(file)).items.map(x=>x.code),['W1234P567890','W9999S00001']);}finally{if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir()))throw Error('TEST_PATH');fs.rmSync(dir,{recursive:true,force:true});}});
test('mixed text extracts and deduplicates item codes without treating dates/prices as codes',()=>{const r=extractCodes('日期 2026-11-02，价格 $99.99\n商品编码：W1234P567890\n再加入 W9999S00001 和 W1234P567890。\nSKU: 000123\n普通说明');assert.deepEqual(r.items.map(x=>x.code),['W1234P567890','W9999S00001']);assert.equal(r.duplicates,1);assert.equal(extractCodes('日期2026-11-02，价格99元').unique,0);assert.throws(()=>extractCodes('x'.repeat(2100000)),/TOO_LARGE/);});
test('DOCX handles a code split across formatted text runs, and rejects invalid archives',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edup-doc-'));try{const file=path.join(dir,'fixture.docx');fs.writeFileSync(file,Buffer.from('UEsDBBQAAAAIALg9Yl0R8FyiUgAAAJcAAAARAAAAd29yZC9kb2N1bWVudC54bWyzKbdKyU8uzU3NK7GzKbcqABFFIKLE7unUtqeTG5/vmfZ8QeP7PbPCDY2MTWz0QTIgsghJZYCpmbmFpQGKpD7UMGQTwy2BINgACAyxqNVHcgoAUEsBAhQAFAAAAAgAuD1iXRHwXKJSAAAAlwAAABEAAAAAAAAAAAAAAIABAAAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAABAAEAPwAAAIEAAAAAAA==','base64'));assert.deepEqual(extractCodes(fileText(file)).items.map(x=>x.code),['W1234P567890','W9999S00001']);fs.writeFileSync(file,'not-a-zip');assert.throws(()=>fileText(file));}finally{if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir()))throw Error('TEST_PATH');fs.rmSync(dir,{recursive:true,force:true});}});

test('matches only verified GIGA formats and normalizes typographic variants', () => {
 const lines = [
  'B123456789', 'ITEM-1234', 'X1234P567890', 'W123456789', 'SKU: 000123',
  'SKU: W1234P56789', 'W1234S000001', 'AW1234P567890', 'W1234P5678900',
  'Ｗ１２３Ｐ４５６７８９', '商品编码：w1234p567890、W9999S00001',
  'W1234P\u200B567890',
 ];
 const result = extractCodes(lines.join('\n'));
 assert.deepEqual(result.items.map(x => [x.code, x.line, x.occurrences]), [
  ['W123P456789', 10, 1], ['W1234P567890', 11, 2], ['W9999S00001', 11, 1],
 ]);
 assert.equal(result.duplicates, 1);
});

test('Excel import reads cells after blanks and saved formula text without evaluating formulas', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edup-sku-cells-'));
 const file = path.join(dir, 'fixture.xlsx');
 try {
  fs.writeFileSync(file, Buffer.from('UEsDBBQAAAAIAOFMaF0O1Sqd6QAAAKkBAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sXVFNb4MwDL3vVyCfOmmaCWvZiiBSR3fdKrUS54iFgUoCSqKWn798dBr0HezYL+9ZcfIpuw7qrFvOTTSJXupsKqA1ZswQdd1ywfTzMHJpuWZQghlbqh/Uo+Ls28tEj0kcpyhYJ4HmU+a7e2aYK9RwpQ8215EqYEcA6V/xTiAyBXSy7yQ/GuW1nfYiFwytSPKyztEdXVQz6rBJX9+28YLEILep/h9Zhin65t/Q8uuz3J1WUG0t4AmOsQWBR6dr3JUL9VTou+7l3nN/7wlVYnFYe8DNaan5IBDM3Zs26dIXw55cni0PZ39DfwFQSwECFAAUAAAACADhTGhdDtUqnekAAACpAQAAGAAAAAAAAAAAAAAAgAEAAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sUEsFBgAAAAABAAEARgAAAB8BAAAAAA==', 'base64'));
  assert.deepEqual((await importCodes(file)).items.map(x => x.code), ['W1234P567890', 'W9999S00001']);
  assert.deepEqual(extractCodes(fileText(file)).items.map(x => x.code), ['W1234P567890']);
 } finally {
  fs.rmSync(file, {force:true});
  fs.rmdirSync(dir);
 }
});
