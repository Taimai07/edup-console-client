// The listing workspace wizard: add SKUs (paste / file / store), check conditions, save as groups.
// Split out of listing-app.js unchanged (client round 3); the shared state of one mounted workspace is passed in as `ctx`.
import {h, btn, feedback, bjt} from './listing-kit.js';
import {runner, local, browserState} from './listing-runner.js';
import {renderGigaStore} from '../giga/giga-store.js';
import {extractCodes} from './sku-rules.js';
import {semiStatus} from './listing-status.js';

export function createWizard(ctx) {
  const {store, wizard, go, offline, allCards} = ctx;
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
      h('button', {type: 'button', class: wizard.source === k ? 'is-on' : '', onclick: () => { wizard.source = k; ctx.render(true); }}, t)));
    const area = h('div', {class: 'lst-source'});
    const setExtraction = (value, source) => {
      wizard.extraction = {...value, source};
      wizard.label = wizard.label || (value.store ? '店铺 ' + value.store.name : (source === 'file' ? '文件' : '粘贴') + ' · ' + bjt(Date.now() / 1000));
      ctx.render(true);
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
      if (!b.ok) area.append(feedback('info', '整店导入要先连好大健页面', '现在：' + b.label + '。'), btn('打开连接说明', () => { ctx.helpOpen = true; ctx.render(); }));
      else renderGigaStore(area, {site: store.site, available: !offline(), onImported: ({store: shop, codes, storeSaved}) =>
        setExtraction({store: shop, storeSaved, items: codes.map(code => ({code, reason: '大健店铺', occurrences: 1})), duplicates: 0}, 'store')});
    }
    const out = [h('p', {class: 'muted'}, '站点：' + (store.sites?.sites?.find(s => s.code === store.site)?.name || store.site) + '（在页面顶部切换）'), tabs, area];
    const ex = wizard.extraction;
    if (ex) {
      const codes = ex.items.map(x => x.code), c = classify(codes);
      const skipBox = h('input', {type: 'checkbox'}); skipBox.checked = wizard.skipKnown;
      skipBox.addEventListener('change', () => { wizard.skipKnown = skipBox.checked; ctx.render(true); });
      const label = h('input', {type: 'text', maxlength: '60', value: wizard.label, 'aria-label': '清单名称'});
      label.addEventListener('input', () => { wizard.label = label.value; });
      out.push(h('section', {class: 'lst-summary'}, h('h3', {}, '识别到 ' + codes.length + ' 个编码' + (ex.store ? '（' + ex.store.name + '）' : '')),
        h('p', {}, '新的 ' + c.fresh.length + ' · 已上传服务器 ' + c.uploaded.length + ' · 以前排除过 ' + c.excluded.length),
        c.uploaded.length ? h('label', {class: 'lst-inline'}, skipBox, ' 跳过已上传服务器的 ' + c.uploaded.length + ' 款（推荐）') : null,
        h('details', {}, h('summary', {}, '展开逐款核对'), h('p', {class: 'lst-codes'}, codes.join('、'))),
        h('label', {class: 'lst-field'}, h('span', {}, '清单名称'), label)),
      h('div', {class: 'lst-actions'}, btn('下一步', () => { wizard.step = 2; ctx.render(true); }, {primary: true, disabled: !wizardCodes().length})));
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
      !b.ok ? btn('打开连接说明', () => { ctx.helpOpen = true; ctx.render(); }) : null,
      h('section', {class: 'lst-summary'}, h('h3', {}, '怎么跑'), h('ul', {}, [
        '共 ' + n + ' 款，保存成 ' + Math.ceil(n / 100) + ' 个分组，每组最多 100 款。',
        '每段先在大健页面读退货率、收藏通过的商品，再把合格的 SKU 上传到服务器。',
        '上传之后的资料准备、核验和上架由服务器后台处理，这个软件不再参与。',
        '保存后由你选择要执行的组。组内逐批读取，读取冷却 30 秒。',
        '中途切到别的页面不会中断。关掉软件的话，下次打开会提示从哪里继续。',
      ].map(t => h('li', {}, t)))),
      h('div', {class: 'lst-actions'}, h('button', {type: 'button', onclick: () => { wizard.step = 1; ctx.render(true); }}, '上一步'),
        btn('重新检查', async () => { await Promise.all([store.refreshBrowser(), store.refreshService()]); ctx.render(true); }),
        btn('下一步', () => { wizard.step = 3; ctx.render(true); }, {primary: true, disabled: !siteOk}))];
  }

  function wizardThree() {
    const codes = wizardCodes();
    return [h('p', {}, '将保存 ' + codes.length + ' 款为 ' + Math.ceil(codes.length / 100) + ' 个分组（' + store.site + ' 站，清单「' + (wizard.label || '未命名') + '」）。'),
      h('p', {class: 'muted'}, '这里只筛选退货率并上传合格 SKU，不会提交到亚马逊。'),
      h('div', {class: 'lst-actions'}, h('button', {type: 'button', onclick: () => { wizard.step = 2; ctx.render(true); }}, '上一步'),
        btn('保存 ' + Math.ceil(codes.length / 100) + ' 个分组', () => {
          const id = crypto.randomUUID(), ex = wizard.extraction;
          const list = {id, label: wizard.label || '清单', site: store.site, created: Math.floor(Date.now() / 1000), codes, jobs: [], source: ex.source,
            backupId: crypto.randomUUID(), backup: 'saving', kind: 'prepare', store: ex.store};
          local.saveList(list);
          ctx.startBackup(list, ex.store);
          Object.assign(wizard, {step: 1, text: '', extraction: null, label: ''});
          go({page: 'list', id});
        }, {primary: true, disabled: !codes.length || runner.busy(), title: runner.busy() ? '上一项还在进行，完成后再开始' : ''}))];
  }
  Object.assign(ctx, {wizardPage});
}
