// Per-SKU status vocabulary of the semi-automatic listing workspace. Moved out of listing-app.js unchanged.

export const PAGES = [['lists', '清单'], ['new', '新建清单'], ['uploaded', '已上传合格']];
// The only things the operator needs to know about one SKU in semi-automatic mode.
export const STATUS = Object.freeze({
  wait: {name: '待筛选', badge: 'none'},
  busy: {name: '筛选中', badge: 'program'},
  retry: {name: '要重新筛选', badge: 'you'},
  uploaded: {name: '已上传服务器', badge: 'done'},
  off: {name: '已排除', badge: 'off'},
});
export const FILTERS = [['all', '全部'], ['wait', '待筛选'], ['retry', '要重新筛选'], ['uploaded', '已上传'], ['off', '已排除']];
export const keyOf = c => (c.listId || '') + '|' + c.sku;

// Server jobs exist only for SKUs whose return rate passed: the job itself is the upload receipt.
export function semiStatus(c) {
  if (['excluded', 'skipped'].includes(c.stage)) return 'off';
  if (c.jobId) return 'uploaded';
  if (c.stage === 'screening') return c.primary === 'rescreen' ? 'retry' : 'busy';
  return 'wait';
}
export const semiText = (c, s) => s === 'uploaded' ? '退货率合格，已交给服务器；后续由服务器后台处理'
  : s === 'off' || s === 'retry' ? c.headline : s === 'busy' ? '正在大健页面读取退货率' : '还没筛选';
export const matches = (c, f) => f === 'all' || semiStatus(c) === f || (f === 'wait' && semiStatus(c) === 'busy');
