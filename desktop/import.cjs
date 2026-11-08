const fs=require('node:fs'),zlib=require('node:zlib');
const {Worker, isMainThread, parentPort, workerData} = require('node:worker_threads');
const MiB = 1024 * 1024;
const materialLimits = {file: 10 * MiB, entry: 4 * MiB, expanded: 12 * MiB, entries: 1000};
const skuLimits = {file: 128 * MiB, entry: 64 * MiB, expanded: 128 * MiB, entries: 65535, cachedFormulaText: true};
const decodeXml=s=>s.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,x)=>String.fromCodePoint(x[0].toLowerCase()==='x'?parseInt(x.slice(1),16):Number(x))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const {extractCodes} = require('../ui/sku-rules.js');
function zipXml(bytes, limits){
 let e=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){e=i;break;}
 if(e<0)throw Error('DOCUMENT_ZIP_INVALID');const count=bytes.readUInt16LE(e+10);let at=bytes.readUInt32LE(e+16),total=0,out={};
 if(count>limits.entries)throw Error('DOCUMENT_TOO_LARGE');
 for(let n=0;n<count;n++){
  if(at+46>bytes.length||bytes.readUInt32LE(at)!==0x02014b50)throw Error('DOCUMENT_ZIP_INVALID');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),compressed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),nl=bytes.readUInt16LE(at+28),el=bytes.readUInt16LE(at+30),cl=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42),name=bytes.subarray(at+46,at+46+nl).toString();at+=46+nl+el+cl;
  if(!/^(word\/document|xl\/sharedStrings|xl\/worksheets\/sheet\d+)\.xml$/.test(name))continue;
  total+=size;if(size>limits.entry||total>limits.expanded)throw Error('DOCUMENT_EXPANDED_TOO_LARGE');
  if(flags&1||![0,8].includes(method))throw Error('DOCUMENT_ZIP_INVALID');
  if(offset+30>bytes.length||bytes.readUInt32LE(offset)!==0x04034b50)throw Error('DOCUMENT_ZIP_INVALID');const begin=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);if(begin+compressed>bytes.length)throw Error('DOCUMENT_ZIP_INVALID');
  const raw=bytes.subarray(begin,begin+compressed),plain=method===8?zlib.inflateRawSync(raw,{maxOutputLength:limits.entry}):raw;if(plain.length!==size)throw Error('DOCUMENT_ZIP_INVALID');out[name]=plain.toString('utf8');
 }
 const plain = xml => decodeXml(xml
  .replace(/<\/(?:w:p|w:tc|si|c|row)>/g, '\n')
  .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
  .replace(/<w:tab\b[^>]*\/>/g, '\t')
  .replace(/<[^>]+>/g, ''));
 if (out['word/document.xml']) return plain(out['word/document.xml']);
 const strings = Array.from(
  (out['xl/sharedStrings.xml'] || '').matchAll(/<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si\s*>/g),
  match => plain(match[1]));
 const cells = [];
 for (const [name, xml] of Object.entries(out)) {
  if (!name.startsWith('xl/worksheets/')) continue;
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c\s*>)/g)) {
   const [, attributes, body] = match;
   if (body === undefined) continue;
   const type = attributes.match(/(?:^|\s)t=(?:"([^"]*)"|'([^']*)')/);
   const cellType = type?.[1] ?? type?.[2];
   const value = body.match(/<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v\s*>/)?.[1];
   if (/<(?:[\w.-]+:)?f\b/.test(body)) {
    if (limits.cachedFormulaText && value !== undefined && cellType === 'str') cells.push(decodeXml(value));
    else if (limits.cachedFormulaText && value !== undefined && cellType === 's') cells.push(strings[Number(value)] || '');
   } else if (cellType === 's') {
    cells.push(strings[Number(value)] || '');
   } else {
    cells.push(plain(body));
   }
  }
 }
 return cells.join('\n');
}
function fileText(file, limits = materialLimits) {
 const office = /\.(docx|xlsx)$/i.test(file);
 if (!office && !/\.(txt|csv|tsv)$/i.test(file)) {
  throw Error('支持TXT、CSV、TSV、DOCX和XLSX，请先将其他文档另存为这些格式');
 }
 const handle = fs.openSync(file, 'r');
 let bytes;
 try {
  const stat = fs.fstatSync(handle);
  if (!stat.isFile()) throw Error('DOCUMENT_FILE_INVALID');
  if (stat.size > limits.file) throw Error('DOCUMENT_TOO_LARGE');
  bytes = Buffer.allocUnsafe(stat.size);
  let offset = 0;
  while (offset < bytes.length) {
   const count = fs.readSync(handle, bytes, offset, bytes.length - offset, offset);
   if (count === 0) throw Error('DOCUMENT_CHANGED');
   offset += count;
  }
  const after = fs.fstatSync(handle);
  if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw Error('DOCUMENT_CHANGED');
 } finally {
  fs.closeSync(handle);
 }
 if (office) return zipXml(bytes, limits);
 try {
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
 } catch {
  return new TextDecoder('gb18030', {fatal: true}).decode(bytes);
 }
}

let importInProgress = false;
async function importCodes(file) {
 if (importInProgress) throw Error('正在识别另一份文档，请稍候。');
 importInProgress = true;
 try {
  return await new Promise((resolve, reject) => {
   const worker = new Worker(__filename, {
    workerData: {skuImport: file},
    resourceLimits: {maxOldGenerationSizeMb: 768},
   });
   worker.once('message', ({result, error}) => {
    if (error) reject(Error(error));
    else resolve(result);
   });
   worker.once('error', error => reject(Error(error.code === 'ERR_WORKER_OUT_OF_MEMORY'
    ? '文档展开后所需内存过大，请拆成几份再识别。'
    : error.message)));
   worker.once('exit', () => reject(Error('文档识别提前结束，请重新选择文件。')));
  });
 } finally {
  importInProgress = false;
 }
}

if (!isMainThread && workerData?.skuImport) {
 const messages = {
  DOCUMENT_TOO_LARGE: '文件超过 128 MiB，请拆成几份再识别。',
  DOCUMENT_EXPANDED_TOO_LARGE: 'Office 文档展开后的内容超过单个 XML 64 MiB 或合计 128 MiB，请拆成几份再识别。',
  ERR_BUFFER_TOO_LARGE: 'Office 文档展开后的内容超过安全上限，请拆成几份再识别。',
  TEXT_TOO_LARGE: '提取出的文字过多，请拆成几份再识别。',
  DOCUMENT_ZIP_INVALID: '无法读取此 Office 文件，请检查是否损坏或加密。',
  DOCUMENT_CHANGED: '文件在读取期间发生变化，请保存后重新选择。',
  TOO_MANY_CODES: '识别到超过 500 个不同编码，请拆成几份再识别。',
 };
 try {
  const result = extractCodes(fileText(workerData.skuImport, skuLimits), 128 * MiB);
  parentPort.postMessage({result});
 } catch (error) {
  parentPort.postMessage({error: messages[error.code] || messages[error.message] || error.message});
 }
}

module.exports = {extractCodes, fileText, importCodes};
