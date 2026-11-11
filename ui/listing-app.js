// The listing workspace ("上架"), semi-automatic since 0.8.7 (user decision 2026-11-11):
// the client only takes SKUs / a 大健 store, reads return rates in the 大健 page, and hands the
// SKUs that passed to the server. Everything after that (AI preparation, checks, Amazon listing,
// missing facts) is handled on the server back end and is no longer shown or driven from here.
// Mounted once and only hidden when another tab is open, so a running screening is never torn
// down by a re-render.
import {h, btn, feedback, bjt} from './listing-kit.js';
import {createStore} from './listing-store.js';
import {runner, local, browserState} from './listing-runner.js';
import {renderGigaStore} from './giga-store.js';
import {backupSkuList, skuListPanel} from './giga-lists.js';
import {extractCodes} from './sku-rules.js';
import {notify} from './notices.js';
import {archiveGroups, groupTask, restoredArchive} from './listing-groups.js';
import {storageMessage} from './storage-state.js';

const PAGES = [['lists', '清单'], ['new', '新建清单'], ['uploaded', '已上传合格']];
// The only things the operator needs to know about one SKU in semi-automatic mode.
const STATUS = Object.freeze({
  wait: {name: '待筛选', badge: 'none'},
  busy: {name: '筛选中', badge: 'program'},
  retry: {name: '要重新筛选', badge: 'you'},
  uploaded: {name: '已上传服务器', badge: 'done'},
  off: {name: '已排除', badge: 'off'},
});
const FILTERS = [['all', '全部'], ['wait', '待筛选'], ['retry', '要重新筛选'], ['uploaded', '已上传'], ['off', '已排除']];
const keyOf = c => (c.listId || '') + '|' + c.sku;

// Server jobs exist only for SKUs whose return rate passed: the job itself is the upload receipt.
export function semiStatus(c) {
  if (['excluded', 'skipped'].includes(c.stage)) return 'off';
  if (c.jobId) return 'uploaded';
  if (c.stage === 'screening') return c.primary === 'rescreen' ? 'retry' : 'busy';
  return 'wait';
}
const semiText = (c, s) => s === 'uploaded' ? '退货率合格，已交给服务器；后续由服务器后台处理'
  : s === 'off' || s === 'retry' ? c.headline : s === 'busy' ? '正在大健页面读取退货率' : '还没筛选';
const matches = (c, f) => f === 'all' || semiStatus(c) === f || (f === 'wait' && semiStatus(c) === 'busy');

