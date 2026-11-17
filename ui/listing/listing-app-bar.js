// The listing workspace: backup, re-screen / skip actions, top bar, connection help and the runner banner.
// Split out of listing-app.js unchanged (client round 3); the shared state of one mounted workspace is passed in as `ctx`.
import {h, btn, notify} from './listing-kit.js';
import {runner, local, browserState} from './listing-runner.js';
import {backupSkuList, skuListPanel} from '../giga/giga-lists.js';
import {PAGES, semiStatus} from './listing-status.js';
// The listing area reaches giga-lists.js through this one file only, so the split does not add a cross-folder import (boundaries entry|ui:listing|ui:giga).
export {skuListPanel};

export function createBar(ctx) {
  const {store, backups, bar, runnerBox, call, go, offline} = ctx;
  // Backs a local list up to the server and remembers the outcome on the list itself.
  function startBackup(list, sourceStore) {
    const backupId = list.backupId || crypto.randomUUID();
    if (!list.backupId) local.setBackup(list.id, {backupId});
    backups.set(list.id, backupSkuList(call, {id: backupId, site: list.site, source: list.source, codes: list.codes, store: sourceStore || list.store, label: list.label,
      onState: (state, error) => local.setBackup(list.id, state === 'saved' ? {backup: 'saved', backupError: ''} : {backup: 'failed', backupError: error || ''})}));
  }

  // ---------- actions ----------
  // Screening again is the only thing left to do from here; it never targets an uploaded SKU.
  function rescreen(cards) {
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
    site.addEventListener('change', () => { store.setSite(site.value); go({page: ctx.route.page === 'list' ? 'lists' : ctx.route.page}); });
    const b = browserState(store.browser, store.site, runner.busy() && runner.state.need !== 'browser');
    const pill = h('button', {type: 'button', class: 'lst-pill lst-pill--' + b.tone, 'aria-expanded': String(ctx.helpOpen),
      onclick: () => { ctx.helpOpen = !ctx.helpOpen; ctx.render(); }}, '大健 · ' + b.label);
    const server = h('span', {class: 'lst-pill lst-pill--' + (offline() ? 'red' : 'green')}, offline() ? '服务器 · 连不上' : '服务器 · 在线');
    const nav = h('nav', {class: 'lst-subnav', 'aria-label': '上架页面'}, PAGES.map(([key, name]) =>
      h('button', {type: 'button', class: (ctx.route.page === key || (key === 'lists' && ctx.route.page === 'list')) ? 'is-on' : '',
        onclick: () => go({page: key})}, name)));
    bar.replaceChildren(...[h('div', {class: 'lst-bar-row'}, h('label', {class: 'lst-site'}, '站点 ', site), pill, server), nav,
      ctx.helpOpen ? connectionHelp(b) : null].filter(Boolean));
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
        btn('重新检查', async () => { await store.refreshBrowser(); ctx.render(); })),
      h('p', {class: 'muted'}, '连接只授权你选定的那个大健页面；Cookie 留在浏览器里。可以随时在扩展里断开。'));
  }

  // ---------- runner banner ----------
  function renderRunner() {
    const s = runner.state, interrupted = runner.interrupted();
    runnerBox.replaceChildren();
    if (s.phase === 'idle' && (interrupted || runner.savedQueue().length)) {
      runnerBox.append(h('div', {class: 'lst-banner lst-banner--info'}, h('strong', {}, interrupted ? '上次有一份没做完：' + (interrupted.label || '筛选') + '（' + interrupted.codes.length + ' 款）' : '还有保存的待执行分组'),
        h('span', {class: 'muted'}, '已经上传到服务器的段会保留，继续时只做剩下的。'),
        h('div', {class: 'lst-actions'}, btn('继续', () => runner.resumeSaved(), {primary: true}),
          btn('清空待执行队列（保留存档）', () => { runner.discardPending(); ctx.render(); }))));
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
    else if (s.phase === 'need') actions.append(btn('已连好，继续', () => runner.continue(), {primary: true}), btn('打开连接说明', () => { ctx.helpOpen = true; ctx.render(); }),
      btn('取消', () => runner.cancel()));
    if (s.phase === 'paused' && (s.left?.length || runner.savedQueue().length)) actions.append(btn('继续剩下的', () => runner.resumeSaved(), {primary: true}));
    if (['paused','error'].includes(s.phase) && runner.savedQueue().length) actions.append(btn('清空待执行队列（保留存档）', () => { runner.discardPending(); ctx.render(); }));
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
  Object.assign(ctx, {startBackup, rescreen, skip, renderBar, renderRunner});
}
