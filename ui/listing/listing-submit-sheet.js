// The submit sheet (spec §6.6). Moved out of listing-sheets.js unchanged (client round 1).
import {h, btn, dialog, feedback, money} from './listing-kit.js';
import {friendlyError} from '../common/notices.js';
import {SITE_NAME, isUnknown} from './listing-sheets-common.js';

const PREVIEW_MINUTES = 30;  // server previews live 1800 s
const groupBy = (rows, key) => rows.reduce((m, r) => m.set(key(r), [...(m.get(key(r)) || []), r]), new Map());

function quoteCost(store, root, sku) {
  const q = (store.job(root)?.result?.products || []).find(x => x.code === sku);
  if (!q || !Number.isFinite(Number(q.purchaseQuote))) return '—';
  const total = Number(q.purchaseQuote) + (Number(q.shippingQuote) || 0);
  return money(total) + (q.currency && q.currency !== 'USD' ? ' ' + q.currency : '');
}

function prepareMessage(error) {
  if (error?.message === 'NO_READY_PRODUCTS') return '没有可以提交的商品。已提交、处理中或待修正的商品不会重复提交。';
  const f = friendlyError(error);
  return f.title + '：' + f.message;
}

export function openSubmitSheet({cards, site, call, store, onDone}) {
  const ready = cards.filter(c => c.primary === 'confirm_submit' && c.rootJobId);
  const ui = dialog('确认提交到亚马逊' + (SITE_NAME[site] || site), {wide: true, onClose: onDone});
  const groups = [...groupBy(ready, c => c.rootJobId)].map(([root, rows]) => ({root, rows, codes: rows.map(c => c.sku),
    proposal: null, error: null, selected: new Set(), prev: new Map(), result: null, preparedAt: 0}));
  const names = new Map(ready.map(c => [c.sku, c.name]));
  let timer = null;

  async function prepare(g, codes) {
    g.error = null; g.result = null;
    for (const item of g.proposal?.preview?.items || []) g.prev.set(item.sku, Number(item.price));
    g.proposal = null;
    try {
      const p = await call('proposal_prepare', {action: {target: 'giga', operation: 'giga_batch_import', site, value: codes.join(','),
        batchJobId: g.root, reason: '用户在提交确认单里逐款核对售价和库存后确认'}});
      if (!p?.id || !p.hash || !Array.isArray(p.preview?.items)) throw Error('SUBMISSION_PREVIEW_MISSING');
      g.proposal = p; g.preparedAt = Date.now(); g.selected = new Set(p.preview.items.map(x => x.sku));
    } catch (error) { g.error = error; }
  }

  const minutesLeft = g => Math.max(0, Math.ceil(PREVIEW_MINUTES - (Date.now() - g.preparedAt) / 60000));
  const dirty = g => g.proposal && (g.selected.size !== g.proposal.preview.items.length ||
    g.proposal.preview.items.some(x => !g.selected.has(x.sku)));

  function render() {
    ui.body.replaceChildren();
    if (!groups.length) { ui.body.append(feedback('info', '没有可以提交的商品')); return; }
    let confirmable = 0;
    for (const g of groups) {
      const box = h('section', {class: 'lst-sheet-group'});
      if (groups.length > 1) box.append(h('h3', {}, '批次 ' + g.root.slice(0, 8)));
      if (g.result) box.append(resultView(g));
      else if (g.error) box.append(feedback('error', '这批暂时整理不出确认单', prepareMessage(g.error), g.error?.message || ''),
        btn('重新整理', async () => { await prepare(g, g.codes); render(); }));
      else if (!g.proposal) box.append(h('p', {class: 'muted'}, '正在整理售价和库存…'));
      else {
        const p = g.proposal, expired = minutesLeft(g) === 0;
        const rows = p.preview.items.map(x => {
          const check = h('input', {type: 'checkbox', 'aria-label': '提交 ' + x.sku});
          check.checked = g.selected.has(x.sku);
          check.addEventListener('change', () => { check.checked ? g.selected.add(x.sku) : g.selected.delete(x.sku); render(); });
          const before = g.prev.get(x.sku), price = Number(x.price);
          const note = Number.isFinite(before) && before !== price ? '售价比上一版' + (price > before ? '高 ' : '低 ') + money(Math.abs(price - before)) : '';
          return h('tr', {class: note ? 'is-changed' : ''}, h('td', {}, check), h('td', {}, h('strong', {}, x.sku)),
            h('td', {}, names.get(x.sku) || '—'), h('td', {class: 'num'}, money(price)), h('td', {class: 'num'}, quoteCost(store, g.root, x.sku)),
            h('td', {}, Number(x.quantity) === 0 ? '0（只建链接）' : String(x.quantity)), h('td', {}, note));
        });
        box.append(h('table', {class: 'lst-table'}, h('thead', {}, h('tr', {}, ['', '编码', '商品', '售价 USD', '采购+运费', '本次库存', '注意']
          .map(t => h('th', {}, t)))), h('tbody', {}, rows)));
        const skipped = p.preview.skipped || [];
        if (skipped.length) box.append(h('div', {class: 'lst-skipped'}, h('strong', {}, '不会提交的 ' + skipped.length + ' 款：'),
          h('ul', {}, skipped.map(s => h('li', {}, s.sku + ' · ' + (s.reason ? friendlyError(s.reason).message : '还没准备好'))))));
        if (dirty(g)) box.append(feedback('info', '你改了勾选', '按新的勾选重新整理以后才能确认。'),
          btn('按勾选重新整理', async () => { await prepare(g, [...g.selected]); render(); }));
        else if (expired) box.append(feedback('info', '这张单已过期', '售价和库存要重新整理。'),
          btn('重新整理', async () => { await prepare(g, g.codes); render(); }));
        else { confirmable += g.selected.size; box.append(h('p', {class: 'muted'}, '这张单约 ' + minutesLeft(g) + ' 分钟内有效。')); }
      }
      ui.body.append(box);
    }
    const pending = groups.filter(g => g.proposal && !g.result && !dirty(g) && minutesLeft(g) > 0 && g.selected.size);
    ui.body.append(h('p', {class: 'lst-note'}, '新链接先以库存 0 建立，暂不接单。后续由系统核对刊登属性、图片和平台报价，开卖状态以库存同步结果为准。'),
      h('div', {class: 'lst-actions'}, h('button', {type: 'button', onclick: () => ui.close()}, groups.some(g => g.result) ? '关闭' : '取消'),
        pending.length ? btn('确认提交这 ' + confirmable + ' 款', async () => {
          for (const g of pending) await decide(g);
          render(); onDone?.();
        }, {primary: true}) : null));
  }

  async function decide(g) {
    try {
      const response = await call('proposal_decide', {id: g.proposal.id, hash: g.proposal.hash, decision: 'confirm'});
      const decision = response?.proposal || response;
      if (decision?.state === 'rejected') {
        let proof = decision;
        if (typeof decision.result === 'string') { try { proof = JSON.parse(decision.result); } catch { /* keep */ } }
        if (proof?.outcome === 'not_admitted') { g.result = {kind: 'not_admitted', code: proof.code}; return; }
      }
      g.result = ['submitted', 'queued', 'running', 'completed'].includes(decision?.state) ? {kind: 'ok', count: g.selected.size} : {kind: 'unknown'};
    } catch (error) {
      g.result = isUnknown(error) ? {kind: 'unknown'} : {kind: 'error', error};
    }
  }

  function resultView(g) {
    if (g.result.kind === 'ok') return feedback('success', '已交给服务器提交 ' + g.result.count + ' 款', '可以关掉这个窗口。结果会出现在清单里，关掉软件也不会丢。');
    if (g.result.kind === 'not_admitted') return h('div', {}, feedback('info', '这次没有进入提交', friendlyError(g.result.code).message, g.result.code || ''),
      btn('重新整理', async () => { await prepare(g, g.codes); render(); }));
    if (g.result.kind === 'unknown') return feedback('unknown', '结果待确认：可能已经提交',
      '没收到明确结果。先关掉这个窗口，在清单里点「核对结果」。不要重复提交。');
    const f = friendlyError(g.result.error);
    return h('div', {}, feedback('error', f.title, f.message + ' 这次没有提交。', f.code), btn('重新整理', async () => { await prepare(g, g.codes); render(); }));
  }

  render();
  (async () => { for (const g of groups) { await prepare(g, g.codes); render(); } })();
  timer = setInterval(() => { if (ui.closed) clearInterval(timer); else if (groups.some(g => g.proposal && !g.result)) render(); }, 30000);
}
