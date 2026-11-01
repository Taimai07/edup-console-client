const fs=require('node:fs'),zlib=require('node:zlib');
const decodeXml=s=>s.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,x)=>String.fromCodePoint(x[0].toLowerCase()==='x'?parseInt(x.slice(1),16):Number(x))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
function extractCodes(text){
 if(typeof text!=='string'||text.length>2*1024*1024)throw Error('TEXT_TOO_LARGE');const found=new Map();let matches=0;
 const add=(raw,index,reason)=>{if(!/\d/.test(raw))return;const code=raw.replace(/[.,;，。；]+$/,'').toUpperCase();matches++;const old=found.get(code);if(old){old.occurrences++;return;}if(found.size>=500)throw Error('TOO_MANY_CODES');found.set(code,{code,reason,occurrences:1,line:text.slice(0,index).split('\n').length});};
 // Known GIGA item formats, including the verified W1234P567890 and W9999S00001 families.
 for(const m of text.matchAll(/(?<![A-Za-z0-9])[A-Z]\d{2,8}[PS]\d{3,12}(?![A-Za-z0-9])/gi))add(m[0],m.index,'编码格式');
 for(const m of text.matchAll(/\b[WB]\d{7,14}\b/gi))add(m[0],m.index,'数字编码候选，请核对');
 for(const m of text.matchAll(/(?:\bSKU\b|\bitem\s*code\b|\bcode\b|产品编码|商品编码|大健编码)\s*[:：=#]\s*([A-Za-z0-9][A-Za-z0-9_.-]{2,127})/gi)){
  const x=m[1].replace(/[.,;，。；]+$/,'');if(!found.has(x.toUpperCase()))add(x,m.index,'带编码标签');
 }
 let pos=0;for(const line of text.split(/\r?\n/)){const v=line.trim().replace(/[.,;，。；]+$/,'');if(/^[A-Za-z][A-Za-z0-9_.-]{2,40}$/.test(v)&&/\d/.test(v)&&!found.has(v.toUpperCase()))add(v,pos,'独立编码行，请确认');pos+=line.length+1;}
 return {items:[...found.values()],unique:found.size,duplicates:matches-found.size,method:'规则提取',note:'未匹配部分不代表没有编码；提交前核对所选编码'};
}
function zipXml(bytes){
 let e=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){e=i;break;}
 if(e<0)throw Error('DOCUMENT_ZIP_INVALID');const count=bytes.readUInt16LE(e+10);let at=bytes.readUInt32LE(e+16),total=0,out={};
 if(count>1000)throw Error('DOCUMENT_TOO_LARGE');
 for(let n=0;n<count;n++){
  if(at+46>bytes.length||bytes.readUInt32LE(at)!==0x02014b50)throw Error('DOCUMENT_ZIP_INVALID');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),compressed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),nl=bytes.readUInt16LE(at+28),el=bytes.readUInt16LE(at+30),cl=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42),name=bytes.subarray(at+46,at+46+nl).toString();at+=46+nl+el+cl;
  if(!/^(word\/document|xl\/sharedStrings|xl\/worksheets\/sheet\d+)\.xml$/.test(name))continue;
  total+=size;if(size>4*1024*1024||total>12*1024*1024||flags&1||![0,8].includes(method))throw Error('DOCUMENT_TOO_LARGE');
  if(offset+30>bytes.length||bytes.readUInt32LE(offset)!==0x04034b50)throw Error('DOCUMENT_ZIP_INVALID');const begin=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);if(begin+compressed>bytes.length)throw Error('DOCUMENT_ZIP_INVALID');
  const raw=bytes.subarray(begin,begin+compressed),plain=method===8?zlib.inflateRawSync(raw,{maxOutputLength:4*1024*1024}):raw;if(plain.length!==size)throw Error('DOCUMENT_ZIP_INVALID');out[name]=plain.toString('utf8');
 }
 const plain=x=>decodeXml(x.replace(/<\/(?:w:p|si|c|row)>/g,'\n').replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<[^>]+>/g,''));
 if(out['word/document.xml'])return plain(out['word/document.xml']);
 const strings=[...(out['xl/sharedStrings.xml']||'').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>plain(m[1]));const cells=[];
 for(const [name,xml]of Object.entries(out)){if(!name.startsWith('xl/worksheets/'))continue;for(const m of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){if(/<f\b/.test(m[2]))continue;const value=m[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];if(/\bt=["']s["']/.test(m[1]))cells.push(strings[Number(value)]||'');else cells.push(plain(m[2]));}}
 return cells.join('\n');
}
function fileText(file){const bytes=fs.readFileSync(file);if(bytes.length>10*1024*1024)throw Error('DOCUMENT_TOO_LARGE');if(/\.(docx|xlsx)$/i.test(file))return zipXml(bytes);if(!/\.(txt|csv|tsv)$/i.test(file))throw Error('支持TXT、CSV、TSV、DOCX和XLSX，请先将其他文档另存为这些格式');try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('gb18030',{fatal:true}).decode(bytes);}}
module.exports={extractCodes,fileText};
