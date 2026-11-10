// The listing workspace ("上架"): mounted once and only hidden when another tab is open,
// so a running screening is never torn down by a re-render (spec §8.2).
import {h, btn, badge, feedback, bjt, dialog} from './listing-kit.js';
import {createStore} from './listing-store.js';
import {runner, local, browserState} from './listing-runner.js';
import {summarize, sortCards, STAGES, STAGE_NAME, OWNER, ACTION, maintainerNote} from './listing-states.js';
import {openSubmitSheet, openQuestions, renderDrawer} from './listing-sheets.js';
import {renderGigaStore} from './giga-store.js';
import {backupSkuList, skuListPanel, renderModelUsage} from './giga-lists.js';
import {extractCodes} from './sku-rules.js';
import {notify, friendlyError} from './notices.js';
import {archiveGroups, groupTask, restoredArchive} from './listing-groups.js';
import {storageMessage} from './storage-state.js';

const PAGES = [['home', '首页'], ['new', '新建上架'], ['lists', '清单'], ['opening', '开卖核对']];
const FILTERS = [['all', '全部'], ['you', '等你'], ['program', '程序'], ['platform', '亚马逊'], ['maintainer', '维护者'], ['selling', '在售'], ['off', '已排除']];
const RUNNER_ACTIONS = new Set(['recheck', 'prepare', 'rescreen']);
const keyOf = c => (c.listId || '') + '|' + c.sku;
const matches = (c, f) => f === 'all' ? true : f === 'selling' ? c.stage === 'selling' : f === 'off' ? ['excluded', 'skipped'].includes(c.stage)
  : !['selling', 'excluded', 'skipped'].includes(c.stage) && c.owner === f;

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
  let route = {page: 'home'}, visible = false, helpOpen = false, drawer = null, renderedPage = '', timer = null, ticks = 0;
  const selected = new Set(), rows = new Map();
  const selectedGroups = new Set();
  let serverLists, serverListsScope;
  const usageCard = h('details', {class: 'lst-card'}, h('summary', {}, '模型用量'));
  const usageBody = h('div');
  usageCard.append(usageBody);
  const wizard = {step: 1, source: 'paste', text: '', extraction: null, skipKnown: true, label: '', mode: 'prepare'};

  const bar = h('div', {class: 'lst-bar'}), runnerBox = h('div', {class: 'lst-runner'}), page = h('div', {class: 'lst-page'});
  // Not <aside>: styles.css styles every aside as the dark left sidebar.
  const drawerEl = h('section', {class: 'lst-drawer', role: 'complementary', hidden: true, 'aria-label': '商品详情'});
  root.classList.add('lst');
  root.replaceChildren(bar, runnerBox, page, drawerEl);

  const go = next => { route = next; selected.clear(); render(true); page.scrollIntoView?.({block: 'start'}); };
  const offline = () => isOffline();

  // ---------- actions ----------
  async function act(action, cards) {
    const site = store.site;
    if (action === 'confirm_submit') return openSubmitSheet({cards, site, call, store,
      onDone: () => refreshRoots(cards)});
    if (action === 'answer_questions') return openQuestions({cards, site, call, runner, onDone: () => refreshRoots(cards)});
    if (RUNNER_ACTIONS.has(action)) {
      if (store.service?.storage?.blocked) throw Error(store.service.storage.code || 'GIGA_SERVER_STORAGE_LOW');
      const fresh = action === 'rescreen';
      const withJob = new Map(), withoutJob = new Map();
      for (const c of cards) {
        if (c.rootJobId) withJob.set(c.rootJobId, [...(withJob.get(c.rootJobId) || []), c.sku]);
        else withoutJob.set(c.listId, [...(withoutJob.get(c.listId) || []), c.sku]);
      }
      for (const [parentJobId, codes] of withJob) runner.start({kind: 'recheck', site, codes, parentJobId, fresh, label: ACTION[action]});
      for (const [listId, codes] of withoutJob) runner.start({kind: 'prepare', site, codes, listId: store.list(listId)?.source === 'local' ? listId : null,
        fresh, label: ACTION[action]});
      notify({level: 'success', title: '已开始' + ACTION[action], message: '进度显示在上方。切到别的页面也会继续。'});
      return;
    }
    if (action === 'check_result') {
      for (const c of cards) {
        if (!c.submission?.operationId) continue;
        const r = await call('operation_readback', {id: c.submission.operationId});
        notify({level: r.state === 'verified' ? 'success' : 'info', title: c.sku + '：' + (r.state === 'verified' ? '亚马逊已确认' : '结果已更新'),
          message: r.note || r.result?.note || '最新状态显示在清单里。'});
      }
      return refreshRoots(cards, true);
    }
    if (action === 'open_buyer_page') {
      const c = cards.find(x => x.asin);
      if (!c) throw Error('GIGA_BUYER_PAGE_INVALID');
      return window.edup.maintenance('giga-open-buyer-page', {asin: c.asin});
    }
    if (action === 'copy_for_maintainer') {
      const text = cards.map(c => maintainerNote(c, site)).join('\n\n');
      try { await navigator.clipboard.writeText(text); notify({level: 'success', title: '已复制', message: '发给维护者（Codex）即可。'}); }
      catch { const d = h('textarea', {class: 'lst-copy', rows: '8', readonly: true}); d.value = text; notify({level: 'info', title: '复制没成功', message: '请在弹出的框里手动复制。'}); showText('发给维护者的内容', d); }
      return;
    }
    if (action === 'ask_ai' || action === 'view_report') { openDrawer(cards[0]); drawer?.view.openTab(action); return; }
    if (action === 'skip' || action === 'unskip') { for (const c of cards) local.setSkip(site, c.sku, action === 'skip'); store.touch(); return; }
  }

  function showText(title, node) { dialog(title).body.append(node); }

  async function refreshRoots(cards, force = true) {
    const ids = [...new Set(cards.map(c => c.rootJobId).filter(Boolean))];
    await store.refreshJobs(ids, {force});
  }

  const actionButton = (c, action, primary = false) => {
    const needsServer = !['open_buyer_page', 'copy_for_maintainer', 'skip', 'unskip'].includes(action);
    return btn(ACTION[action] || action, () => act(action, [c]), {primary, disabled: needsServer && offline(),
      title: needsServer && offline() ? '连上服务器后才能操作' : ''});
  };

  // ---------- drawer ----------
  function openDrawer(card) {
    drawer?.view.dispose();
    drawerEl.hidden = false;
    const body = h('div', {class: 'lst-drawer-body'});
    drawerEl.replaceChildren(body);
    const view = renderDrawer(body, card, {site: store.site, call, offline: offline(), actionButton, close: closeDrawer});
    drawer = {key: keyOf(card), sig: JSON.stringify(card), view};
  }
  function closeDrawer() { drawer?.view.dispose(); drawer = null; drawerEl.hidden = true; drawerEl.replaceChildren(); }
  function updateDrawer(cards) {
    if (!drawer) return;
    const c = cards.find(x => keyOf(x) === drawer.key);
    if (!c) return;
    const sig = JSON.stringify(c);
    if (sig !== drawer.sig) { drawer.sig = sig; drawer.view.update(c); }
  }
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer) closeDrawer(); });

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
      runnerBox.append(h('div', {class: 'lst-banner lst-banner--info'}, h('strong', {}, interrupted ? '上次有一份没做完：' + (interrupted.label || '上架') + '（' + interrupted.codes.length + ' 款）' : '还有保存的待执行分组'),
        h('span', {class: 'muted'}, '已经交给服务器的段会保留，继续时只做剩下的。'),
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
      runner.start({...t, codes: leftovers, fresh: true, label: (s.label || '上架') + ' · 重试'});
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
  function strip(stages) {
    return h('div', {class: 'lst-strip'}, STAGES.map(([k, name]) => h('span', {class: stages[k] ? 'has' : ''}, name + ' ', h('b', {}, String(stages[k] || 0)))),
      h('span', {class: 'lst-strip-off'}, '已排除 ', h('b', {}, String((stages.excluded || 0) + (stages.skipped || 0)))));
  }

  function home() {
    const lists = store.recentLists();
    if (!lists.length) return [h('section', {class: 'lst-empty'}, h('h2', {}, '还没有上架清单'), h('p', {class: 'muted'}, '加入大健商品编码或整店导入，开始第一份清单。'),
      btn('新建上架', () => go({page: 'new'}), {primary: true}))];
    const cards = store.homeCards(), s = summarize(cards);
    const counter = (label, n, filter) => h('button', {type: 'button', class: 'lst-counter lst-counter--' + filter,
      onclick: () => go({page: 'list', id: 'recent', filter})}, h('span', {}, label), h('b', {}, String(n)));
    const out = [h('div', {class: 'lst-counters'}, counter('等你处理', s.owners.you, 'you'), counter('程序在做', s.owners.program, 'program'),
      counter('等亚马逊', s.owners.platform, 'platform'), counter('维护者处理', s.owners.maintainer, 'maintainer'), counter('在售', s.selling, 'selling')),
    strip(s.stages)];
    const todo = h('section', {class: 'lst-card'}, h('h2', {}, '要你做的（建议从上往下）'));
    if (!s.todo.length) todo.append(h('p', {class: 'muted'}, '现在没有要你做的事。'));
    s.todo.forEach((g, i) => todo.append(h('div', {class: 'lst-todo'}, h('span', {class: 'lst-todo-no'}, String(i + 1)),
      h('div', {}, h('strong', {}, g.label + ' ' + g.items.length + ' 款'), h('p', {class: 'muted'}, g.hint + (g.items[0] ? ' · 例：' + g.items[0].sku + ' ' + g.items[0].headline : ''))),
      btn(g.action === 'check_result' ? '去核对' : g.action === 'confirm_submit' ? '去确认' : g.action === 'answer_questions' ? '去回答' : '开始', () => act(g.action, g.items),
        {primary: i === 0, disabled: offline()}))));
    out.push(todo);
    const working = cards.filter(c => ['program', 'platform'].includes(c.owner) && !['selling', 'excluded', 'skipped'].includes(c.stage));
    if (working.length) out.push(h('section', {class: 'lst-card'}, h('h2', {}, '程序和亚马逊在做的（不用管）'),
      h('ul', {}, groupLines(working).map(t => h('li', {}, t)))));
    if (s.maintainer.length) out.push(h('section', {class: 'lst-card'}, h('h2', {}, '要维护者处理的'),
      h('p', {class: 'muted'}, '程序侧的问题，你修不了。点「复制给维护者」把信息发给 Codex。'),
      h('ul', {class: 'lst-maint'}, s.maintainer.slice(0, 8).map(c => h('li', {}, h('strong', {}, c.sku), ' ', c.headline))),
      btn('复制给维护者（' + s.maintainer.length + ' 款）', () => act('copy_for_maintainer', s.maintainer))));
    out.push(listTable(lists, '最近的清单'));
    return out;
  }

  function groupLines(cards) {
    const m = new Map();
    for (const c of cards) m.set(c.headline, (m.get(c.headline) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([t, n]) => t + '：' + n + ' 款');
  }

  function listTable(lists, title) {
    return h('section', {class: 'lst-card'}, h('h2', {}, title), h('table', {class: 'lst-table'},
      h('thead', {}, h('tr', {}, ['清单', '开始时间', '商品', '进度', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, lists.map(l => {
        const cards = store.cardsFor(l), s = summarize(cards), loaded = l.jobs.every(id => store.jobs.has(id));
        return h('tr', {class: 'lst-click', onclick: () => go({page: 'list', id: l.id})}, h('td', {}, h('strong', {}, l.label || '清单')),
          h('td', {}, bjt(l.created)), h('td', {}, String(l.codes.length || cards.length) + ' 款'),
          h('td', {}, loaded || !l.jobs.length ? '在售 ' + s.selling + ' · 等你 ' + s.owners.you + ' · 程序 ' + s.owners.program : '打开后读取'),
          h('td', {}, h('button', {type: 'button'}, '打开')));
      }))));
  }

  function lists() {
    const all = store.lists();
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
    renderModelUsage(usageBody, store.service?.modelUsage);
    const current = all.length ? listTable(all, '全部清单（' + all.length + '）')
      : h('section', {class: 'lst-empty'}, h('h2', {}, '还没有清单'), btn('新建上架', () => go({page: 'new'}), {primary: true}));
    return [current, serverLists, usageCard];
  }

  function listPage() {
    const recent = route.id === 'recent';
    const list = recent ? null : store.list(route.id);
    if (!recent && !list) return [feedback('info', '找不到这份清单', '可能已经切换了站点。'), btn('回到清单', () => go({page: 'lists'}))];
    const ownArchive = !recent && list.source === 'local' ? local.ensureGroups(list.id) : null;
    const groups = ownArchive ? archiveGroups(ownArchive) : [];
    const focused = groups.find(g => g.id === route.groupId);
    const scope = focused ? new Set(focused.codes) : null;
    const all = sortCards(recent ? store.homeCards() : store.cardsFor(list)).filter(c => !scope || scope.has(c.sku));
    const filter = route.filter || 'all', q = (route.q || '').trim().toUpperCase();
    const shown = all.filter(c => matches(c, filter) && (!q || c.sku.includes(q) || (c.name || '').toUpperCase().includes(q)));
    const s = summarize(all);
    const header = h('div', {class: 'lst-list-head'}, h('button', {type: 'button', onclick: () => go({page: recent ? 'home' : 'lists'})}, '← 返回'),
      h('h2', {}, recent ? '最近的清单（合并显示）' : list.label || '清单'),
      h('span', {class: 'muted'}, recent ? '' : bjt(list.created) + ' · ' + (list.codes.length || all.length) + ' 款' + (list.source === 'server' ? ' · 服务器批次' : '')));
    const backup = !recent && backups.get(list.id);
    const backupBox = h('div', {class: 'lst-backup'});
    if (backup) backup.render(backupBox);
    else if (!recent && list.source === 'local') {
      const own = local.lists().find(x => x.id === list.id);
      if (own && own.backup !== 'saved') backupBox.append(feedback('warn', '这份清单还没备份到服务器',
        '现在只存在这台电脑上：换电脑、重装或本机数据丢失就找不回来，服务器也看不到它的进度。' + (own.backupError ? '上次失败原因：' + own.backupError + '。' : ''), ''),
        h('div', {class: 'lst-actions'}, btn('备份到服务器', () => { startBackup(own); render(true); }, {primary: true})));
    }
    const chips = h('div', {class: 'lst-chips'}, FILTERS.map(([k, name]) => h('button', {type: 'button', class: filter === k ? 'is-on' : '',
      dataset: {filter: k}, onclick: () => { route = {...route, filter: k}; selected.clear(); render(true); }}, name + ' ' + all.filter(c => matches(c, k)).length)),
      (() => { const input = h('input', {type: 'search', placeholder: '搜索编码或名称', 'aria-label': '搜索商品', value: route.q || ''});
        input.addEventListener('input', () => { route = {...route, q: input.value}; renderTableOnly(); }); return input; })());
    const tbody = h('tbody');
    const table = h('table', {class: 'lst-table lst-products'}, h('thead', {}, h('tr', {}, ['', '商品', '阶段', '现在', '下一步'].map(t => h('th', {}, t)))), tbody);
    rows.clear();
    fillRows(tbody, shown);
    const bulk = h('div', {class: 'lst-bulk'});
    renderBulk(bulk, all);
    const archives = ownArchive ? h('section', {class: 'lst-card'}, h('h3', {}, '商品分组存档 · 每组最多 100 款'),
      h('p', {class: 'muted'}, '分组会保存。勾选一组或多组再执行，关闭软件后可继续；不会自动提交到亚马逊。'),
      h('p', {}, '本清单执行方式：' + (ownArchive.kind === 'query' ? '只查报价和库存' : '筛选并准备上架资料（包含模型检查）')),
      h('div', {class: 'lst-actions'},
        btn('全选组', () => { for (const g of groups) selectedGroups.add(g.id); render(true); }),
        btn('清空选择', () => { for (const g of groups) selectedGroups.delete(g.id); render(true); }),
        btn('执行选中的 ' + groups.filter(g => selectedGroups.has(g.id)).length + ' 组', async () => {
          const picked = groups.filter(g => selectedGroups.has(g.id));
          const excluded = new Set(store.cardsFor(list).filter(c => ['selling','excluded','skipped'].includes(c.stage)).map(c => c.sku));
          // Cross-PC restoration has no local request journal. Check server ownership first;
          // jobs already preparing/prepared/failed need their original per-item continuation.
          if (ownArchive.backup === 'saved' && ownArchive.backupId) {
            const saved = await call('sku_list_status', {id: ownArchive.backupId});
            if (saved.id !== ownArchive.backupId || saved.site !== ownArchive.site ||
                JSON.stringify(saved.items.map(row => row.sku)) !== JSON.stringify(ownArchive.codes)) throw Error('SKU_LIST_RECEIPT_INVALID');
            for (const row of saved.items) if (!['not_started','screened'].includes(row.stage)) excluded.add(row.sku);
          }
          let count = 0;
          for (const g of picked) {
            const task = groupTask(ownArchive, g);
            const codes = task.codes.filter(sku => !excluded.has(sku));
            if (codes.length) { runner.start({...task, codes}); count += codes.length; }
          }
          notify({level:'info', title: count ? '已安排 ' + count + ' 款' : '所选分组没有待开始的商品',
            message:'已处理或有原任务的商品保留进度；补资料、重试请打开本组的商品操作。'});
          selectedGroups.clear(); render(true);
        }, {primary: true, disabled: offline() || store.service?.storage?.blocked || !groups.some(g => selectedGroups.has(g.id))}),
        btn('查看全部商品', () => go({page: 'list', id: list.id}))),
      h('table', {class: 'lst-table'}, h('thead', {}, h('tr', {}, ['选择', '分组', '商品数', '进度', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, groups.map(g => {
          const wanted = new Set(g.codes), cards = store.cardsFor(list).filter(c => wanted.has(c.sku)), summary = summarize(cards);
          const check = h('input', {type: 'checkbox', 'aria-label': '选择' + g.label}); check.checked = selectedGroups.has(g.id);
          check.addEventListener('change', () => { check.checked ? selectedGroups.add(g.id) : selectedGroups.delete(g.id); render(true); });
          return h('tr', {}, h('td', {}, check), h('td', {}, g.label), h('td', {}, String(g.codes.length)),
            h('td', {class:'lst-archive-progress', dataset:{group:g.id}}, '待开始 ' + summary.stages.queued + ' · 待提交 ' + summary.stages.ready + ' · 在售 ' + summary.selling),
            h('td', {}, btn('查看本组', () => go({page: 'list', id: list.id, groupId: g.id}))));
        })))) : null;
    return [header, backupBox, archives, focused ? h('p', {}, '当前查看：' + focused.label) : null,
      strip(s.stages), chips, shown.length ? table : h('p', {class: 'muted lst-empty-row'}, '这一类没有商品。'), bulk];
  }

  function fillRows(tbody, cards) {
    const keep = new Set();
    for (const c of cards) {
      const key = keyOf(c); keep.add(key);
      const sig = JSON.stringify([c.stage, c.owner, c.unknown, c.headline, c.detail, c.primary, c.name, selected.has(key), offline()]);
      let row = rows.get(key);
      if (!row) { row = {tr: h('tr', {class: 'lst-click'}), sig: ''}; rows.set(key, row); }
      if (row.sig !== sig) {
        row.sig = sig;
        const check = h('input', {type: 'checkbox', 'aria-label': '选择 ' + c.sku, onclick: e => e.stopPropagation()});
        check.checked = selected.has(key);
        check.addEventListener('change', () => { check.checked ? selected.add(key) : selected.delete(key); renderTableOnly(); });
        const next = c.primary ? actionButton(c, c.primary, c.owner === 'you') : h('span', {class: 'muted'}, c.disabledReason || (c.stage === 'selling' ? '—' : '无需操作'));
        row.tr.replaceChildren(h('td', {}, check), h('td', {}, h('strong', {}, c.sku), c.name ? h('div', {class: 'muted lst-name'}, c.name) : null),
          h('td', {}, STAGE_NAME[c.stage] || c.stage), h('td', {}, h('div', {class: 'lst-now-line'}, badge(c), h('span', {}, c.headline)),
            c.detail ? h('div', {class: 'muted lst-detail'}, c.detail) : null), h('td', {}, next));
        row.tr.onclick = () => openDrawer(c);
      }
      tbody.append(row.tr);
    }
    for (const [key, row] of rows) if (!keep.has(key)) { row.tr.remove(); rows.delete(key); }
  }

  function renderBulk(bulk, all) {
    const picked = all.filter(c => selected.has(keyOf(c)));
    bulk.replaceChildren();
    if (!picked.length) return;
    const by = a => picked.filter(c => c.primary === a);
    bulk.append(h('strong', {}, '选中 ' + picked.length + ' 款：'));
    for (const action of ['confirm_submit', 'answer_questions', 'recheck', 'rescreen', 'check_result']) {
      const list = by(action);
      if (list.length) bulk.append(btn(ACTION[action] + ' ' + list.length + ' 款', () => act(action, list), {primary: action === 'confirm_submit', disabled: offline()}));
    }
    const skippable = picked.filter(c => !['selling', 'excluded', 'skipped'].includes(c.stage));
    if (skippable.length) bulk.append(btn('不上这 ' + skippable.length + ' 款', () => { act('skip', skippable); selected.clear(); }));
    bulk.append(h('button', {type: 'button', onclick: () => { selected.clear(); renderTableOnly(); }}, '取消选择'));
  }

  function renderTableOnly() {
    if (route.page !== 'list') return;
    const recent = route.id === 'recent', list = recent ? null : store.list(route.id);
    if (!recent && !list) return;
    const group = !recent && list.groups?.find(g => g.id === route.groupId), scope = group ? new Set(group.codes) : null;
    const all = sortCards(recent ? store.homeCards() : store.cardsFor(list)).filter(c => !scope || scope.has(c.sku));
    const filter = route.filter || 'all', q = (route.q || '').trim().toUpperCase();
    const shown = all.filter(c => matches(c, filter) && (!q || c.sku.includes(q) || (c.name || '').toUpperCase().includes(q)));
    const tbody = page.querySelector('.lst-products tbody');
    if (list?.groups) {
      const cards = store.cardsFor(list);
      for (const cell of page.querySelectorAll('.lst-archive-progress')) {
        const group = list.groups.find(g => g.id === cell.dataset.group);
        if (!group) continue;
        const wanted = new Set(group.codes), summary = summarize(cards.filter(c => wanted.has(c.sku)));
        cell.textContent = '待开始 ' + summary.stages.queued + ' · 待提交 ' + summary.stages.ready + ' · 在售 ' + summary.selling;
      }
    }
    if (tbody) fillRows(tbody, shown);
    page.querySelector('.lst-strip')?.replaceWith(strip(summarize(all).stages));
    for (const b of page.querySelectorAll('.lst-chips button[data-filter]')) {
      const k = b.dataset.filter, name = FILTERS.find(f => f[0] === k)[1];
      b.textContent = name + ' ' + all.filter(c => matches(c, k)).length;
    }
    if (!tbody && shown.length) { render(true); return; }
    const bulk = page.querySelector('.lst-bulk');
    if (bulk) renderBulk(bulk, all);
    updateDrawer(all);
  }

  function opening() {
    const cards = store.homeCards();
    const zero = sortCards(cards.filter(c => c.stage === 'opening')), selling = sortCards(cards.filter(c => c.stage === 'selling'));
    const table = (list, cols, cells) => list.length ? h('table', {class: 'lst-table'}, h('thead', {}, h('tr', {}, cols.map(t => h('th', {}, t)))),
      h('tbody', {}, list.map(c => h('tr', {class: 'lst-click', onclick: () => openDrawer(c)}, cells(c).map(x => h('td', {}, x)))))) : h('p', {class: 'muted'}, '没有。');
    return [
      h('section', {class: 'lst-card'}, h('h2', {}, '已建链接、还没开卖（' + zero.length + '）'),
        h('p', {class: 'muted'}, '系统自动核对刊登属性、图片和平台报价。实际买家页面可点开查看，开卖状态以库存同步结果为准。大健没货的会保持为 0。'),
        table(zero, ['商品', 'ASIN', '现在', ''], c => [h('strong', {}, c.sku), c.asin || '—', h('div', {class: 'lst-now-line'}, badge(c), h('span', {}, c.headline)),
          c.asin ? actionButton(c, 'open_buyer_page') : (c.primary ? actionButton(c, c.primary) : '')])),
      h('section', {class: 'lst-card'}, h('h2', {}, '最近开卖（供你事后检查，' + selling.length + '）'),
        h('p', {class: 'muted'}, '在售数量来自经营数据同步，可能比亚马逊晚几分钟。打开页面只是看，不会记录，也不会影响开卖。'),
        table(selling, ['商品', 'ASIN', '在售', ''], c => [h('strong', {}, c.sku), c.asin || '—', c.headline, c.asin ? actionButton(c, 'open_buyer_page') : ''])),
    ];
  }

  // ---------- wizard ----------
  function knownStatus() {
    const m = new Map();
    for (const c of store.homeCards()) m.set(c.sku, c);
    for (const p of getSnapshot()?.products || []) if (p.site === store.site && !m.has(p.sku)) m.set(p.sku, {stage: (p.status || []).includes('BUYABLE') ? 'selling' : 'opening'});
    return m;
  }

  function classify(codes) {
    const known = knownStatus(), out = {fresh: [], selling: [], working: [], excluded: []};
    for (const code of codes) {
      const c = known.get(code);
      if (!c || c.stage === 'queued') out.fresh.push(code);
      else if (c.stage === 'selling' || c.stage === 'opening') out.selling.push(code);
      else if (['excluded', 'skipped'].includes(c.stage)) out.excluded.push(code);
      else out.working.push(code);
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
    const steps = h('ol', {class: 'lst-steps'}, ['加入商品', '检查条件', '开始'].map((t, i) => h('li', {class: wizard.step === i + 1 ? 'is-now' : wizard.step > i + 1 ? 'is-done' : ''}, t)));
    const body = wizard.step === 1 ? wizardOne() : wizard.step === 2 ? wizardTwo() : wizardThree();
    return [h('section', {class: 'lst-card lst-wizard'}, h('h2', {}, '新建上架'), steps, body)];
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
      const skip = h('input', {type: 'checkbox'}); skip.checked = wizard.skipKnown;
      skip.addEventListener('change', () => { wizard.skipKnown = skip.checked; render(true); });
      const label = h('input', {type: 'text', maxlength: '60', value: wizard.label, 'aria-label': '清单名称'});
      label.addEventListener('input', () => { wizard.label = label.value; });
      const mode = h('select', {'aria-label': '做什么'}, h('option', {value: 'prepare'}, '准备上架（筛选、准备、预检，提交前会请你确认）'),
        h('option', {value: 'query'}, '只查报价和库存，不上架'));
      mode.value = wizard.mode; mode.addEventListener('change', () => { wizard.mode = mode.value; });
      out.push(h('section', {class: 'lst-summary'}, h('h3', {}, '识别到 ' + codes.length + ' 个编码' + (ex.store ? '（' + ex.store.name + '）' : '')),
        h('p', {}, '新的 ' + c.fresh.length + ' · 已上架 ' + c.selling.length + ' · 在别的清单里处理中 ' + c.working.length + ' · 以前排除过 ' + c.excluded.length),
        (c.selling.length + c.working.length) ? h('label', {class: 'lst-inline'}, skip, ' 跳过已上架和处理中的 ' + (c.selling.length + c.working.length) + ' 款（推荐）') : null,
        h('details', {}, h('summary', {}, '展开逐款核对'), h('p', {class: 'lst-codes'}, codes.join('、'))),
        h('label', {class: 'lst-field'}, h('span', {}, '清单名称'), label), h('label', {class: 'lst-field'}, h('span', {}, '做什么'), mode)),
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
    const size = store.browser?.accountScopeV2 ? 30 : 20, segments = Math.ceil(n / size);
    const ok = siteOk; // Archiving itself does not need a live browser connection.
    return [h('ul', {class: 'lst-checks'}, checks.map(([t, good]) => h('li', {class: good ? 'ok' : 'bad'}, (good ? '✓ ' : '✗ ') + t))),
      !b.ok ? btn('打开连接说明', () => { helpOpen = true; render(); }) : null,
      h('section', {class: 'lst-summary'}, h('h3', {}, '怎么跑'), h('ul', {}, [
        '共 ' + n + ' 款，保存成 ' + Math.ceil(n / 100) + ' 个分组，每组最多 100 款。',
        '每段先在大健页面读退货率、收藏通过的商品，再交给服务器' + (wizard.mode === 'query' ? '查报价和库存。' : '准备上架资料并做亚马逊预检。'),
        '保存后由你选择要执行的组。组内逐批读取，读取冷却 30 秒，没有客户端小时或每日数量上限。',
        '中途切到别的页面不会中断。关掉软件的话，下次打开会提示从哪里继续。',
        '预计时间：暂无（还没有可靠的历史数据）。',
      ].map(t => h('li', {}, t)))),
      h('div', {class: 'lst-actions'}, h('button', {type: 'button', onclick: () => { wizard.step = 1; render(true); }}, '上一步'),
        btn('重新检查', async () => { await Promise.all([store.refreshBrowser(), store.refreshService()]); render(true); }),
        btn('下一步', () => { wizard.step = 3; render(true); }, {primary: true, disabled: !ok}))];
  }

  function wizardThree() {
    const codes = wizardCodes();
    return [h('p', {}, '将保存 ' + codes.length + ' 款为 ' + Math.ceil(codes.length / 100) + ' 个分组（' + store.site + ' 站，清单「' + (wizard.label || '未命名') + '」）。'),
      h('p', {class: 'muted'}, wizard.mode === 'query' ? '只查报价和库存，不会上架。' : '筛选和准备都不会上架；提交前还会请你在确认单上逐款确认。'),
      h('div', {class: 'lst-actions'}, h('button', {type: 'button', onclick: () => { wizard.step = 2; render(true); }}, '上一步'),
        btn('保存 ' + Math.ceil(codes.length / 100) + ' 个分组', () => {
          const id = crypto.randomUUID(), ex = wizard.extraction;
          const list = {id, label: wizard.label || '清单', site: store.site, created: Math.floor(Date.now() / 1000), codes, jobs: [], source: ex.source,
            backupId: crypto.randomUUID(), backup: 'saving', kind: wizard.mode === 'query' ? 'query' : 'prepare', store: ex.store};
          local.saveList(list);
          startBackup(list, ex.store);
          Object.assign(wizard, {step: 1, text: '', extraction: null, label: '', mode: 'prepare'});
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
    const parts = route.page === 'home' ? home() : route.page === 'new' ? wizardPage() : route.page === 'lists' ? lists()
      : route.page === 'list' ? listPage() : opening();
    page.replaceChildren(...parts.flat().filter(Boolean));
    page.scrollTop = scroll;
    if (route.page !== 'list') updateDrawer(store.homeCards());
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

  async function tick() {
    if (!visible || document.hidden) return;
    ticks++;
    await store.refreshBrowser();
    if (ticks % 12 === 1) { await store.refreshService(); await store.refreshBatches(); }
    const ids = route.page === 'list' && route.id !== 'recent' ? (store.list(route.id)?.jobs || [])
      : store.recentLists().flatMap(l => l.jobs);
    await store.refreshJobs(ids, route.page === 'list' ? {fast: 5000, slow: 60000} : {fast: 10000, slow: 120000});
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
    refresh() { ticks = 0; store.refreshJobs(store.recentLists().flatMap(l => l.jobs), {force: true}); tick(); },
    store, runner,
  };
}
