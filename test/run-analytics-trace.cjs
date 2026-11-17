// Behaviour record of ui/operations/analytics.js (every export, with a fake DOM and a frozen clock), so the split can be proven to change nothing.
// node test/run-analytics-trace.cjs --record   : write test/analytics-trace.golden.json (do this on the unsplit code)
// node test/run-analytics-trace.cjs            : compare with the golden file
// EDUP_CLIENT_DIR=<other client dir>            : run the same steps against another copy of client/
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const record = process.argv.includes('--record');
const client = path.resolve(process.env.EDUP_CLIENT_DIR || path.join(__dirname, '..'));
const golden = path.join(__dirname, 'analytics-trace.golden.json');

const FIXED = Date.parse('2026-11-16T04:30:00Z');
const RealDate = Date;
global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };

function node(tag) {
  const n = {tag, attrs: {}, kids: [], text: undefined, className: '', listeners: {}};
  n.classList = {add: c => { n.className = (n.className ? n.className + ' ' : '') + c; }};
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.append = (...xs) => { for (const x of xs) n.kids.push(x); };
  n.getBoundingClientRect = () => ({left: 0, width: 600});
  Object.defineProperty(n, 'textContent', {get: () => n.text, set: v => { n.text = String(v); }});
  return n;
}
global.document = {createElement: node, createElementNS: (ns, tag) => node(tag)};
const dump = n => ({tag: n.tag, attrs: n.attrs, cls: n.className, text: n.text, kids: n.kids.map(dump)});

