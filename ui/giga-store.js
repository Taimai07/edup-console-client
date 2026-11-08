import {el} from './analytics.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const messages = {
  GIGA_STORE_BRIDGE_UPDATE_REQUIRED: '请更新大健扩展和本机连接组件，再重新连接大健页面。',
  GIGA_BROWSER_NOT_CONNECTED: '请先在对应地区的大健买家页面点「连接此大健页」。',
  GIGA_BROWSER_REGION_MISMATCH: '大健买家页面的地区与工作台所选站点不同。',
  STORE_BUYER_LOGIN_REQUIRED: '请先登录对应地区的大健买家账号。',
  STORE_URL_INVALID: '请输入大健官网的店铺首页、商品页或店铺介绍链接。',
  STORE_INPUT_INVALID: '请输入店铺名称、编码或大健店铺链接。',
  STORE_NOT_FOUND: '没有找到精确匹配的店铺，请核对地区或改用店铺编码、网址。',
  STORE_NAME_AMBIGUOUS: '有多家同名店铺，请改用店铺编码或网址。',
  STORE_SEARCH_TOO_BROAD: '店铺名称的候选过多，请改用店铺编码或网址。',
  STORE_RECONNECT_AND_RESOLVE: '买家连接已变化，请重新核对这家店铺。',
  STORE_CATALOG_CHANGED: '店铺商品清单在读取时发生变化，请重新核对店铺后读取。',
  STORE_CATALOG_EMPTY: '当前买家地区下没有可导入的商品。',
  STORE_CATALOG_PAGE_UNVERIFIED: '这一页的商品清单未能完整核对，请稍后重新读取。',
  STORE_PRODUCT_SCOPE_MISMATCH: '发现无法确认属于这家店铺的商品，导入已暂停。',
  STORE_FAVORITE_RECONCILIATION_REQUIRED: '店铺收藏结果待核对，请先到大健确认收藏状态。',
  STORE_RECEIPT_TIMEOUT: '等不到浏览器回执，请先核对连接和本次操作状态。'
};

export async function collectStore(resolved, getPage, progress, active) {
  const skus = new Set(), productIds = new Set();
  const pages = Math.ceil(resolved.total / resolved.pageSize);
  for (let page = 1; page <= pages; page++) {
    if (!active()) throw Error('STORE_VIEW_CLOSED');
    const result = await getPage(page);
    if (result.state !== 'store_page_read' || result.page !== page || result.total !== resolved.total ||
        result.store.id !== resolved.store.id || result.store.code !== resolved.store.code)
      throw Error('STORE_CATALOG_CHANGED');
    for (const item of result.items) {
      if (skus.has(item.sku) || productIds.has(item.productId)) throw Error('STORE_CATALOG_CHANGED');
      skus.add(item.sku);
      productIds.add(item.productId);
    }
    progress(skus.size, resolved.total);
    if (page < pages) await wait(350);
  }
  if (skus.size !== resolved.total) throw Error('STORE_CATALOG_CHANGED');
  return [...skus];
}

export function renderGigaStore(target, {site, available, onImported}) {
  const box = el('section', undefined, 'operation-preview');
  const input = el('input'), lookup = el('button', '核对店铺'), confirm = el('button', '收藏店铺并导入 SKU');
  const result = el('p'), status = el('p');
  input.type = 'text';
  input.maxLength = 512;
  input.placeholder = '例如 N616、AB STORE 或大健店铺网址';
  input.setAttribute('aria-label', '大健店铺名称、编码或网址');
  const enabled = available && !!window.edup?.maintenance;
  let resolved = null;
  const active = () => box.isConnected;
  confirm.hidden = true;
  lookup.disabled = !enabled;
  const reset = () => {
    resolved = null;
    confirm.hidden = true;
    result.textContent = '';
    status.textContent = '';
  };
  input.oninput = reset;

  async function run(action, args, timeout = 120000) {
    let task;
    // The bridge resumes heartbeats after the previous page finishes.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!active()) throw Error('STORE_VIEW_CLOSED');
      try {
        task = await window.edup.maintenance('giga-store-start', {site, action, ...args});
        break;
      } catch (error) {
        if (action === 'resolve' || attempt === 2 || !String(error.message).includes('GIGA_BROWSER_NOT_CONNECTED')) throw error;
        await wait(1000);
      }
    }
    const deadline = Date.now() + timeout;
    while (active() && Date.now() < deadline) {
      const receipt = await window.edup.maintenance('giga-browser-task', {id: task.id});
      if (receipt.state === 'stopped') throw Error(receipt.code);
      if (receipt.state.startsWith('store_')) return receipt;
      await wait(500);
    }
    throw Error(active() ? 'STORE_RECEIPT_TIMEOUT' : 'STORE_VIEW_CLOSED');
  }
  const failure = error => {
    if (!active()) return;
    const code = Object.keys(messages).find(key => String(error.message).includes(key));
    const detail = /^[A-Z0-9_]+$/.test(error.message) ? '（' + error.message + '）' : '';
    status.textContent = code ? messages[code] : '店铺处理已暂停，请核对浏览器连接和店铺状态。' + detail;
  };
  lookup.onclick = async () => {
    if (!enabled || !input.value.trim()) {
      status.textContent = messages.STORE_INPUT_INVALID;
      return;
    }
    reset();
    input.disabled = lookup.disabled = true;
    status.textContent = '正在核对店铺身份和商品数量…';
    try {
      resolved = await run('resolve', {input: input.value.trim()});
      if (resolved.state !== 'store_resolved') throw Error('STORE_RECEIPT_SCOPE_MISMATCH');
      result.textContent = resolved.store.name + ' · ' + resolved.store.code + ' · ' + resolved.total + ' 件商品';
      status.textContent = '请核对店铺，导入后会打开原有商品退货率筛选入口。';
      confirm.textContent = resolved.saved ? '导入已收藏店铺的 SKU' : '收藏店铺并导入 SKU';
      confirm.hidden = false;
    } catch (error) {
      failure(error);
    } finally {
      input.disabled = lookup.disabled = false;
    }
  };
  confirm.onclick = async () => {
    if (!resolved) return;
    const store = resolved;
    input.disabled = lookup.disabled = confirm.disabled = true;
    status.textContent = '正在读取店铺商品清单…';
    try {
      const codes = await collectStore(store, page => run('page', {ticket: store.id, page}),
        (done, total) => { status.textContent = '已核对 ' + done + ' / ' + total + ' 个 SKU。'; }, active);
      if (!active()) return;
      status.textContent = '正在复核清单和店铺收藏状态…';
      const timeout = Math.min(1500000, 120000 + Math.ceil(store.total / store.pageSize) * 5000);
      const saved = await run('save', {ticket: store.id}, timeout);
      if (saved.state !== 'store_saved' || saved.saved !== true) throw Error('STORE_FAVORITE_RECONCILIATION_REQUIRED');
      if (active()) onImported({store: store.store, codes});
    } catch (error) {
      failure(error);
    } finally {
      input.disabled = lookup.disabled = confirm.disabled = false;
    }
  };
  box.append(el('h3', '从大健店铺导入'), input, lookup, result, confirm, status);
  target.append(box);
}
