'use strict';
// GigaBrowser methods: store tasks and receipts. Moved out of giga-browser.cjs unchanged (client round 1).
const {fs, path, crypto, execFileSync, REGIONS, storeId, storeCode, productCode, controls, KNOWN_LIMIT, RATE_READ, READ_RECEIPT_TTL} = require('./giga-browser-shared.cjs');
module.exports = {
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
  },
storeWriteAllowed(site, id) {
    const names = fs.readdirSync(this.root()).filter(name => /^[a-f0-9-]{36}\.client-task\.json$/.test(name));
    const previous = names.map(name => this.read(name)).filter(task => task?.op === 'store' && task.action === 'save' &&
      task.site === site && task.store?.id === id && this.read(task.id + '.dispatch.json'))
      .sort((a,b) => b.expiresAt - a.expiresAt)[0];
    if (!previous) return true;
    const prior = this.read(previous.id + '.result.json');
    return !!prior && this.storeReceipt(previous, prior.result).state === 'store_saved';
  },
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
  },
readInterrupted(task) {
    if (task.op !== 'read_rates') return false;
    const dispatched = this.read(task.id + '.dispatch.json');
    const connection = this.read('connection.json');
    return Number.isFinite(dispatched?.at) && Number.isFinite(connection?.connectedAt) &&
      connection.connectedAt > dispatched.at;
  },
task(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw Error('GIGA_BROWSER_TASK_ID_INVALID');
    const task = this.read(id + '.client-task.json');
    if (!task || task.id !== id) throw Error('GIGA_BROWSER_TASK_NOT_FOUND');
    let received = null;
    try {
      const saved = this.read(id + '.result.json');
      const finished = Date.parse(saved?.result?.finishedAt || '') / 1000;
      if (saved) received = Number.isFinite(saved.at) ? saved.at : Number.isFinite(finished) ? finished : task.expiresAt - 1800;
      return this.recordTaskStatus(task, this.readTaskStatus(task, saved, received), received);
    } catch (error) {
      this.recordTaskStatus(task, {id, state: 'rejected', code: /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message || '')
        ? error.message : 'GIGA_BROWSER_RECEIPT_READ_FAILED'}, received);
      throw error;
    }
  },
recordTaskStatus(task, status, received) {
    try {
      const name = task.id + '.client-status.json';
      const value = {id: task.id, state: status.state, code: status.code || null,
        executionExpiresAt: task.expiresAt, receiptAt: received,
        receiptValidUntil: task.op === 'read_rates' && received !== null ? received + READ_RECEIPT_TTL : null};
      const prior = this.read(name);
      if (!prior || Object.keys(value).some(key => prior[key] !== value[key])) this.write(name, {...value, at: this.now()});
    } catch (_) { /* State recording must not change business decisions. */ }
    try {
      const saved = this.read(task.id + '.diagnostics.json');
      if (saved?.id === task.id && Array.isArray(saved.events)) {
        const last = saved.events.at(-1);
        const error = [...saved.events].reverse().find(row => /^[A-Z][A-Z0-9_]{0,99}$/.test(row.errorCode || ''));
        status.diagnostics = {updatedAt: saved.updatedAt, eventCount: saved.totalEvents,
          retainedCount: saved.events.length, droppedEvents: saved.droppedEvents || 0,
          lastEvent: /^[a-z_]{1,40}$/.test(last?.event || '') ? last.event : null,
          lastErrorCode: error?.errorCode || null};
      }
    } catch (_) { /* Corrupt optional diagnostics do not invalidate a valid receipt. */ }
    return status;
  },
readTaskStatus(task, saved, received) {
    const {id} = task;
    if (task.op === 'store') {
      if (task.expiresAt < this.now()) return {id, state:'stopped', code:'TASK_EXPIRED'};
      if (saved) return this.storeReceipt(task, saved.result);
    }
    if (!saved) {
      if (this.readInterrupted(task)) return {id, state: 'stopped', code: 'GIGA_BROWSER_READ_INTERRUPTED'};
      if (task.op === 'read_rates' && task.expiresAt < this.now()) return {id, state: 'stopped', code: 'TASK_EXPIRED'};
      const dispatched = this.read(id + '.dispatch.json');
      const progress = this.read(id + '.progress.json');
      return {id, state: dispatched ? 'running_in_browser' : 'waiting_for_browser',
        elapsedSeconds: dispatched ? Math.max(0, Math.floor(this.now() - dispatched.at)) : 0,
        ...(progress?.id === id ? {progress: progress.progress} : {})};
    }
    if (task.op === 'read_rates') {
      // Execution expiry bounds waiting. Completed evidence has its own three-day lifetime.
      const age = this.now() - received;
      if (age < -5 || age > READ_RECEIPT_TTL) return {id, state: 'stopped', code: 'GIGA_READ_RECEIPT_EXPIRED'};
    }
    return this.productReceipt(task, saved.result);
  },
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
};