(async () => {
  const mod = await import(pathToFileURL(path.join(client, 'ui', 'operations', 'analytics.js')).href);
  const out = [];
  const add = (name, value) => out.push({name, value: value === undefined ? '#undefined' : value});
  add('export names', Object.keys(mod).sort());

  const D = '2026-11-16';
  const hour = (h, units, orders, amount, cur = 'USD') => ({interval: D + 'T' + String(h).padStart(2, '0') + ':00:00+08:00--x', unitCount: units, orderCount: orders, totalSales: {amount: String(amount), currencyCode: cur}});
  const days = (cur, base) => Array.from({length: 16}, (_, i) => ({interval: new Date(Date.parse('2026-10-31T00:00:00+08:00') + i * 864e5).toISOString().slice(0, 10) + 'T00:00:00+08:00--x', unitCount: 3 + i % 4, orderCount: 2, totalSales: {amount: String(base + i * 3), currencyCode: cur}}));
  const data = {
    sourceAsOf: 'src',
    fx: {date: '2026-11-15', source: 'ECB', toUSD: {EUR: 1.1, GBP: 1.25}},
    operating: {
      day: D, generatedAt: 'gen',
      sites: {
        US: {state: 'ok', asOf: 'a-us', hourly: [hour(0, 1, 1, 10.5), hour(1, 2, 1, 20)], daily: days('USD', 100)},
        DE: {state: 'ok', asOf: 'a-de', hourly: [hour(0, 4, 2, 30, 'EUR'), hour(1, 1, 1, 5, 'JPY')], daily: days('EUR', 40)},
        FR: {state: 'error', hourly: [hour(0, 9, 9, 99)], daily: []}
      },
      profit: {
        day: D,
        views: {
          ALL: {profitUSD: 12.5, coveredUnits: 5, totalUnits: 7, complete: false, note: 'n', basis: 'b', missing: ['X'], hourly: [{date: D + 'T00:00:00+08:00', currency: 'USD', value: 1}, {date: D + 'T01:00:00+08:00', currency: 'USD', value: null}]},
          US: {profitUSD: 7, coveredUnits: 3, totalUnits: 3, complete: true, hourly: []}
        },
        history: {views: {US: [{date: '2026-11-10', currency: 'USD', value: 2}, {date: '2026-11-12', currency: 'USD', value: -1}]}}
      }
    },
    products: [{site: 'US', issues: ['i1']}, {site: 'DE', issues: []}, {site: 'US', issues: []}],
    insights: [{site: 'US', title: 't-us'}, {site: 'DE', title: 't-de'}]
  };

  add('names', [mod.names, mod.siteNames]);
  add('el', dump(mod.el('div', 'hi', 'c')));
  add('el no text', dump(mod.el('span')));
  add('card', dump(mod.card('title', 'sub')));
  add('card no text', dump(mod.card('title')));
  add('number', [null, undefined, '', 0, '12', 1234567.891, 'abc', NaN, 0.005].map(mod.number));
  add('bjtDay/today', [mod.bjtDay(new Date('2026-11-15T16:30:00Z')), mod.bjtDay(new Date('2026-11-15T15:59:00Z')), mod.today()]);
  add('entries', ['ALL', 'US', 'FR', 'XX'].map(s => mod.entries(data, s).map(([k]) => k)));
  add('entries empty', mod.entries({}, 'ALL'));
  add('usd', [mod.usd(5, 'USD', data.fx), mod.usd(5, 'EUR', data.fx), mod.usd(5, 'JPY', data.fx), mod.usd(0, 'JPY', data.fx), mod.usd('', 'USD'), mod.usd(null, 'USD'), mod.usd('x', 'USD'), mod.usd(5, 'EUR')]);
  add('sumUSD', [mod.sumUSD({USD: 1, EUR: 2}, data.fx), mod.sumUSD({USD: 1, JPY: 2}, data.fx), mod.sumUSD({}, data.fx)]);
  add('usdText/moneyText/fxNote', [mod.usdText(null), mod.usdText(undefined), mod.usdText(1234.5), mod.moneyText({USD: 1, EUR: 2.5}), mod.moneyText({}), mod.fxNote(data), mod.fxNote({})]);
  add('profitView', [mod.profitView(data, 'ALL'), mod.profitView(data, 'XX'), mod.profitView({}, 'US'), mod.profitView({operating: {profit: {day: 'old', views: {US: {}}}}}, 'US')]);
  add('totals', [mod.totals(data, 'ALL'), mod.totals(data, 'US'), mod.totals(data, 'FR'), mod.totals({operating: {day: 'old', sites: data.operating.sites}}, 'ALL'), mod.totals({}, 'ALL')]);
  add('salesSeries', ['sales', 'units', 'orders'].flatMap(k => ['today', '7', '30', 'all'].map(span => mod.salesSeries(data, 'ALL', k, span))));
  add('salesSeries US', mod.salesSeries(data, 'US', 'sales', '7'));
  add('profitSeries', [['today'], ['7'], ['30'], ['all'], ['today', '2026-11-10', ''], ['all', '', '2026-11-13'], ['7', '2026-11-12', '2026-11-16'], ['all', '2026-12-01', '']].map(a => mod.profitSeries(data, 'US', ...a)));
  add('profitSeries ALL today', mod.profitSeries(data, 'ALL'));
  add('profitSeries none', [mod.profitSeries({}, 'US'), mod.profitSeries({operating: {profit: {history: {views: {US: []}}}}}, 'US', '7')]);
  add('axisScale', [[1, 2, 3], [-5, 10], [0], [0.001, 0.004], [100, 2000, 55555], [-1]].map(v => mod.axisScale(v)));
  add('table', dump(mod.table(['a', 'b'], [[1, null], [undefined, 'x']])));

  const rows = [{date: '2026-11-01', value: 3}, {date: '2026-11-02', value: null}, {date: '2026-11-03', value: 8.5}, {date: '2026-11-04', value: -2}, {date: '2026-11-05', value: 5}];
  const hourRows = Array.from({length: 24}, (_, i) => ({date: D + 'T' + String(i).padStart(2, '0') + ':00:00.000+08:00', value: i % 5 === 0 ? null : i * 1.5}));
  add('chart days', dump(mod.chart('趋势', rows, {unit: '件', note: 'n'})));
  add('chart hours', dump(mod.chart('小时', hourRows, {unit: 'USD'})));
  add('chart range', dump(mod.chart('范围', rows, {start: '2026-11-02', end: '2026-11-04'})));
  add('chart empty', dump(mod.chart('空', [{date: '2026-11-01', value: null}])));
  add('chart single', dump(mod.chart('一点', [{date: '2026-11-01', value: 4}])));
  const c = mod.chart('交互', rows, {unit: '件'});
  const svg = c.kids.find(k => k.className === 'chart-scroll').kids[0], readout = c.kids.find(k => k.className === 'chart-readout');
  const steps = [readout.text];
  svg.onpointermove({clientX: 10}); steps.push(readout.text);
  svg.onpointermove({clientX: 590}); steps.push(readout.text);
  for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight']) { let prevented = false; svg.onkeydown({key, preventDefault() { prevented = true; }}); steps.push(readout.text + '|' + prevented); }
  svg.onkeydown({key: 'a', preventDefault() { steps.push('WRONG'); }});
  add('chart interaction', {steps, cursor: svg.kids.find(k => k.attrs['stroke-dasharray'] === '5 4' && k.attrs.d !== undefined).attrs});
  add('strategies', ['ALL', 'US', 'DE', 'FR'].map(s => mod.strategies(data, s)));
  const quiet = {...data, operating: {...data.operating, sites: {US: {state: 'ok', daily: days('USD', 1).map(x => ({...x, unitCount: 0}))}}}, products: []};
  add('strategies quiet', [mod.strategies(quiet, 'ALL'), mod.strategies({...quiet, operating: undefined}, 'ALL')]);
  const falling = {...data, operating: {...data.operating, sites: {US: {state: 'ok', asOf: 'z', daily: days('USD', 500).map((x, i) => ({...x, totalSales: {...x.totalSales, amount: String(1000 - i * 40)}}))}}}, products: []};
  add('strategies falling', mod.strategies(falling, 'US'));

  add('axisScale extra', [[18], [0, 2.3], [7, 7.1], [-3.3, 21]].map(v => mod.axisScale(v)));
  const long = Array.from({length: 40}, (_, i) => ({date: new Date(Date.parse('2026-10-01T00:00:00Z') + i * 864e5).toISOString().slice(0, 10), value: (i * 7) % 11}));
  add('chart 40 days', dump(mod.chart('长', long, {unit: 'x'})));
  add('chart 19 days', dump(mod.chart('十九', long.slice(0, 19))));
  const many = {}; for (let i = 0; i < 8; i++) many['S' + i] = {state: 'ok', asOf: 'm' + i, daily: days('USD', 50 + i * 20).map((x, j) => ({...x, unitCount: i === 7 ? (j === 0 ? 5 : 0) : i === 6 ? (j === 0 ? 4 : 0) : 1, totalSales: {...x.totalSales, amount: String(100 + ((i + 1) * j * 37) % 90 - i * 3)}}))};
  add('strategies many', mod.strategies({...data, operating: {...data.operating, sites: many}, products: []}, 'ALL'));
  add('strategies zero base', mod.strategies({...data, operating: {...data.operating, sites: {Z: {state: 'ok', asOf: 'q', daily: days('USD', 0).map(x => ({...x, totalSales: {...x.totalSales, amount: '0'}}))}}}, products: []}, 'ALL'));
  const text = JSON.stringify({steps: out.length, trace: out}, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? '#nonfinite:' + String(v) : v), 1);
  if (record) { fs.writeFileSync(golden, text); console.log('recorded ' + out.length + ' steps'); return; }
  if (process.env.EDUP_DUMP) { fs.writeFileSync(process.env.EDUP_DUMP, text); return; }
  if (fs.readFileSync(golden, 'utf8').replace(/\r\n/g, '\n') !== text) throw Error('ANALYTICS_TRACE_DIFFERENT: ui/operations/analytics.js no longer behaves as recorded in test/analytics-trace.golden.json');
  console.log(JSON.stringify({passed: true, steps: out.length}));
})().catch(e => { console.error(e); process.exit(1); });
