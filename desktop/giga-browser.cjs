'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const REGIONS = Object.freeze({DE: [81, 'DEU'], US: [223, 'USA'], GB: [222, 'GBR'], CA: [38, 'CAN'], JP: [107, 'JPN']});
class GigaBrowser {
  constructor({directory, now = () => Date.now() / 1000} = {}) { this.directory = directory; this.now = now; }
  root() {
    if (this.directory) return this.directory;
    try {
      const output = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/reg.exe'),
        ['query', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.eduplink.giga_browser', '/ve'],
        {encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']});
      const manifestPath = output.match(/REG_SZ\s+(.+)/)?.[1]?.trim();
      if (!manifestPath || !path.isAbsolute(manifestPath)) throw Error();
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name !== 'com.eduplink.giga_browser') throw Error();
      const location = JSON.parse(fs.readFileSync(path.join(path.dirname(manifest.path), 'bridge-state.json'), 'utf8'));
      if (location.format !== 'edup-giga-bridge-v1' || !path.isAbsolute(location.directory)) throw Error();
      this.extensionDirectory = location.extensionDirectory;
      this.directory = location.directory; return this.directory;
    } catch { throw Error('GIGA_BROWSER_SETUP_REQUIRED'); }
  }
  read(name) {
    try {
      const file = path.join(this.root(), name);
      if (fs.statSync(file).size > 131072) throw Error('GIGA_BROWSER_RECEIPT_TOO_LARGE');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  write(name, value) {
    const root = this.root(); fs.mkdirSync(root, {recursive: true});
    const target = path.join(root, name), tmp = target + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value), {mode: 0o600, flag: 'wx'}); fs.renameSync(tmp, target);
  }
  status() {
    try {
      const connection = this.read('connection.json'), heartbeat = this.read('heartbeat.json');
      const age = this.now() - (heartbeat?.at || 0), inspection = connection?.inspection;
      return {connected: age >= -5 && age < 10 && !!inspection, inspection: inspection || null,
        extensionProtocol: connection?.extensionProtocol || 0};
    } catch { return {connected: false, code: 'GIGA_BROWSER_SETUP_REQUIRED'}; }
  }
  folder() {
    this.root();
    if (!this.extensionDirectory || !path.isAbsolute(this.extensionDirectory) ||
      !fs.existsSync(path.join(this.extensionDirectory, 'manifest.json'))) throw Error('GIGA_BROWSER_SETUP_REQUIRED');
    return this.extensionDirectory;
  }
  validate({site, codes}) {
    if (!REGIONS[site]) throw Error('GIGA_REGION_MAPPING_NOT_VERIFIED');
    if (!Array.isArray(codes) || !codes.length || codes.length > 20 || new Set(codes).size !== codes.length ||
      codes.some(s => typeof s !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(s))) throw Error('GIGA_CODES_INVALID');
    return {site, codes: [...codes]};
  }
  start(input) {
    return this.createTask(input, 'read_rates');
  }
  startApproved(evidence, screen) {
    const approved = screen?.approved;
    if (!approved || typeof approved !== 'object' || Array.isArray(approved) ||
      !/^[a-f0-9-]{36}$/.test(screen.id) || !Array.isArray(screen.excluded)) throw Error('GIGA_RETURN_SCREEN_SCOPE_INVALID');
    const codes = Object.keys(approved);
    const observed = new Map(evidence.items.map(row => [row.sku, row.productId]));
    const excluded = new Set(screen.excluded.map(row => row.sku));
    if (excluded.size !== screen.excluded.length || observed.size !== codes.length + excluded.size ||
      codes.some(sku => !observed.has(sku) || observed.get(sku) !== approved[sku] || excluded.has(sku)) ||
      screen.excluded.some(row => !observed.has(row.sku) || !['RETURN_RATE_NOT_LOW','RETURN_RATE_UNVERIFIED'].includes(row.state)))
      throw Error('GIGA_RETURN_SCREEN_SCOPE_INVALID');
    return {excluded: screen.excluded, task: codes.length ? this.createTask({site:evidence.site, codes}, 'favorites', approved, screen.id) : null};
  }
  createTask(input, phase, approved, screenId) {
    const frozen = this.validate(input), status = this.status(), [countryId, countryCode] = REGIONS[frozen.site];
    if (!status.connected) throw Error('GIGA_BROWSER_NOT_CONNECTED');
    if (status.extensionProtocol !== 4) throw Error('GIGA_BROWSER_UPDATE_REQUIRED');
    const current = status.inspection;
    if (current.loggedIn !== true || current.buyer !== true || current.countryId !== countryId || current.countryCode !== countryCode)
      throw Error('GIGA_BROWSER_REGION_MISMATCH');
    const prior = this.read('request.json');
    if (prior && !this.read(prior.id + '.result.json') &&
      (prior.expiresAt > this.now() || this.read(prior.id + '.dispatch.json'))) throw Error('GIGA_BROWSER_TASK_REQUIRES_RECONCILIATION');
    const id = crypto.randomUUID(), task = {id, op: phase, site: frozen.site, skus: frozen.codes, expiresAt: this.now() + 1800,
      ...(phase === 'favorites' ? {approved} : {})};
    this.write(id + '.client-task.json', {...task, ...(screenId ? {screenId} : {})});
    this.write('request.json', task);
    return {id, state: 'waiting_for_browser', site: frozen.site, codes: frozen.codes};
  }
  task(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw Error('GIGA_BROWSER_TASK_ID_INVALID');
    const task = this.read(id + '.client-task.json');
    if (!task || task.id !== id) throw Error('GIGA_BROWSER_TASK_NOT_FOUND');
    const saved = this.read(id + '.result.json');
    if (!saved) return {id, state: this.read(id + '.dispatch.json') ? 'running_in_browser' : 'waiting_for_browser'};
    const result = saved.result, [countryId, countryCode] = REGIONS[task.site];
    const read = task.op === 'read_rates';
    if (read && task.expiresAt < this.now()) return {id, state:'stopped', code:'TASK_EXPIRED'};
    if (result?.state !== (read ? 'DETAIL_RATES_READ' : 'APPROVED_FAVORITES_VERIFIED'))
      return {id, state: 'stopped', code: result?.code || 'GIGA_FAVORITES_NOT_VERIFIED'};
    const rows = result.items;
    const states = read ? ['RATE_LOW','RATE_MEDIUM','RATE_HIGH','RATE_UNVERIFIED']
      : ['DETAIL_LOW_ADDED','DETAIL_LOW_ALREADY_SAVED','DETAIL_LOW_RECONCILED'];
    if (result.taskId !== id || result.countryId !== countryId || result.countryCode !== countryCode || result.amazonSubmitted !== false ||
      !Array.isArray(rows) || rows.length !== task.skus.length ||
      rows.some(row => !row || !task.skus.includes(row.sku) || !states.includes(row.state) ||
        typeof row.productId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.productId) || (!read && task.approved?.[row.sku] !== row.productId)) ||
      new Set(rows.map(row => row.sku)).size !== rows.length || new Set(rows.map(row => row.productId)).size !== rows.length)
      throw Error('GIGA_BROWSER_RECEIPT_SCOPE_MISMATCH');
    return {id, state: read ? 'rates_read' : 'verified', site: task.site, countryId, countryCode, codes: [...task.skus], items: rows,
      ...(read ? {} : {screenId: task.screenId})};
  }
}
module.exports = {GigaBrowser, REGIONS};
