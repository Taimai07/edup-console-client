// Hidden-window trace of desktop/main.cjs normal startup (not --self-check); run by run-native-main.cjs.
// usage: electron native-main-trace.cjs <clientDir> <outJson>
// Records what main.cjs registers and what every maintenance action returns, with all network blocked and a temp userData.
const electron = require('electron');
const {app, ipcMain, dialog, shell, clipboard, BrowserWindow, Menu, protocol, session, net} = electron;
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const clientDir = path.resolve(process.argv[2]), outFile = path.resolve(process.argv[3]);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edup-trace-'));
app.setPath('userData', path.join(temp, 'user'));
const trace = {ipcHandles: [], appOn: [], calls: [], dialogs: [], shell: [], clipboard: [], windowInfo: null, menu: null, results: {}, logs: null};
const handlers = {};
const origHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (ch, fn) => { trace.ipcHandles.push(ch); handlers[ch] = fn; return origHandle(ch, fn); };
const origOn = app.on.bind(app);
app.on = (ev, fn) => { trace.appOn.push(ev); return origOn(ev, fn); };
// block every way out to the network
net.request = () => { throw Error('HARNESS_NET_BLOCKED'); };
app.once('ready', () => { Object.getPrototypeOf(session.defaultSession).fetch = async () => { throw Error('HARNESS_FETCH_BLOCKED'); }; });
// no real dialogs / shell / clipboard
let nextOpen = {canceled: true}, nextSave = {canceled: true};
dialog.showOpenDialog = async (_w, o) => { trace.dialogs.push(['open', o.title]); return nextOpen; };
dialog.showSaveDialog = async (_w, o) => { trace.dialogs.push(['save', o.title, o.defaultPath.replace(/\d{4}-\d{2}-\d{2}/, 'DATE'), JSON.stringify(o.filters)]); return nextSave; };
dialog.showMessageBox = async (_w, o) => { trace.dialogs.push(['message', o.title]); return {response: 1}; };
dialog.showErrorBox = (t, c) => { trace.dialogs.push(['error', t, c]); };
shell.openExternal = async u => { trace.shell.push(['openExternal', u]); };
shell.openPath = async p => { trace.shell.push(['openPath', p]); return ''; };
clipboard.writeText = t => { trace.clipboard.push(t.replace(/\\/g, '/').replace(/.*\//, '')); };
BrowserWindow.prototype.show = function () { trace.calls.push('win.show'); };
BrowserWindow.prototype.showInactive = function () { trace.calls.push('win.showInactive'); };
let win;
app.on('browser-window-created', (_e, w) => { win = w; });
const norm = v => JSON.parse(JSON.stringify(v ?? null, (k, x) => x === undefined ? '__undefined__' : x).split(temp.replace(/\\/g, '\\\\')).join('<TMP>').replace(/[0-9a-f]{64}/g, '<HASH64>').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ISO>'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(label, ...args) {
  try { trace.results[label] = {ok: norm(await handlers['edup:maintenance'](...args))}; }
  catch (e) { trace.results[label] = {err: String(e.message)}; }
}
async function main() {
  require(path.join(clientDir, 'desktop', 'main.cjs'));
  for (let i = 0; i < 100 && !(handlers['edup:ui-ready'] && win); i++) await sleep(100);
  trace.windowInfo = {title: win.getTitle(), minSize: win.getMinimumSize(), size: win.getSize(), visible: win.isVisible(), prefs: (({nodeIntegration, contextIsolation, sandbox}) => ({nodeIntegration, contextIsolation, sandbox}))(win.webContents.getLastWebPreferences()), protocolHandled: protocol.isProtocolHandled('edup')};
  trace.menu = Menu.getApplicationMenu()?.items.map(i => i.label + ':' + (i.submenu?.items.length ?? 0));
  // wait for the page to load and tell us it is ready (its own calls go through the real preload/handlers)
  for (let i = 0; i < 200 && !fs.existsSync(path.join(temp, 'user', 'logs')) ; i++) await sleep(100);
  for (let i = 0; i < 150; i++) { let r = null; try { r = await handlers['edup:ui-ready']({sender: win.webContents, senderFrame: win.webContents.mainFrame}); } catch {} if (r) break; await sleep(100); }
  const ev = () => ({sender: win.webContents, senderFrame: win.webContents.mainFrame});
  trace.windowInfo.url = win.webContents.getURL();
  const uiTwice = await handlers['edup:ui-ready'](ev());
  trace.results['ui-ready-again'] = {ok: uiTwice};
  const bad = {sender: {}, senderFrame: {url: 'edup://console/'}};
  await call('bad-sender', bad, 'settings');
  const S = (label, action, arg) => call(label + ':' + action, ev(), action, arg);
  const sample = path.join(temp, 'material.txt'); fs.writeFileSync(sample, 'hello material');
  const seq = [
    ['settings'], ['ai-view-get'], ['ai-view-save', null], ['ai-view-save', {thread: null, drafts: {_new: 'x', bad: 'y'}}], ['ai-view-save', {thread: 'zz', drafts: {}}], ['ai-view-get'],
    ['ziniao-settings', {site: 'US'}], ['ziniao-save-binding', {}], ['ziniao-save-binding', {site: 'US', binding: {name: 'shop', confirmed: true, storeId: '1', userId: '2', version: '1'}}], ['ziniao-settings', {site: 'US'}], ['ziniao-open', {site: 'US', sku: 'X1'}], ['ziniao-open', {}],
    ['read-cache'], ['write-cache', {products: [{sku: 'A'}], markets: []}], ['read-cache'],
    ['extract-codes', {text: 'W123456789 W987654321 junk'}], ['extract-codes'], ['extract-document'],
    ['upload-material', {jobId: 'j', sku: 's'}],
    ['log-upload-status'], ['upload-error-logs'],
    ['update-status'], ['check-update'], ['download-update'], ['install-update'], ['check-and-install-update'], ['update-status'],
    ['configure', {serverUrl: 'http://x'}], ['configure', {serverUrl: 'https://console.eduplinkaudio.com'}], ['configure', {}], ['configure'],
    ['set-proxy', {mode: 'direct'}], ['set-proxy', {mode: 'bogus'}], ['settings'], ['test-proxy', {}], ['test-proxy', {target: 'server', settings: {mode: 'system'}}],
    ['pair', {}], ['pair', {code: 'abc'}], ['pair', {code: 'abc'}],
    ['giga-browser-status'], ['giga-browser-folder'], ['giga-browser-copy-folder'], ['giga-browser-start', {}], ['giga-store-start', {}], ['giga-browser-task', {id: 'x'}], ['giga-browser-task'], ['giga-browser-reconcile', {id: 'x'}], ['giga-browser-reuse', {}], ['giga-browser-screen', {id: 'x'}],
    ['giga-open-buyer-page', {asin: 'bad'}], ['giga-open-buyer-page', {asin: 'B0ABCDEFGH'}],
    ['listing-event', {code: 'LISTING_X', step: 'browser', segment: 3}], ['listing-event', {code: 'bad', step: 'nope', segment: -1}], ['listing-event'],
    ['diagnostics'],
    ['nope'], ['constructor'], ['__proto__'], ['toString'], [['settings']], [null], [undefined], [{}]
  ];
  for (const [action, arg] of seq) await S(String(Array.isArray(action) ? 'array' : action), action, arg);
  // upload-material with a real file: validateAIRequest is not defined in this program, so this must fail the same way before and after
  nextOpen = {canceled: false, filePaths: [sample]};
  await S('with-file', 'upload-material', {jobId: 'j', sku: 's'});
  nextOpen = {canceled: false, filePaths: [path.join(temp, 'missing.txt')]};
  await S('missing-file', 'extract-document');
  const out = path.join(temp, 'diag.json'); nextSave = {canceled: false, filePath: out};
  await S('with-path', 'diagnostics');
  try { const d = JSON.parse(fs.readFileSync(out, 'utf8')); trace.diagnosticsKeys = Object.keys(d).sort(); trace.diagnosticsClient = Object.keys(d.client).sort(); trace.diagnosticsPaired = d.client.paired; trace.diagnosticsServer = d.server; } catch (e) { trace.diagnosticsKeys = 'ERR ' + e.message; }
  trace.files = fs.readdirSync(path.join(temp, 'user')).sort().filter(n => !/^(Cache|Code Cache|GPUCache|DawnCache|Local Storage|Network|Partitions|Session Storage|SharedStorage|blob_storage|Shared Dictionary|Dictionaries|Preferences|lockfile|.*\.log|.*\.tmp|logs|ai-view.json)$/i.test(n) || n === 'ai-view.json');
  try { trace.config = norm(JSON.parse(fs.readFileSync(path.join(temp, 'user', 'connection.json'), 'utf8'))); } catch (e) { trace.config = 'ERR ' + e.message; }
  // log events: distinct (event, code, route, state) tuples, no times
  const logDir = path.join(temp, 'user', 'logs'), events = new Set();
  try { for (const f of fs.readdirSync(logDir)) for (const line of fs.readFileSync(path.join(logDir, f), 'utf8').split(/\r?\n/).filter(Boolean)) { try { const j = JSON.parse(line); events.add([j.event || j.type || j.name, j.code, j.route, j.state, j.level, j.count, j.version].map(x => x ?? '').join('|')); } catch { events.add('RAW:' + line.slice(0, 60)); } } } catch (e) { events.add('ERR ' + e.message); }
  trace.logs = [...events].sort();
  for (let i = 0; i < 100 && win.webContents.isLoading(); i++) await sleep(100);
  await sleep(500);
  trace.dialogsSorted = trace.dialogs.map(d => JSON.stringify(d));
  fs.writeFileSync(outFile, JSON.stringify(trace, null, 1));
  app.exit(0);
}
main().catch(e => { fs.writeFileSync(outFile, JSON.stringify({harnessError: String(e.stack)})); app.exit(2); });
setTimeout(() => { fs.writeFileSync(outFile, JSON.stringify({harnessError: 'TIMEOUT', partial: trace}, null, 1)); app.exit(3); }, 120000).unref();