export function mountListing(root, {call, getSnapshot, isOffline}) {
  const store = createStore({call, getSnapshot, isOffline});
  const backups = new Map();
  // Backs a local list up to the server and remembers the outcome on the list itself.
  function startBackup(list, sourceStore) {
    const backupId = list.backupId || crypto.randomUUID();
    if (!list.backupId) local.setBackup(list.id, {backupId});
    backups.set(list.id, backupSkuList(call, {id: backupId, site: list.site, source: list.source, codes: list.codes, store: sourceStore || list.store, label: list.label,
      onState: (state, error) => local.setBackup(list.id, state === 'saved' ? {backup: 'saved', backupError: ''} : {backup: 'failed', backupError: error || ''})}));
  }
  let route = {page: 'lists'}, visible = false, helpOpen = false, renderedPage = '', timer = null, ticks = 0;
  const selected = new Set(), rows = new Map();
  const selectedGroups = new Set();
  let serverLists, serverListsScope;
  const wizard = {step: 1, source: 'paste', text: '', extraction: null, skipKnown: true, label: ''};

  const bar = h('div', {class: 'lst-bar'}), runnerBox = h('div', {class: 'lst-runner'}), page = h('div', {class: 'lst-page'});
  root.classList.add('lst');
  root.replaceChildren(bar, runnerBox, page);

  const go = next => { route = next; selected.clear(); render(true); page.scrollIntoView?.({block: 'start'}); };
  const offline = () => isOffline();
  // Only lists made on a client; old server AI batches belong to the back end now.
  const myLists = () => store.lists().filter(l => l.source === 'local');
  const allCards = () => myLists().flatMap(l => store.cardsFor(l));

  // ---------- actions ----------
  // Screening again is the only thing left to do from here; it never targets an uploaded SKU.
  function rescreen(cards) {
    if (store.service?.storage?.blocked) throw Error(store.service.storage.code || 'GIGA_SERVER_STORAGE_LOW');
    const byList = new Map();
    for (const c of cards.filter(x => ['wait', 'retry'].includes(semiStatus(x))))
      byList.set(c.listId, [...(byList.get(c.listId) || []), c.sku]);
    for (const [listId, codes] of byList) runner.start({kind: 'prepare', site: store.site, codes, listId, fresh: true, label: '重新筛选'});
    if (byList.size) notify({level: 'success', title: '已开始重新筛选', message: '进度显示在上方。切到别的页面也会继续。'});
  }
  function skip(cards, on) { for (const c of cards) local.setSkip(store.site, c.sku, on); store.touch(); }

  // ---------- top bar ----------
  function renderBar() {
    const site = h('select', {'aria-label': '上架站点'});
    const options = store.sites?.sites || [];
    for (const s of options) { const o = h('option', {value: s.code}, s.name || s.code); site.append(o); }
    if (!options.length) site.append(h('option', {value: ''}, store.sites ? '暂时读不到可用站点' : '正在读取站点…'));
    site.value = store.site; site.disabled = !options.length || runner.busy();
    site.addEventListener('change', () => { store.setSite(site.value); go({page: route.page === 'list' ? 'lists' : route.page}); });
    const b = browserState(store.browser, store.site, runner.busy() && runner.state.need !== 'browser');
    const pill = h('button', {type: 'button', class: 'lst-pill lst-pill--' + b.tone, 'aria-expanded': String(helpOpen),
      onclick: () => { helpOpen = !helpOpen; render(); }}, '大健 · ' + b.label);
    const server = h('span', {class: 'lst-pill lst-pill--' + (offline() ? 'red' : 'green')}, offline() ? '服务器 · 连不上' : '服务器 · 在线');
    const nav = h('nav', {class: 'lst-subnav', 'aria-label': '上架页面'}, PAGES.map(([key, name]) =>
      h('button', {type: 'button', class: (route.page === key || (key === 'lists' && route.page === 'list')) ? 'is-on' : '',
        onclick: () => go({page: key})}, name)));
    bar.replaceChildren(...[h('div', {class: 'lst-bar-row'}, h('label', {class: 'lst-site'}, '站点 ', site), pill, server), nav,
      helpOpen ? connectionHelp(b) : null].filter(Boolean));
  }

  function connectionHelp(b) {
    const folder = h('input', {readonly: true, class: 'lst-folder', 'aria-label': '大健扩展目录', value: '正在读取扩展目录…'});
    window.edup?.maintenance?.('giga-browser-folder').then(v => { folder.value = v.directory || '本机扩展目录还没准备好'; })
      .catch(() => { folder.value = '本机连接组件还没安装，请先完成设置'; });
    const ins = store.browser?.inspection || {};
    const steps = [
      ['本机连接组件已安装', b.key !== 'setup' && b.key !== 'desktop'],
      ['Chrome 扩展是最新版', !['setup', 'update', 'desktop'].includes(b.key) && store.browser?.extensionProtocol === 4],
      ['大健页面已连接（心跳正常）', !!store.browser?.connected || b.key === 'busy'],
      ['已登录大健买家账号', ins.loggedIn === true && ins.buyer === true],
      ['账号地区和所选站点一致', b.key === 'ok' || b.key === 'busy'],
    ];
    return h('section', {class: 'lst-help'}, h('h3', {}, '连接大健页面'),
      h('ul', {class: 'lst-checks'}, steps.map(([t, ok]) => h('li', {class: ok ? 'ok' : 'bad'}, (ok ? '✓ ' : '✗ ') + t))),
      h('ol', {}, ['第一次用：在 Chrome 地址栏输入 chrome://extensions/，打开右上角「开发者模式」。',
        '点「加载已解压的扩展程序」，选下面这个目录。这一步要你自己在 Chrome 里点，工作台不会替你操作浏览器。',
        '已经装过、提示要更新时：在扩展页找到「大健本机连接」，点「重新加载」。',
        '打开并登录对应地区的大健买家页面，点扩展里的「连接此大健页」。',
        '回到这里，上面这几项会自动打勾。账号或地区不对时不会自动切换，请自己换账号。'].map(t => h('li', {}, t))),
      h('div', {class: 'lst-actions'}, folder, btn('复制目录', async () => { await window.edup.maintenance('giga-browser-copy-folder'); notify({level: 'success', title: '已复制扩展目录'}); }),
        btn('重新检查', async () => { await store.refreshBrowser(); render(); })),
      h('p', {class: 'muted'}, '连接只授权你选定的那个大健页面；Cookie 留在浏览器里。可以随时在扩展里断开。'));
  }

  // ---------- runner banner ----------
  function renderRunner() {
    const s = runner.state, interrupted = runner.interrupted();
    runnerBox.replaceChildren();
    const storage = store.service?.storage;
    if (storage?.blocked) runnerBox.append(feedback('error','服务器存储不足',storageMessage(storage),storage.code || 'GIGA_SERVER_STORAGE_LOW'));
    if (s.phase === 'idle' && (interrupted || runner.savedQueue().length)) {
      runnerBox.append(h('div', {class: 'lst-banner lst-banner--info'}, h('strong', {}, interrupted ? '上次有一份没做完：' + (interrupted.label || '筛选') + '（' + interrupted.codes.length + ' 款）' : '还有保存的待执行分组'),
        h('span', {class: 'muted'}, '已经上传到服务器的段会保留，继续时只做剩下的。'),
        h('div', {class: 'lst-actions'}, btn('继续', () => runner.resumeSaved(), {primary: true}),
          btn('清空待执行队列（保留存档）', () => { runner.discardPending(); render(); }))));
      return;
    }
    if (s.phase === 'idle') return;
    const leftovers = s.phase === 'done' ? (s.failedCodes || []) : [];
    const tone = s.phase === 'error' ? (s.unknown ? 'unknown' : 'error') : s.phase === 'need' || leftovers.length ? 'warn' : s.phase === 'done' ? 'success' : 'info';
    const head = s.phase === 'running' || s.phase === 'queued' ? (s.label || '处理中') + (s.segments > 1 ? ' · 第 ' + (s.segment || 1) + '/' + s.segments + ' 段' : '')
      : s.phase === 'need' ? (s.need === 'verify' ? '大健要求人工验证' : s.need === 'detail' ? '请检查大健商品页面' : '等大健页面连好') : s.phase === 'done' ? (leftovers.length ? '完成，有 ' + leftovers.length + ' 款没做成' : '完成')
      : s.phase === 'paused' ? '已暂停' : s.unknown ? '结果待确认' : '没完成';
    const box = h('div', {class: 'lst-banner lst-banner--' + tone, role: s.phase === 'error' ? 'alert' : 'status'},
      ['running', 'queued'].includes(s.phase) ? h('span', {class: 'lst-spinner', 'aria-hidden': 'true'}) : null,
      h('strong', {}, head), h('span', {}, s.message || ''),
      s.total ? h('span', {class: 'muted'}, '清单已处理 ' + (s.done || 0) + '/' + s.total + ' 款' + (s.recovered ? '（恢复已有进度 ' + s.recovered + ' 款）' : '') + (s.excluded ? '（退货率不合格排除 ' + s.excluded + ' 款）' : '')
        + (s.phase === 'running' && s.failed ? '；' + s.failed + ' 款自动重试后仍没做成，最后可一键重试' : '')) : null,
      s.queue ? h('span', {class: 'muted'}, '后面还有 ' + s.queue + ' 项排队') : null);
    const actions = h('div', {class: 'lst-actions'});
    if (s.phase === 'running' && s.segments > 1 && !s.stopping) actions.append(btn('这一段完成后暂停', () => runner.stop()));
    if (s.phase === 'need' && ['verify', 'detail'].includes(s.need)) actions.append(btn(s.need === 'detail' ? '已检查页面，继续' : '已完成验证，继续', () => runner.continue(), {primary: true}),
      btn('取消', () => runner.cancel()));
    else if (s.phase === 'need') actions.append(btn('已连好，继续', () => runner.continue(), {primary: true}), btn('打开连接说明', () => { helpOpen = true; render(); }),
      btn('取消', () => runner.cancel()));
    if (s.phase === 'paused' && (s.left?.length || runner.savedQueue().length)) actions.append(btn('继续剩下的', () => runner.resumeSaved(), {primary: true}));
    if (['paused','error'].includes(s.phase) && runner.savedQueue().length) actions.append(btn('清空待执行队列（保留存档）', () => { runner.discardPending(); render(); }));
    if (leftovers.length) actions.append(btn('重试没做成的 ' + leftovers.length + ' 款', () => {
      const t = s.task; runner.dismiss(); runner.forgetInterrupted();
      runner.start({...t, codes: leftovers, fresh: true, label: (s.label || '筛选') + ' · 重试'});
    }, {primary: true}));
    if (s.phase === 'error' && s.need === 'rescreen') actions.append(btn('重新筛选这一批', () => { const t = s.task; runner.dismiss(); runner.start({...t, fresh: true}); }, {primary: true}));
    if (s.reconcileId) actions.append(btn('核对上次收藏结果', async () => {
      const r = await runner.reconcile(s.reconcileId);
      notify({level: 'info', title: r.excluded.length ? '还有收藏待核对' : '收藏已核对', message: r.excluded.length ? '这些商品不会重复发送。' : '可以继续。'});
    }));
    if (['done', 'paused', 'error'].includes(s.phase)) actions.append(btn('知道了', () => runner.dismiss()));
    if (s.error?.code) box.append(h('details', {}, h('summary', {}, '排查编号'), h('code', {}, [s.error.code, s.error.requestId].filter(Boolean).join(' · '))));
    box.append(actions);
    runnerBox.append(box);
  }

  // ---------- pages ----------
  function counts(cards) {
    const n = {wait: 0, busy: 0, retry: 0, uploaded: 0, off: 0};
    for (const c of cards) n[semiStatus(c)]++;
    return n;
  }
  function strip(cards) {
    const n = counts(cards);
    return h('div', {class: 'lst-strip'}, ['wait', 'busy', 'retry', 'uploaded', 'off'].map(k =>
      h('span', {class: n[k] ? 'has' : ''}, STATUS[k].name + ' ', h('b', {}, String(n[k])))));
  }
  const statusBadge = s => h('span', {class: 'lst-badge lst-badge--' + STATUS[s].badge}, STATUS[s].name);

  function listTable(lists, title) {
    return h('section', {class: 'lst-card'}, h('h2', {}, title), h('table', {class: 'lst-table'},
      h('thead', {}, h('tr', {}, ['清单', '建立时间', '商品', '进度', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, lists.map(l => {
        const n = counts(store.cardsFor(l));
        return h('tr', {class: 'lst-click', onclick: () => go({page: 'list', id: l.id})}, h('td', {}, h('strong', {}, l.label || '清单')),
          h('td', {}, bjt(l.created)), h('td', {}, String(l.codes.length) + ' 款'),
          h('td', {}, '已上传 ' + n.uploaded + ' · 已排除 ' + n.off + ' · 待筛选 ' + (n.wait + n.busy + n.retry)),
          h('td', {}, h('button', {type: 'button'}, '打开')));
      }))));
  }

  function lists() {
    const all = myLists();
    const scope = store.site + ':' + offline();
    if (scope !== serverListsScope) {
      serverListsScope = scope;
      serverLists = skuListPanel({call, site: store.site, offline: offline(),
        onResume: codes => runner.start({kind: 'prepare', site: store.site, codes, label: '继续服务器备份清单'}),
        onRestore: result => {
          const existing = local.lists().find(l => l.backupId === result.id);
          const restored = existing || restoredArchive(result);
          if (!existing) local.saveList(restored);
          local.ensureGroups(restored.id); go({page: 'list', id: restored.id});
        }});
      serverLists.querySelector('summary').textContent = '服务器备份清单';
    }
    const intro = h('section', {class: 'lst-card'}, h('h2', {}, '半自动上架'),
      h('p', {class: 'muted'}, '这里只做三件事：加入 SKU 或大健店铺 → 在大健页面读退货率 → 退货率合格的上传到服务器。'
        + 'AI 填资料、核验和上架都在服务器后台处理，这里不再显示。'));
    const current = all.length ? listTable(all, '全部清单（' + all.length + '）')
      : h('section', {class: 'lst-empty'}, h('h2', {}, '还没有清单'), btn('新建清单', () => go({page: 'new'}), {primary: true}));
    return [intro, current, serverLists];
  }

  function listPage() {
    const list = store.list(route.id);
    if (!list || list.source !== 'local') return [feedback('info', '找不到这份清单', '可能已经切换了站点。'), btn('回到清单', () => go({page: 'lists'}))];
    const ownArchive = local.ensureGroups(list.id);
    const groups = ownArchive ? archiveGroups(ownArchive) : [];
    const focused = groups.find(g => g.id === route.groupId);
    const scope = focused ? new Set(focused.codes) : null;
    const all = sorted(store.cardsFor(list).filter(c => !scope || scope.has(c.sku)));
    const filter = route.filter || 'all', q = (route.q || '').trim().toUpperCase();
    const shown = all.filter(c => matches(c, filter) && (!q || c.sku.includes(q)));
    const header = h('div', {class: 'lst-list-head'}, h('button', {type: 'button', onclick: () => go({page: 'lists'})}, '← 返回'),
      h('h2', {}, list.label || '清单'), h('span', {class: 'muted'}, bjt(list.created) + ' · ' + list.codes.length + ' 款'));
    const backup = backups.get(list.id);
    const backupBox = h('div', {class: 'lst-backup'});
    if (backup) backup.render(backupBox);
    else {
      const own = local.lists().find(x => x.id === list.id);
      if (own && own.backup !== 'saved') backupBox.append(feedback('warn', '这份清单还没备份到服务器',
        '现在只存在这台电脑上：换电脑、重装或本机数据丢失就找不回来，服务器也看不到它的进度。' + (own.backupError ? '上次失败原因：' + own.backupError + '。' : ''), ''),
        h('div', {class: 'lst-actions'}, btn('备份到服务器', () => { startBackup(own); render(true); }, {primary: true})));
    }
    const chips = h('div', {class: 'lst-chips'}, FILTERS.map(([k, name]) => h('button', {type: 'button', class: filter === k ? 'is-on' : '',
      dataset: {filter: k}, onclick: () => { route = {...route, filter: k}; selected.clear(); render(true); }}, name + ' ' + all.filter(c => matches(c, k)).length)),
      (() => { const input = h('input', {type: 'search', placeholder: '搜索编码', 'aria-label': '搜索商品', value: route.q || ''});
        input.addEventListener('input', () => { route = {...route, q: input.value}; renderTableOnly(); }); return input; })());
    const tbody = h('tbody');
    const table = h('table', {class: 'lst-table lst-products'}, h('thead', {}, h('tr', {}, ['', '商品', '状态', '说明', ''].map(t => h('th', {}, t)))), tbody);
    rows.clear();
    fillRows(tbody, shown);
    const bulk = h('div', {class: 'lst-bulk'});
    renderBulk(bulk, all);
    const archives = ownArchive ? h('section', {class: 'lst-card'}, h('h3', {}, '商品分组存档 · 每组最多 100 款'),
      h('p', {class: 'muted'}, '勾选一组或多组再执行：逐批读退货率，合格的上传到服务器。关闭软件后可继续；这里不会提交到亚马逊。'),
      h('div', {class: 'lst-actions'},
        btn('全选组', () => { for (const g of groups) selectedGroups.add(g.id); render(true); }),
        btn('清空选择', () => { for (const g of groups) selectedGroups.delete(g.id); render(true); }),
        btn('执行选中的 ' + groups.filter(g => selectedGroups.has(g.id)).length + ' 组', async () => {
          const picked = groups.filter(g => selectedGroups.has(g.id));
          const done = new Set(store.cardsFor(list).filter(c => ['uploaded', 'off'].includes(semiStatus(c))).map(c => c.sku));
          // Cross-PC restoration has no local request journal. Check server ownership first;
          // SKUs the server already holds are never sent again from here.
          if (ownArchive.backup === 'saved' && ownArchive.backupId) {
            const saved = await call('sku_list_status', {id: ownArchive.backupId});
            if (saved.id !== ownArchive.backupId || saved.site !== ownArchive.site ||
                JSON.stringify(saved.items.map(row => row.sku)) !== JSON.stringify(ownArchive.codes)) throw Error('SKU_LIST_RECEIPT_INVALID');
            for (const row of saved.items) if (!['not_started','screened'].includes(row.stage)) done.add(row.sku);
          }
          let count = 0;
          for (const g of picked) {
            const task = groupTask(ownArchive, g);
            const codes = task.codes.filter(sku => !done.has(sku));
            if (codes.length) { runner.start({...task, codes}); count += codes.length; }
          }
          notify({level:'info', title: count ? '已安排 ' + count + ' 款' : '所选分组没有待筛选的商品',
            message: count ? '进度显示在上方。合格的会出现在「已上传合格」。' : '已上传或已排除的商品不会重复筛选。'});
          selectedGroups.clear(); render(true);
        }, {primary: true, disabled: offline() || store.service?.storage?.blocked || !groups.some(g => selectedGroups.has(g.id))}),
        btn('查看全部商品', () => go({page: 'list', id: list.id}))),
      h('table', {class: 'lst-table'}, h('thead', {}, h('tr', {}, ['选择', '分组', '商品数', '进度', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, groups.map(g => {
          const check = h('input', {type: 'checkbox', 'aria-label': '选择' + g.label}); check.checked = selectedGroups.has(g.id);
          check.addEventListener('change', () => { check.checked ? selectedGroups.add(g.id) : selectedGroups.delete(g.id); render(true); });
          return h('tr', {}, h('td', {}, check), h('td', {}, g.label), h('td', {}, String(g.codes.length)),
            h('td', {class:'lst-archive-progress', dataset:{group:g.id}}, groupProgress(list, g)),
            h('td', {}, btn('查看本组', () => go({page: 'list', id: list.id, groupId: g.id}))));
        })))) : null;
    return [header, backupBox, archives, focused ? h('p', {}, '当前查看：' + focused.label) : null,
      strip(all), chips, shown.length ? table : h('p', {class: 'muted lst-empty-row'}, '这一类没有商品。'), bulk];
  }

  function groupProgress(list, g) {
    const wanted = new Set(g.codes), n = counts(store.cardsFor(list).filter(c => wanted.has(c.sku)));
    return '待筛选 ' + (n.wait + n.busy + n.retry) + ' · 已上传 ' + n.uploaded + ' · 已排除 ' + n.off;
  }

  const ORDER = ['busy', 'retry', 'wait', 'uploaded', 'off'];
  const sorted = cards => [...cards].sort((a, b) => ORDER.indexOf(semiStatus(a)) - ORDER.indexOf(semiStatus(b)) || a.sku.localeCompare(b.sku));

  function fillRows(tbody, cards) {
    const keep = new Set();
    for (const c of cards) {
      const key = keyOf(c), s = semiStatus(c); keep.add(key);
      const sig = JSON.stringify([s, c.stage, c.headline, selected.has(key), offline(), runner.busy()]);
      let row = rows.get(key);
      if (!row) { row = {tr: h('tr'), sig: ''}; rows.set(key, row); }
      if (row.sig !== sig) {
        row.sig = sig;
        const check = h('input', {type: 'checkbox', 'aria-label': '选择 ' + c.sku});
        check.checked = selected.has(key);
        check.addEventListener('change', () => { check.checked ? selected.add(key) : selected.delete(key); renderTableOnly(); });
        const next = s === 'retry' ? btn('重新筛选', () => rescreen([c]), {disabled: offline() || runner.busy()})
          : c.stage === 'skipped' ? btn('恢复', () => skip([c], false)) : h('span', {class: 'muted'}, '—');
        row.tr.replaceChildren(h('td', {}, check), h('td', {}, h('strong', {}, c.sku)), h('td', {}, statusBadge(s)),
          h('td', {}, semiText(c, s)), h('td', {}, next));
      }
      tbody.append(row.tr);
    }
    for (const [key, row] of rows) if (!keep.has(key)) { row.tr.remove(); rows.delete(key); }
  }

  function renderBulk(bulk, all) {
    const picked = all.filter(c => selected.has(keyOf(c)));
    bulk.replaceChildren();
    if (!picked.length) return;
    bulk.append(h('strong', {}, '选中 ' + picked.length + ' 款：'));
    const open = picked.filter(c => ['wait', 'retry'].includes(semiStatus(c)));
    if (open.length) {
      bulk.append(btn('重新筛选 ' + open.length + ' 款', () => rescreen(open), {primary: true, disabled: offline() || runner.busy()}));
      bulk.append(btn('不筛这 ' + open.length + ' 款', () => { skip(open, true); selected.clear(); }));
    }
    bulk.append(h('button', {type: 'button', onclick: () => { selected.clear(); renderTableOnly(); }}, '取消选择'));
  }

  function renderTableOnly() {
    if (route.page !== 'list') return;
    const list = store.list(route.id);
    if (!list) return;
    const group = list.groups?.find(g => g.id === route.groupId), scope = group ? new Set(group.codes) : null;
    const all = sorted(store.cardsFor(list).filter(c => !scope || scope.has(c.sku)));
    const filter = route.filter || 'all', q = (route.q || '').trim().toUpperCase();
    const shown = all.filter(c => matches(c, filter) && (!q || c.sku.includes(q)));
    const tbody = page.querySelector('.lst-products tbody');
    if (list.groups) for (const cell of page.querySelectorAll('.lst-archive-progress')) {
      const g = list.groups.find(x => x.id === cell.dataset.group);
      if (g) cell.textContent = groupProgress(list, g);
    }
    if (tbody) fillRows(tbody, shown);
    page.querySelector('.lst-strip')?.replaceWith(strip(all));
    for (const b of page.querySelectorAll('.lst-chips button[data-filter]')) {
      const k = b.dataset.filter, name = FILTERS.find(f => f[0] === k)[1];
      b.textContent = name + ' ' + all.filter(c => matches(c, k)).length;
    }
    if (!tbody && shown.length) { render(true); return; }
    const bulk = page.querySelector('.lst-bulk');
    if (bulk) renderBulk(bulk, all);
  }

  // Every SKU that passed the return-rate check and reached the server, newest first.
  function uploadedPage() {
    const best = new Map();
    for (const l of myLists()) for (const c of store.cardsFor(l)) {
      if (semiStatus(c) !== 'uploaded') continue;
      const prev = best.get(c.sku);
      if (!prev || (c.created || 0) > (prev.c.created || 0)) best.set(c.sku, {c, list: l});
    }
    const shown = [...best.values()].sort((a, b) => (b.c.created || 0) - (a.c.created || 0) || a.c.sku.localeCompare(b.c.sku));
    const copy = btn('复制全部 SKU', async () => {
      await navigator.clipboard.writeText(shown.map(x => x.c.sku).join('\n'));
      notify({level: 'success', title: '已复制 ' + shown.length + ' 个 SKU'});
    }, {disabled: !shown.length});
    return [h('section', {class: 'lst-card'}, h('h2', {}, '已上传到服务器的合格 SKU（' + shown.length + '）'),
      h('p', {class: 'muted'}, '这些 SKU 已通过退货率校验并交给服务器，后续资料准备、核验和上架由服务器后台处理。'
        + '按服务器记录显示，换电脑后恢复清单也能看到。'),
      h('div', {class: 'lst-actions'}, copy),
      shown.length ? h('table', {class: 'lst-table lst-uploaded'}, h('thead', {}, h('tr', {}, ['SKU', '清单', '上传时间', '服务器批次'].map(t => h('th', {}, t)))),
        h('tbody', {}, shown.map(({c, list}) => h('tr', {}, h('td', {}, h('strong', {}, c.sku)), h('td', {}, list.label || '清单'),
          h('td', {}, c.created ? bjt(c.created) : '—'), h('td', {}, h('code', {}, String(c.rootJobId || '').slice(0, 8)))))))
        : h('p', {class: 'muted'}, '还没有上传过合格的 SKU。'))];
  }

  // ---------- wizard ----------
  function classify(codes) {
    const known = new Map(allCards().map(c => [c.sku, semiStatus(c)])), out = {fresh: [], uploaded: [], excluded: []};
    for (const code of codes) {
      const s = known.get(code);
      if (s === 'uploaded') out.uploaded.push(code);
      else if (s === 'off') out.excluded.push(code);
      else out.fresh.push(code);
    }
    return out;
  }

  const wizardCodes = () => {
    const all = (wizard.extraction?.items || []).map(x => x.code);
    if (!wizard.skipKnown) return all;
    const c = classify(all);
    return [...c.fresh, ...c.excluded];
  };

  function wizardPage() {
    const steps = h('ol', {class: 'lst-steps'}, ['加入商品', '检查条件', '保存'].map((t, i) => h('li', {class: wizard.step === i + 1 ? 'is-now' : wizard.step > i + 1 ? 'is-done' : ''}, t)));
    const body = wizard.step === 1 ? wizardOne() : wizard.step === 2 ? wizardTwo() : wizardThree();
    return [h('section', {class: 'lst-card lst-wizard'}, h('h2', {}, '新建清单'), steps, body)];
  }

  function wizardOne() {
    const tabs = h('div', {class: 'lst-chips'}, [['paste', '粘贴文字'], ['file', '选文件'], ['store', '大健店铺']].map(([k, t]) =>
      h('button', {type: 'button', class: wizard.source === k ? 'is-on' : '', onclick: () => { wizard.source = k; render(true); }}, t)));
    const area = h('div', {class: 'lst-source'});
    const setExtraction = (value, source) => {
      wizard.extraction = {...value, source};
      wizard.label = wizard.label || (value.store ? '店铺 ' + value.store.name : (source === 'file' ? '文件' : '粘贴') + ' · ' + bjt(Date.now() / 1000));
      render(true);
    };
    if (wizard.source === 'paste') {
      const input = h('textarea', {rows: '5', placeholder: '可以粘贴带说明的整段文字，例如：W1234P567890、W9999S00001……', 'aria-label': '大健商品编码'});
      input.value = wizard.text;
      input.addEventListener('input', () => { wizard.text = input.value; });
      area.append(input, h('div', {class: 'lst-actions'}, btn('识别编码', async () => {
        const value = window.edup?.maintenance ? await window.edup.maintenance('extract-codes', {text: wizard.text}) : extractCodes(wizard.text);
        setExtraction(value, 'paste');
      }, {primary: true})));
    } else if (wizard.source === 'file') {
      area.append(h('p', {class: 'muted'}, '支持 TXT、CSV、TSV、DOCX、XLS、XLSX。扫描件和 PDF 要先转成这些格式。'),
        btn('选择文件并识别', async () => {
          const r = await window.edup.maintenance('extract-document');
          if (!r.canceled) setExtraction(r, 'file');
        }, {primary: true, disabled: !window.edup?.maintenance}));
    } else {
      const b = browserState(store.browser, store.site);
      if (!b.ok) area.append(feedback('info', '整店导入要先连好大健页面', '现在：' + b.label + '。'), btn('打开连接说明', () => { helpOpen = true; render(); }));
      else renderGigaStore(area, {site: store.site, available: !offline(), onImported: ({store: shop, codes, storeSaved}) =>
        setExtraction({store: shop, storeSaved, items: codes.map(code => ({code, reason: '大健店铺', occurrences: 1})), duplicates: 0}, 'store')});
    }
    const out = [h('p', {class: 'muted'}, '站点：' + (store.sites?.sites?.find(s => s.code === store.site)?.name || store.site) + '（在页面顶部切换）'), tabs, area];
    const ex = wizard.extraction;
    if (ex) {
      const codes = ex.items.map(x => x.code), c = classify(codes);
      const skipBox = h('input', {type: 'checkbox'}); skipBox.checked = wizard.skipKnown;
      skipBox.addEventListener('change', () => { wizard.skipKnown = skipBox.checked; render(true); });
      const label = h('input', {type: 'text', maxlength: '60', value: wizard.label, 'aria-label': '清单名称'});
      label.addEventListener('input', () => { wizard.label = label.value; });
      out.push(h('section', {class: 'lst-summary'}, h('h3', {}, '识别到 ' + codes.length + ' 个编码' + (ex.store ? '（' + ex.store.name + '）' : '')),
        h('p', {}, '新的 ' + c.fresh.length + ' · 已上传服务器 ' + c.uploaded.length + ' · 以前排除过 ' + c.excluded.length),
        c.uploaded.length ? h('label', {class: 'lst-inline'}, skipBox, ' 跳过已上传服务器的 ' + c.uploaded.length + ' 款（推荐）') : null,
        h('details', {}, h('summary', {}, '展开逐款核对'), h('p', {class: 'lst-codes'}, codes.join('、'))),
        h('label', {class: 'lst-field'}, h('span', {}, '清单名称'), label)),
      h('div', {class: 'lst-actions'}, btn('下一步', () => { wizard.step = 2; render(true); }, {primary: true, disabled: !wizardCodes().length})));
    }
    return out;
  }

  function wizardTwo() {
    const n = wizardCodes().length, b = browserState(store.browser, store.site);
    const siteOk = !!store.sites?.sites?.some(s => s.code === store.site);
    const checks = [
      ['站点：' + (siteOk ? store.site + ' 可以上架' : '这个站点现在不能上架'), siteOk],
      ['服务器：' + (offline() ? '连不上' : '在线'), !offline()],
      ['大健页面：' + b.label, b.ok],
    ];
    return [h('ul', {class: 'lst-checks'}, checks.map(([t, good]) => h('li', {class: good ? 'ok' : 'bad'}, (good ? '✓ ' : '✗ ') + t))),
      !b.ok ? btn('打开连接说明', () => { helpOpen = true; render(); }) : null,
      h('section', {class: 'lst-summary'}, h('h3', {}, '怎么跑'), h('ul', {}, [
        '共 ' + n + ' 款，保存成 ' + Math.ceil(n / 100) + ' 个分组，每组最多 100 款。',
        '每段先在大健页面读退货率、收藏通过的商品，再把合格的 SKU 上传到服务器。',
        '上传之后的资料准备、核验和上架由服务器后台处理，这个软件不再参与。',
        '保存后由你选择要执行的组。组内逐批读取，读取冷却 30 秒。',
        '中途切到别的页面不会中断。关掉软件的话，下次打开会提示从哪里继续。',
      ].map(t => h('li', {}, t)))),
      h('div', {class: 'lst-actions'}, h('button', {type: 'button', onclick: () => { wizard.step = 1; render(true); }}, '上一步'),
        btn('重新检查', async () => { await Promise.all([store.refreshBrowser(), store.refreshService()]); render(true); }),
        btn('下一步', () => { wizard.step = 3; render(true); }, {primary: true, disabled: !siteOk}))];
  }

  function wizardThree() {
    const codes = wizardCodes();
    return [h('p', {}, '将保存 ' + codes.length + ' 款为 ' + Math.ceil(codes.length / 100) + ' 个分组（' + store.site + ' 站，清单「' + (wizard.label || '未命名') + '」）。'),
      h('p', {class: 'muted'}, '这里只筛选退货率并上传合格 SKU，不会提交到亚马逊。'),
      h('div', {class: 'lst-actions'}, h('button', {type: 'button', onclick: () => { wizard.step = 2; render(true); }}, '上一步'),
        btn('保存 ' + Math.ceil(codes.length / 100) + ' 个分组', () => {
          const id = crypto.randomUUID(), ex = wizard.extraction;
          const list = {id, label: wizard.label || '清单', site: store.site, created: Math.floor(Date.now() / 1000), codes, jobs: [], source: ex.source,
            backupId: crypto.randomUUID(), backup: 'saving', kind: 'prepare', store: ex.store};
          local.saveList(list);
          startBackup(list, ex.store);
          Object.assign(wizard, {step: 1, text: '', extraction: null, label: ''});
          go({page: 'list', id});
        }, {primary: true, disabled: !codes.length || runner.busy(), title: runner.busy() ? '上一项还在进行，完成后再开始' : ''}))];
  }

  // ---------- render loop ----------
  function render(force = false) {
    if (!visible) return;
    renderBar();
    renderRunner();
    const key = JSON.stringify([route.page, route.id, route.groupId, route.filter, store.site]) + (route.page === 'new' ? ':' + wizard.step : '');
    if (route.page === 'list' && !force && key === renderedPage) { renderTableOnly(); return; }
    if (route.page === 'new' && !force && key === renderedPage) return;  // never wipe what the operator is typing
    renderedPage = key;
    const scroll = page.scrollTop;
    const parts = route.page === 'new' ? wizardPage() : route.page === 'list' ? listPage()
      : route.page === 'uploaded' ? uploadedPage() : lists();
    page.replaceChildren(...parts.flat().filter(Boolean));
    page.scrollTop = scroll;
  }

  let pending = false;
  const schedule = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; render(); }, 60); };
  store.subscribe(schedule);
  let lastAdmission = null;
  runner.subscribe(state => {
    const admission = state.admission;
    if (admission && admission.requestId !== lastAdmission) {
      lastAdmission = admission.requestId;
      store.invalidateJob(admission.rootJobId);
    }
    schedule();
  });

  // Jobs are read only to learn which SKUs reached the server; finished ones are re-read rarely.
  async function tick() {
    if (!visible || document.hidden) return;
    ticks++;
    await store.refreshBrowser();
    if (ticks % 12 === 1) await store.refreshService();
    const ids = route.page === 'list' ? (store.list(route.id)?.jobs || []) : myLists().flatMap(l => l.jobs);
    await store.refreshJobs(ids, {fast: 10000, slow: 10 * 60000});
  }

  return {
    show() {
      const first = !visible;
      visible = true;
      if (first) { renderedPage = ''; render(true); tick(); }
      else render(true);
      if (!timer) timer = setInterval(tick, 5000);
    },
    hide() { visible = false; clearInterval(timer); timer = null; },
    refresh() { ticks = 0; store.refreshJobs(myLists().flatMap(l => l.jobs), {force: true}); tick(); },
    store, runner,
  };
}
