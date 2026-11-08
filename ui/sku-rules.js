const MAX_TEXT_LENGTH = 2 * 1024 * 1024;

export function extractCodes(text, maxLength = MAX_TEXT_LENGTH) {
 if (typeof text !== 'string' || text.length > maxLength) throw Error('TEXT_TOO_LARGE');
 const normalized = text
  .replace(/[０-９ＰＳＷｐｓｗ]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
  .replace(/[\u00ad\u200b\u200c\u200d\u2060\ufeff]/g, '');
 const found = new Map();
 let matches = 0;
 let line = 1;
 let newline = normalized.indexOf('\n');

 // Formats observed in successful GIGA product reads.
 for (const match of normalized.matchAll(/(?<![A-Z0-9])W(?:[0-9]{3,4}P[0-9]{6}|[0-9]{4}S[0-9]{5})(?![A-Z0-9])/gi)) {
  const code = match[0].toUpperCase();
  matches++;
  const existing = found.get(code);
  if (existing) {
   existing.occurrences++;
   continue;
  }
  if (found.size >= 500) throw Error('TOO_MANY_CODES');
  while (newline !== -1 && newline < match.index) {
   line++;
   newline = normalized.indexOf('\n', newline + 1);
  }
  found.set(code, {code, reason: '云仓 SKU 格式', occurrences: 1, line});
 }
 return {items: [...found.values()], unique: found.size, duplicates: matches - found.size,
  method: '云仓 SKU 格式提取', note: '核对已识别的商品编码后再创建任务'};
}
