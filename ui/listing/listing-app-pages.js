// The listing workspace pages: lists, one list (groups, products, bulk actions) and the uploaded-SKU page.
// Split out of listing-app.js unchanged (client round 3); the shared state of one mounted workspace is passed in as `ctx`.
import {h, btn, feedback, bjt, notify} from './listing-kit.js';
import {runner, local} from './listing-runner.js';
import {skuListPanel} from './listing-app-bar.js';
import {archiveGroups, groupTask, restoredArchive} from './listing-groups.js';
import {STATUS, FILTERS, keyOf, semiStatus, semiText, matches} from './listing-status.js';

export function createPages(ctx) {
  const {store, backups, selected, rows, selectedGroups, page, call, go, offline, myLists} = ctx;
  let serverLists, serverListsScope;

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
    const list = store.list(ctx.route.id);
    if (!list || list.source !== 'local') return [feedback('info', '找不到这份清单', '可能已经切换了站点。'), btn('回到清单', () => go({page: 'lists'}))];
    const ownArchive = local.ensureGroups(list.id);
    const groups = ownArchive ? archiveGroups(ownArchive) : [];
    const focused = groups.find(g => g.id === ctx.route.groupId);
    const scope = focused ? new Set(focused.codes) : null;
    const all = sorted(store.cardsFor(list).filter(c => !scope || scope.has(c.sku)));
    const filter = ctx.route.filter || 'all', q = (ctx.route.q || '').trim().toUpperCase();
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
        h('div', {class: 'lst-actions'}, btn('备份到服务器', () => { ctx.startBackup(own); ctx.render(true); }, {primary: true})));
    }
    const chips = h('div', {class: 'lst-chips'}, FILTERS.map(([k, name]) => h('button', {type: 'button', class: filter === k ? 'is-on' : '',
      dataset: {filter: k}, onclick: () => { ctx.route = {...ctx.route, filter: k}; selected.clear(); ctx.render(true); }}, name + ' ' + all.filter(c => matches(c, k)).length)),
      (() => { const input = h('input', {type: 'search', placeholder: '搜索编码', 'aria-label': '搜索商品', value: ctx.route.q || ''});
        input.addEventListener('input', () => { ctx.route = {...ctx.route, q: input.value}; renderTableOnly(); }); return input; })());
    const tbody = h('tbody');
    const table = h('table', {class: 'lst-table lst-products'}, h('thead', {}, h('tr', {}, ['', '商品', '状态', '说明', ''].map(t => h('th', {}, t)))), tbody);
    rows.clear();
    fillRows(tbody, shown);
    const bulk = h('div', {class: 'lst-bulk'});
    renderBulk(bulk, all);
    const archives = ownArchive ? h('section', {class: 'lst-card'}, h('h3', {}, '商品分组存档 · 每组最多 100 款'),
      h('p', {class: 'muted'}, '勾选一组或多组再执行：逐批读退货率，合格的上传到服务器。关闭软件后可继续；这里不会提交到亚马逊。'),
      h('div', {class: 'lst-actions'},
        btn('全选组', () => { for (const g of groups) selectedGroups.add(g.id); ctx.render(true); }),
        btn('清空选择', () => { for (const g of groups) selectedGroups.delete(g.id); ctx.render(true); }),
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
          selectedGroups.clear(); ctx.render(true);
        }, {primary: true, disabled: offline() || !groups.some(g => selectedGroups.has(g.id))}),
        btn('查看全部商品', () => go({page: 'list', id: list.id}))),
      h('table', {class: 'lst-table'}, h('thead', {}, h('tr', {}, ['选择', '分组', '商品数', '进度', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, groups.map(g => {
          const check = h('input', {type: 'checkbox', 'aria-label': '选择' + g.label}); check.checked = selectedGroups.has(g.id);
          check.addEventListener('change', () => { check.checked ? selectedGroups.add(g.id) : selectedGroups.delete(g.id); ctx.render(true); });
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
        const next = s === 'retry' ? btn('重新筛选', () => ctx.rescreen([c]), {disabled: offline() || runner.busy()})
          : c.stage === 'skipped' ? btn('恢复', () => ctx.skip([c], false)) : h('span', {class: 'muted'}, '—');
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
      bulk.append(btn('重新筛选 ' + open.length + ' 款', () => ctx.rescreen(open), {primary: true, disabled: offline() || runner.busy()}));
      bulk.append(btn('不筛这 ' + open.length + ' 款', () => { ctx.skip(open, true); selected.clear(); }));
    }
    bulk.append(h('button', {type: 'button', onclick: () => { selected.clear(); renderTableOnly(); }}, '取消选择'));
  }

  function renderTableOnly() {
    if (ctx.route.page !== 'list') return;
    const list = store.list(ctx.route.id);
    if (!list) return;
    const group = list.groups?.find(g => g.id === ctx.route.groupId), scope = group ? new Set(group.codes) : null;
    const all = sorted(store.cardsFor(list).filter(c => !scope || scope.has(c.sku)));
    const filter = ctx.route.filter || 'all', q = (ctx.route.q || '').trim().toUpperCase();
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
    if (!tbody && shown.length) { ctx.render(true); return; }
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
  Object.assign(ctx, {lists, listPage, uploadedPage, renderTableOnly});
}
