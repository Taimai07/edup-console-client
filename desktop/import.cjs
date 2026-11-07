const fs=require('node:fs'),zlib=require('node:zlib');
const {Worker, isMainThread, parentPort, workerData} = require('node:worker_threads');
const MiB = 1024 * 1024;
const materialLimits = {file: 10 * MiB, entry: 4 * MiB, expanded: 12 * MiB, entries: 1000};
const skuLimits = {file: 128 * MiB, entry: 64 * MiB, expanded: 128 * MiB, entries: 65535};
const decodeXml=s=>s.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,x)=>String.fromCodePoint(x[0].toLowerCase()==='x'?parseInt(x.slice(1),16):Number(x))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
function extractCodes(text, maxLength = 2 * MiB){
 if(typeof text!=='string'||text.length>maxLength)throw Error('TEXT_TOO_LARGE');const found=new Map();let matches=0;
 const add=(raw,index,reason)=>{if(!/\d/.test(raw))return;const code=raw.replace(/[.,;，。；]+$/,'').toUpperCase();matches++;const old=found.get(code);if(old){old.occurrences++;return;}if(found.size>=500)throw Error('TOO_MANY_CODES');found.set(code,{code,reason,occurrences:1,index});};
 // Known GIGA item formats, including the verified W1234P567890 and W9999S00001 families.
 for(const m of text.matchAll(/(?<![A-Za-z0-9])[A-Z]\d{2,8}[PS]\d{3,12}(?![A-Za-z0-9])/gi))add(m[0],m.index,'编码格式');
 for(const m of text.matchAll(/\b[WB]\d{7,14}\b/gi))add(m[0],m.index,'数字编码候选，请核对');
 for(const m of text.matchAll(/(?:\bSKU\b|\bitem\s*code\b|\bcode\b|产品编码|商品编码|大健编码)\s*[:：=#]\s*([A-Za-z0-9][A-Za-z0-9_.-]{2,127})/gi)){
  const x=m[1].replace(/[.,;，。；]+$/,'');if(!found.has(x.toUpperCase()))add(x,m.index,'带编码标签');
 }
 // Keep the original rule priority without splitting the entire document into an array.
 let start = 0;
 while (start < text.length) {
  const newline = text.indexOf('\n', start);
  const end = newline === -1 ? text.length : newline;
  const trimmed = text.slice(start, end).trim();
  let last = trimmed.length;
  while (last && '.,;，。；'.includes(trimmed[last - 1])) last--;
  const candidate = last <= 41 ? trimmed.slice(0, last) : '';
  if (/^[A-Za-z][A-Za-z0-9_.-]{2,40}$/.test(candidate) &&
      /\d/.test(candidate) && !found.has(candidate.toUpperCase())) {
   add(candidate, start, '独立编码行，请确认');
  }
  start = end + 1;
 }
 let line = 1;
 let newline = text.indexOf('\n');
 for (const item of [...found.values()].sort((left, right) => left.index - right.index)) {
  while (newline !== -1 && newline < item.index) {
   line++;
   newline = text.indexOf('\n', newline + 1);
  }
  item.line = line;
  delete item.index;
 }
 return {items:[...found.values()],unique:found.size,duplicates:matches-found.size,method:'规则提取',note:'未匹配部分不代表没有编码；提交前核对所选编码'};
}
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
 const plain=x=>decodeXml(x.replace(/<\/(?:w:p|si|c|row)>/g,'\n').replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<[^>]+>/g,''));
 if(out['word/document.xml'])return plain(out['word/document.xml']);
 const strings=[...(out['xl/sharedStrings.xml']||'').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>plain(m[1]));const cells=[];
 for(const [name,xml]of Object.entries(out)){if(!name.startsWith('xl/worksheets/'))continue;for(const m of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){if(/<f\b/.test(m[2]))continue;const value=m[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];if(/\bt=["']s["']/.test(m[1]))cells.push(strings[Number(value)]||'');else cells.push(plain(m[2]));}}
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
