export const STORAGE_CODES = new Set(['GIGA_SERVER_STORAGE_LOW','GIGA_SERVER_STORAGE_UNAVAILABLE']);
export function storageCode(value) {
  const direct = typeof value === 'string' ? value : value?.code || value?.reason || value?.message || value?.failure?.code || '';
  const found = [...STORAGE_CODES].find(code => String(direct).includes(code));
  if (found) return found;
  if (!value || typeof value !== 'object') return null;
  for (const child of [value.result,value.pipeline,...(value.items || [])]) {
    const code = storageCode(child); if (code) return code;
  }
  return null;
}
export function storageMessage(storage) {
  if (!storage || !storage.blocked) return '';
  const amount = Number.isFinite(storage.freeBytes) ? '剩余 ' + (storage.freeBytes / 1024**3).toFixed(2) + ' GiB' +
    (Number.isFinite(storage.freePercent) ? '（' + storage.freePercent + '%）' : '') + '。' : '';
  return (storage.code === 'GIGA_SERVER_STORAGE_UNAVAILABLE' ? '无法确认服务器存储空间。' : '服务器存储不足。') + amount +
    '资源下载已停止，已有资料与进度保留；释放空间后手动继续原任务。';
}
