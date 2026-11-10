import {el, table} from './analytics.js';

const stages = {
  not_started: '尚未开始', excluded_by_return_rate: '退货率未通过',
  screened: '已核验退货率', preparing: '准备中', needs_input: '需要补资料',
  preparation_problem: '准备遇到问题', prepared: '已准备',
  submission_check: '提交待核对', submitted: '已提交',
};

export function skuListError(error) {
  return String(error?.message || error).match(/\b(?:SKU_LIST_[A-Z_]+|LISTING_SITE_NOT_READY|AI_REQUEST_INVALID|OUTCOME_UNKNOWN)\b/g)?.join(' · ') || 'REQUEST_FAILED';
}

// `id` lets the caller keep the backup id with its own list so a later retry is the same save;
// `onState` hears 'saved' / 'failed' so the caller can remember the outcome across restarts.
export function backupSkuList(call, {id = crypto.randomUUID(), site, source, codes, store, label, onState}) {
  const args = {id, site, source, codes: [...new Set(codes)]};
  if (store) args.store = {id: store.id, name: store.name, url: store.url};
  if (label) args.label = String(label).slice(0, 120);
  const record = {state: 'saving', error: ''};
  const listeners = new Set();
  let active;
  const save = () => {
    if (active || record.state === 'saved') return active;
    record.state = 'saving';
    active = Promise.resolve().then(() => call('sku_list_save', args)).then(receipt => {
      if (receipt?.saved !== true || receipt.id !== args.id) throw Error('SKU_LIST_RECEIPT_INVALID');
      record.state = 'saved';
    }).catch(error => {
      record.state = 'failed';
      record.error = skuListError(error);
    }).finally(() => {
      active = null;
      try { onState?.(record.state, record.error); } catch { /* the caller's bookkeeping must not break the save */ }
      for (const render of listeners) render();
    });
    return active;
  };
  save();
  record.render = target => {
    const update = () => {
      if (!target.isConnected && record.state !== 'saving') listeners.delete(update);
      target.replaceChildren(el('p', record.state === 'saved' ? '已备份到服务器。'
        : record.state === 'saving' ? '正在备份清单…' : '清单备份未确认，本机识别结果仍可用。' + '（' + record.error + '）'));
      if (record.state === 'failed') {
        const retry = el('button', '重试备份');
        retry.onclick = () => { save(); update(); };
        target.append(retry);
      }
    };
    listeners.add(update);
    update();
  };
  return record;
}

export function skuListPanel({call, site, offline, onResume, onRestore}) {
  const box = el('details', undefined, 'operation-preview');
  const list = el('select'), body = el('div'), status = el('p'), refresh = el('button', '刷新清单');
  list.setAttribute('aria-label', '已备份的 SKU 清单');
  list.disabled = true;
  refresh.disabled = offline;
  let sequence = 0;
  const show = async () => {
    const id = list.value, request = ++sequence;
    body.replaceChildren();
    if (!id) return;
    status.textContent = '正在读取服务器进度…';
    try {
      const result = await call('sku_list_status', {id});
      if (request !== sequence) return;
      if (result.id !== id || result.site !== site) throw Error('SKU_LIST_RECEIPT_INVALID');
      status.textContent = '共 ' + result.total + ' 款，剩余 ' + result.remaining.length + ' 款。';
      const groups = new Map();
      for (const row of result.items) {
        if (!groups.has(row.stage)) groups.set(row.stage, []);
        groups.get(row.stage).push(row.sku);
      }
      for (const [stage, skus] of groups) {
        const group = el('details');
        group.append(el('summary', (stages[stage] || stage) + '（' + skus.length + ' 款）'), el('p', skus.join('、')));
        body.append(group);
      }
      const resume = el('button', '继续剩下的');
      resume.disabled = result.remaining.length === 0;
      resume.onclick = () => onResume(result.remaining);
      if (onRestore) {
        const restore = el('button', '恢复为 100 款分组存档');
        restore.onclick = async () => {
          restore.disabled = true;
          try { await onRestore(result); }
          catch (error) { status.textContent = '恢复失败（' + skuListError(error) + '）。'; }
          finally { restore.disabled = false; }
        };
        body.append(restore);
      } else body.append(resume);
    } catch (error) {
      if (request === sequence) status.textContent = '读取清单进度失败（' + skuListError(error) + '）。';
    }
  };
  const load = async () => {
    ++sequence;
    refresh.disabled = list.disabled = true;
    status.textContent = '正在读取已备份清单…';
    const current = list.value;
    try {
      const result = await call('sku_list_index', {limit: 100});
      list.replaceChildren();
      for (const row of result.lists.filter(row => row.site === site)) {
        const option = el('option', (row.label || row.store?.name || ({paste: '粘贴', file: '文件', store: '店铺'}[row.source] || row.source))
          + ' · ' + row.total + ' 款 · ' + new Date(row.savedAt * 1000).toLocaleString('zh-CN'));
        option.value = row.id;
        list.append(option);
      }
      if ([...list.options].some(option => option.value === current)) list.value = current;
      body.replaceChildren();
      if (!list.options.length) status.textContent = '当前站点没有已备份清单。';
      else await show();
    } catch (error) {
      status.textContent = '读取清单失败（' + skuListError(error) + '）。';
    } finally {
      list.disabled = !list.options.length;
      refresh.disabled = false;
    }
  };
  refresh.onclick = load;
  list.onchange = show;
  box.addEventListener('toggle', () => { if (box.open && !offline) load(); });
  if (offline) status.textContent = '连接服务器后可查看清单进度。';
  box.append(el('summary', '清单进度'), refresh, list, status, body);
  return box;
}

export function renderModelUsage(target, usage) {
  target.replaceChildren(el('h3', '模型用量'));
  if (!usage?.available) {
    target.append(el('p', '暂未取得模型用量。'));
    return;
  }
  target.append(el('p', '最近 ' + usage.days + ' 天 · 当前占用 ' + usage.activeNow + ' / ' + usage.maxActive
    + ' · 未结案 ' + usage.unresolvedTotal + ' 次'));
  if (usage.byModel.length) target.append(table(['模型', '请求次数', '输入 token', '输出 token'],
    usage.byModel.map(row => [row.key, row.requests, row.inputTokens, row.outputTokens])));
}
