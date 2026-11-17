'use strict';
// GigaBrowser methods: screening start, known products and favorites. Moved out of giga-browser.cjs unchanged (client round 1).
const {fs, path, crypto, execFileSync, REGIONS, storeId, storeCode, productCode, controls, KNOWN_LIMIT, RATE_READ, READ_RECEIPT_TTL} = require('./giga-browser-shared.cjs');
module.exports = {
validate({site, codes}) {
    if (!REGIONS[site]) throw Error('GIGA_REGION_MAPPING_NOT_VERIFIED');
    if (!Array.isArray(codes) || !codes.length || codes.length > 30 || new Set(codes).size !== codes.length ||
      codes.some(s => typeof s !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(s))) throw Error('GIGA_CODES_INVALID');
    return {site, codes: [...codes]};
  },
start(input) {
    return this.createTask(input, 'read_rates');
  },
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
  },
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
  },
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
  },
knownFile(site) { return 'known-products-' + site + '.json'; },
knownMap(site) {
    try {
      const saved = this.read(this.knownFile(site));
      if (saved?.version === 1 && saved.site === site && saved.ids && typeof saved.ids === 'object' && !Array.isArray(saved.ids)) return saved.ids;
    } catch { /* a damaged file only costs searches */ }
    return {};
  },
knownFor(site, codes) {
    const ids = this.knownMap(site), out = {}, used = new Set();
    for (const sku of codes) {
      const id = Object.hasOwn(ids, sku) ? ids[sku] : null;
      if (typeof id === 'string' && storeId.test(id) && !used.has(id)) { out[sku] = id; used.add(id); }
    }
    return Object.keys(out).length ? out : null;
  },
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
  },
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
  },
issueTask(fields, privateFields = {}) {
    const prior = this.read('request.json');
    if (prior && !this.read(prior.id + '.result.json')) {
      const readOnly = ['read_rates', 'inspect'].includes(prior.op) || (prior.op==='favorites'&&prior.reconcileOnly===true) ||
        (prior.op === 'store' && ['resolve', 'page'].includes(prior.action));
      const readback=fields.reconcileOnly===true&&privateFields.reconciles===prior.id;
      if ((prior.expiresAt > this.now() && !this.readInterrupted(prior)) || (!readOnly && !readback && this.read(prior.id + '.dispatch.json')))
        throw Error('GIGA_BROWSER_TASK_REQUIRES_RECONCILIATION');
    }
    const id = crypto.randomUUID(), task = {id, expiresAt: this.now() + 1800, ...fields};
    this.write(id + '.client-task.json', {...task, ...privateFields});
    this.write('request.json', task);
    return task;
  },
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
};
