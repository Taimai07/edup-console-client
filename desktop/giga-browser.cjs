'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const REGIONS = Object.freeze({DE: [81, 'DEU'], US: [223, 'USA'], GB: [222, 'GBR'], CA: [38, 'CAN'], JP: [107, 'JPN']});
const storeId = /^[1-9][0-9]{0,14}$/;
const storeCode = /^[A-Z0-9][A-Z0-9_.-]{0,39}$/;
const productCode = /^[A-Z0-9][A-Z0-9_.-]{2,39}$/;
const controls = /[\x00-\x1f\x7f]/;
const KNOWN_LIMIT = 3000;
const RATE_READ = ['RATE_LOW', 'RATE_NA', 'RATE_MEDIUM', 'RATE_HIGH'];
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
        extensionProtocol: connection?.extensionProtocol || 0, storeCatalog: connection?.storeCatalog === true,
        accountScopeV2: connection?.accountScopeV2 === true, knownProducts: connection?.knownProducts === true,
        connectedAt: connection?.connectedAt};
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
    if (!Array.isArray(codes) || !codes.length || codes.length > 30 || new Set(codes).size !== codes.length ||
      codes.some(s => typeof s !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(s))) throw Error('GIGA_CODES_INVALID');
    return {site, codes: [...codes]};
  }
  start(input) {
    return this.createTask(input, 'read_rates');
  }
  reusableFavorites({site, codes}) {
    if (!REGIONS[site] || !Array.isArray(codes) || !codes.length ||
        new Set(codes).size !== codes.length ||
        codes.some(sku => typeof sku !== 'string' || !/^[A-Z0-9][A-Z0-9_.-]{2,39}$/.test(sku)))
      throw Error('GIGA_CODES_INVALID');
    const missing = new Set(codes);
    const receipts = [];
    const reasons = new Map();
    const result = () => ({receipts, missing: [...missing],
      missingDetails: [...missing].map(sku => ({sku, reason: reasons.get(sku) || 'NO_FAVORITE_EVIDENCE'}))});
    const connection=this.read('connection.json'), inspection=connection?.inspection;
    const [countryId,countryCode]=REGIONS[site];
    if (!Number.isFinite(connection?.connectedAt) || connection.extensionProtocol !== 4 ||
        inspection?.loggedIn !== true || inspection?.buyer !== true ||
        inspection.countryId !== countryId || inspection.countryCode !== countryCode)
      return result();
    const names = fs.readdirSync(this.root()).filter(name => /^[a-f0-9-]{36}\.client-task\.json$/.test(name));
    const tasks = names.flatMap(name => {
      try {
        const task = this.read(name);
        if (task && ['favorites','read_rates'].includes(task.op) && task.site === site &&
            name === task.id + '.client-task.json' &&
            Array.isArray(task.skus) && Number.isFinite(task.expiresAt)) return [task];
      } catch (_) { /* unreadable evidence needs fresh verification */ }
      return [];
    }).sort((left,right) => right.expiresAt-left.expiresAt);
    const seen=new Set();
    for (const task of tasks) {
      if (!missing.size) break;
      const candidates=new Set(task.skus.filter(sku=>missing.has(sku)&&!seen.has(sku)));
      if (!candidates.size) continue;
      // A newer read, mismatch or unfinished favorite must never revive older evidence.
      for(const sku of candidates)seen.add(sku);
      const issued=task.expiresAt-1800, age=this.now()-issued;
      let receipt;
      try {
        // Historical read receipts explain a hold. Admission still uses task() and its freshness checks.
        const saved = this.read(task.id + '.result.json');
        if (saved) receipt = this.productReceipt(task, saved.result);
      } catch (_) { /* an invalid receipt cannot supply a result */ }
      if (task.op === 'read_rates') {
        for (const row of receipt?.items || []) if (candidates.has(row.sku)) reasons.set(row.sku, row.state);
        continue;
      }
      if (receipt?.state !== 'verified' || !/^[a-f0-9-]{36}$/.test(task.screenId||'') || (connection.accountScopeV2&&!receipt.buyerHash)) {
        for (const sku of candidates) reasons.set(sku, 'FAVORITE_NOT_VERIFIED');
        continue;
      }
      // The server issues its one-hour approval before the favorite task is created.
      if (issued < connection.connectedAt || age < 0 || age >= 3300) {
        const reason = issued < connection.connectedAt ? 'FAVORITE_CONNECTION_CHANGED' : 'FAVORITE_EXPIRED';
        for (const sku of candidates) reasons.set(sku, reason);
        continue;
      }
      const items = receipt.items.filter(row => candidates.has(row.sku));
      if (!items.length) continue;
      const matched = items.map(row => row.sku);
      for (const sku of matched) missing.delete(sku);
      receipts.push({site, screenId: receipt.screenId, codes: matched, items, excluded: [],
        ...(receipt.buyerHash?{buyerHash:receipt.buyerHash}:{})});
    }
    return result();
  }
  startApproved(evidence, screen) {
    const approved = screen?.approved;
    if (!approved || typeof approved !== 'object' || Array.isArray(approved) ||
      !/^[a-f0-9-]{36}$/.test(screen.id) || !Array.isArray(screen.excluded)) throw Error('GIGA_RETURN_SCREEN_SCOPE_INVALID');
    if (evidence.buyerHash && evidence.buyerHash !== screen.buyerHash) throw Error('GIGA_BUYER_SCOPE_REQUIRED');
    const codes = Object.keys(approved);
    const observed = new Map(evidence.items.map(row => [row.sku, row.productId]));
    const excluded = new Set(screen.excluded.map(row => row.sku));
    if (excluded.size !== screen.excluded.length || observed.size !== codes.length + excluded.size ||
      codes.some(sku => !observed.has(sku) || observed.get(sku) !== approved[sku] || excluded.has(sku)) ||
      screen.excluded.some(row => !observed.has(row.sku) || !['RETURN_RATE_NOT_LOW','RETURN_RATE_UNVERIFIED'].includes(row.state)))
      throw Error('GIGA_RETURN_SCREEN_SCOPE_INVALID');
    return {excluded: screen.excluded, task: codes.length ? this.createTask({site:evidence.site, codes}, 'favorites', approved, screen.id, evidence.buyerHash) : null};
  }
  createTask(input, phase, approved, screenId, expectedBuyerHash) {
    const frozen = this.validate(input);
    const connection=this.requireConnection(frozen.site);
    if(frozen.codes.length>20&&!connection.accountScopeV2)throw Error('GIGA_BROWSER_UPDATE_REQUIRED');
    let buyerScope={};
    if(connection.accountScopeV2){
      let saved=this.read('buyer-scope.json');
      if(!saved){saved={salt:crypto.randomBytes(32).toString('hex')};this.write('buyer-scope.json',saved);}
      if(!/^[a-f0-9]{64}$/.test(saved.salt)|| (phase==='favorites'&&!/^[a-f0-9]{64}$/.test(expectedBuyerHash||'')))
        throw Error('GIGA_BUYER_SCOPE_REQUIRED');
      buyerScope={buyerSalt:saved.salt,...(phase==='favorites'?{expectedBuyerHash}:{})};
    }
    // 0.8.2: product IDs seen in earlier verified receipts let extension 0.4.4 open the product
    // page directly instead of searching; the page still has to show the exact SKU.
    const known = phase === 'read_rates' && connection.knownProducts ? this.knownFor(frozen.site, frozen.codes) : null;
    const task = this.issueTask({op: phase, site: frozen.site, skus: frozen.codes,
      ...buyerScope,...(phase === 'favorites' ? {approved} : {}), ...(known ? {known} : {})}, screenId ? {screenId} : {});
    return {id: task.id, state: 'waiting_for_browser', site: frozen.site, codes: frozen.codes};
  }
  // SKU -> GIGA product ID, one small file per site, newest last, at most KNOWN_LIMIT entries.
  knownFile(site) { return 'known-products-' + site + '.json'; }
  knownMap(site) {
    try {
      const saved = this.read(this.knownFile(site));
      if (saved?.version === 1 && saved.site === site && saved.ids && typeof saved.ids === 'object' && !Array.isArray(saved.ids)) return saved.ids;
    } catch { /* a damaged file only costs searches */ }
    return {};
  }
  knownFor(site, codes) {
    const ids = this.knownMap(site), out = {}, used = new Set();
    for (const sku of codes) {
      const id = Object.hasOwn(ids, sku) ? ids[sku] : null;
      if (typeof id === 'string' && storeId.test(id) && !used.has(id)) { out[sku] = id; used.add(id); }
    }
    return Object.keys(out).length ? out : null;
  }
  remember(site, rows) {
    if (!REGIONS[site] || !rows.length) return;
    const ids = this.knownMap(site);
    let changed = false;
    for (const {sku, productId} of rows) {
      if (typeof sku !== 'string' || !productCode.test(sku) || typeof productId !== 'string' || !storeId.test(productId)) continue;
      // An ID now verified for this SKU replaces any other SKU that claimed it.
      for (const [other, id] of Object.entries(ids)) if (id === productId && other !== sku) { delete ids[other]; changed = true; }
      if (ids[sku] !== productId) { delete ids[sku]; ids[sku] = productId; changed = true; }
    }
    if (!changed) return;
    const keys = Object.keys(ids);
    for (const sku of keys.slice(0, Math.max(0, keys.length - KNOWN_LIMIT))) delete ids[sku];
    try { this.write(this.knownFile(site), {version: 1, site, ids}); } catch { /* best effort */ }
  }
  requireConnection(site, store = false) {
    if (!Object.hasOwn(REGIONS, site)) throw Error('GIGA_REGION_MAPPING_NOT_VERIFIED');
    const status = this.status(), [countryId, countryCode] = REGIONS[site];
    if (!status.connected) throw Error('GIGA_BROWSER_NOT_CONNECTED');
    if (status.extensionProtocol !== 4) throw Error('GIGA_BROWSER_UPDATE_REQUIRED');
    if (store && (!status.storeCatalog || !Number.isFinite(status.connectedAt))) throw Error('GIGA_STORE_BRIDGE_UPDATE_REQUIRED');
    const current = status.inspection;
    if (current.loggedIn !== true || current.buyer !== true || current.countryId !== countryId || current.countryCode !== countryCode)
      throw Error('GIGA_BROWSER_REGION_MISMATCH');
    return status;
  }
  issueTask(fields, privateFields = {}) {
    const prior = this.read('request.json');
    if (prior && !this.read(prior.id + '.result.json')) {
      const readOnly = ['read_rates', 'inspect'].includes(prior.op) || (prior.op==='favorites'&&prior.reconcileOnly===true) ||
        (prior.op === 'store' && ['resolve', 'page'].includes(prior.action));
      const readback=fields.reconcileOnly===true&&privateFields.reconciles===prior.id;
      if (prior.expiresAt > this.now() || (!readOnly && !readback && this.read(prior.id + '.dispatch.json')))
        throw Error('GIGA_BROWSER_TASK_REQUIRES_RECONCILIATION');
    }
    const id = crypto.randomUUID(), task = {id, expiresAt: this.now() + 1800, ...fields};
    this.write(id + '.client-task.json', {...task, ...privateFields});
    this.write('request.json', task);
    return task;
  }
  reconcileFavorites(sourceId) {
    if (sourceId !== undefined && (typeof sourceId !== 'string' || !/^[a-f0-9-]{36}$/.test(sourceId)))
      throw Error('GIGA_BROWSER_TASK_ID_INVALID');
    const prior=sourceId ? this.read(sourceId+'.client-task.json') : this.read('request.json');
    if(!prior || prior.op!=='favorites' || !this.read(prior.id+'.dispatch.json'))
      throw Error('GIGA_FAVORITE_RECONCILIATION_NOT_REQUIRED');
    const saved=this.read(prior.id+'.result.json');
    const skus=saved
      ? (this.productReceipt(prior,saved.result).excluded || []).filter(row=>row.reason==='RECONCILIATION_PENDING').map(row=>row.sku)
      : prior.skus;
    if (!skus.length) throw Error('GIGA_FAVORITE_RECONCILIATION_NOT_REQUIRED');
    const previous=this.read(prior.id+'.client-task.json');
    const status=this.requireConnection(prior.site);
    if(!previous?.screenId || !status.accountScopeV2 || !prior.buyerSalt || !prior.expectedBuyerHash)
      throw Error('GIGA_BUYER_SCOPE_REQUIRED');
    const approved=Object.fromEntries(skus.map(sku=>[sku,prior.approved[sku]]));
    const task=this.issueTask({op:'favorites',site:prior.site,skus,approved,buyerSalt:prior.buyerSalt,
      expectedBuyerHash:prior.expectedBuyerHash,reconcileOnly:true},{screenId:previous.screenId,reconciles:prior.id});
    return {id:task.id,state:'waiting_for_browser',site:task.site,codes:task.skus};
  }
  startStore({site, action, input, ticket, page} = {}) {
    const connection = this.requireConnection(site, true);
    const priorTasks = fs.readdirSync(this.root()).filter(name => /^[a-f0-9-]{36}\.client-task\.json$/.test(name))
      .map(name => this.read(name)).filter(task => task?.op === 'store' && task.site === site &&
        task.connectedAt === connection.connectedAt && task.expiresAt > this.now());
    let fields;
    let scope = {connectedAt: connection.connectedAt};
    if (action === 'resolve') {
      if (typeof input !== 'string' || !input.trim() || input.length > 512 || controls.test(input)) throw Error('STORE_INPUT_INVALID');
      fields = {input: input.trim()};
      const previous = priorTasks.filter(task => task.action === 'resolve' && task.input === fields.input)
        .sort((a,b) => b.expiresAt-a.expiresAt)[0];
      if (previous && this.read(previous.id + '.result.json')) {
        const receipt = this.task(previous.id);
        const pages = new Set(priorTasks.filter(task => task.action === 'page' && task.ticket === previous.id &&
          this.read(task.id + '.result.json') && this.task(task.id).state === 'store_page_read').map(task => task.page));
        if (receipt.state === 'store_resolved' && pages.size > 0 && pages.size < Math.ceil(receipt.total / receipt.pageSize))
          return {id: previous.id, state: 'waiting_for_browser', site};
      }
    } else if (action === 'page' || action === 'save') {
      const resolved = this.task(ticket);
      if (resolved.state !== 'store_resolved' || resolved.site !== site || resolved.connectedAt !== connection.connectedAt)
        throw Error('STORE_RECONNECT_AND_RESOLVE');
      if (action === 'page' && (!Number.isSafeInteger(page) || page < 1 || page > Math.ceil(resolved.total / resolved.pageSize)))
        throw Error('STORE_PAGE_INVALID');
      if (action === 'page') {
        const previous = priorTasks.find(task => task.action === 'page' && task.ticket === ticket && task.page === page &&
          this.read(task.id + '.result.json') && this.task(task.id).state === 'store_page_read');
        if (previous) return {id: previous.id, state: 'waiting_for_browser', site};
      }
      fields = {ticket, ...(action === 'page' ? {page} : {allowWrite: this.storeWriteAllowed(site, resolved.store.id)})};
      scope = {...scope, store: resolved.store, total: resolved.total, pageSize: resolved.pageSize};
    } else throw Error('STORE_ACTION_INVALID');
    const task = this.issueTask({op: 'store', site, action, ...fields}, scope);
    return {id: task.id, state: 'waiting_for_browser', site};
  }
  storeWriteAllowed(site, id) {
    const names = fs.readdirSync(this.root()).filter(name => /^[a-f0-9-]{36}\.client-task\.json$/.test(name));
    const previous = names.map(name => this.read(name)).filter(task => task?.op === 'store' && task.action === 'save' &&
      task.site === site && task.store?.id === id && this.read(task.id + '.dispatch.json'))
      .sort((a,b) => b.expiresAt - a.expiresAt)[0];
    if (!previous) return true;
    const prior = this.read(previous.id + '.result.json');
    return !!prior && this.storeReceipt(previous, prior.result).state === 'store_saved';
  }
  storeReceipt(task, result) {
    const states = {resolve: ['STORE_RESOLVED', 'store_resolved'], page: ['STORE_PAGE_READ', 'store_page_read'],
      save: ['STORE_SAVED_VERIFIED', 'store_saved']};
    const [expected, state] = states[task.action];
    if (result?.state !== expected) return {id: task.id, state: 'stopped', code: result?.code || 'STORE_RECEIPT_UNVERIFIED'};
    const [countryId,countryCode] = REGIONS[task.site], store = result.store;
    if (result.taskId !== task.id || result.countryId !== countryId || result.countryCode !== countryCode ||
        result.amazonSubmitted !== false || !store || typeof store.id !== 'string' || !storeId.test(store.id) ||
        typeof store.code !== 'string' || !storeCode.test(store.code) ||
        typeof store.name !== 'string' || !store.name.trim() || store.name.length > 160 || controls.test(store.name) ||
        (task.store && (task.store.id !== store.id || task.store.code !== store.code || task.store.name !== store.name)))
      throw Error('STORE_RECEIPT_SCOPE_MISMATCH');
    const base = {id: task.id, state, site: task.site, store, connectedAt: task.connectedAt};
    if (task.action === 'resolve') {
      if (typeof result.saved !== 'boolean' || !Number.isSafeInteger(result.total) || result.total < 0 || result.pageSize !== 50)
        throw Error('STORE_RECEIPT_SCOPE_MISMATCH');
      return {...base, saved: result.saved, total: result.total, pageSize: result.pageSize};
    }
    if (task.action === 'save') {
      if (result.saved !== true) throw Error('STORE_RECEIPT_SCOPE_MISMATCH');
      return {...base, saved: true};
    }
    const rows = result.items;
    const expectedCount = Math.min(task.pageSize, task.total - (task.page - 1) * task.pageSize);
    if (result.page !== task.page || result.total !== task.total || !Array.isArray(rows) || rows.length !== expectedCount ||
        rows.some(row => !row || typeof row.sku !== 'string' || !productCode.test(row.sku) ||
          typeof row.productId !== 'string' || !storeId.test(row.productId)) ||
        new Set(rows.map(row => row.sku)).size !== rows.length || new Set(rows.map(row => row.productId)).size !== rows.length)
      throw Error('STORE_RECEIPT_SCOPE_MISMATCH');
    this.remember(task.site, rows);
    return {...base, total: task.total, page: task.page, items: rows};
  }
  task(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw Error('GIGA_BROWSER_TASK_ID_INVALID');
    const task = this.read(id + '.client-task.json');
    if (!task || task.id !== id) throw Error('GIGA_BROWSER_TASK_NOT_FOUND');
    const saved = this.read(id + '.result.json');
    if (task.op === 'store') {
      if (task.expiresAt < this.now()) return {id, state:'stopped', code:'TASK_EXPIRED'};
      if (saved) return this.storeReceipt(task, saved.result);
    }
    if (!saved) return {id, state: this.read(id + '.dispatch.json') ? 'running_in_browser' : 'waiting_for_browser'};
    if (task.op === 'read_rates' && task.expiresAt < this.now()) return {id, state:'stopped', code:'TASK_EXPIRED'};
    return this.productReceipt(task, saved.result);
  }
  productReceipt(task, result) {
    const {id} = task, [countryId, countryCode] = REGIONS[task.site];
    const read = task.op === 'read_rates';
    if (result?.state !== (read ? 'DETAIL_RATES_READ' : 'APPROVED_FAVORITES_VERIFIED'))
      return {id, state: 'stopped', code: result?.code || 'GIGA_FAVORITES_NOT_VERIFIED'};
    const rows = result.items;
    const states = read ? ['RATE_LOW','RATE_NA','RATE_MEDIUM','RATE_HIGH','RATE_UNVERIFIED']
      : ['DETAIL_LOW_ADDED','DETAIL_LOW_ALREADY_SAVED','DETAIL_LOW_RECONCILED','FAVORITE_UNVERIFIED'];
    if (result.taskId !== id || result.countryId !== countryId || result.countryCode !== countryCode || result.amazonSubmitted !== false ||
      (task.buyerSalt&&(!/^[a-f0-9]{64}$/.test(result.buyerHash||'')||(!read&&result.buyerHash!==task.expectedBuyerHash))) ||
      !Array.isArray(rows) || rows.length !== task.skus.length ||
      rows.some(row => !row || !task.skus.includes(row.sku) || !states.includes(row.state) ||
        (!(read&&row.productId===null&&row.state==='RATE_UNVERIFIED'&&row.reason==='RESOLVE_FAILED') &&
          (typeof row.productId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.productId))) ||
        (!read && task.approved?.[row.sku] !== row.productId)) ||
      new Set(rows.map(row => row.sku)).size !== rows.length ||
      new Set(rows.flatMap(row=>row.productId?[row.productId]:[])).size !== rows.filter(row=>row.productId).length)
      throw Error('GIGA_BROWSER_RECEIPT_SCOPE_MISMATCH');
    const verified=rows.filter(row=>row.state!=='FAVORITE_UNVERIFIED');
    // Only rows whose product page showed the exact SKU and a rate label.
    if (read) this.remember(task.site, rows.filter(row => RATE_READ.includes(row.state)));
    return {id, state: read ? 'rates_read' : 'verified', site: task.site, countryId, countryCode, codes: verified.map(row=>row.sku), items: verified,
      ...(result.buyerHash?{buyerHash:result.buyerHash}:{}),
      ...(read ? {} : {screenId: task.screenId,excluded:rows.filter(row=>row.state==='FAVORITE_UNVERIFIED')})};
  }
}
module.exports = {GigaBrowser, REGIONS};
