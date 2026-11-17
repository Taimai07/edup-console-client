/* 处理工作台指定的商品，读取详情退货率或核验服务器批准的收藏。
 * 写入失败时先核对收藏状态，避免重复添加。
 */
(function (root) {
  'use strict';
  const VERSION = 'giga-browser-favorites-de-candidate-v1';
  const REGIONS = Object.freeze({DE: {id: 81, code: 'DEU'}, US: {id: 223, code: 'USA'},
    GB: {id: 222, code: 'GBR'}, CA: {id: 38, code: 'CAN'}, JP: {id: 107, code: 'JPN'}});
  const fail = code => { throw new Error(code); };
  function truth(value) {
    if ([true, 1, '1', 'true'].includes(value)) return true;
    if ([false, 0, '0', 'false'].includes(value)) return false;
    return null;
  }
  function identity(state, region = REGIONS.DE) {
    if (!state || truth(state.is_logged) !== true) fail('LOGIN_REQUIRED');
    if (truth(state.is_buyer) !== true) fail('BUYER_NOT_VERIFIED');
    if (String(state.country_id) !== String(region.id) || state.country_code !== region.code) fail('REGION_SESSION_MISMATCH');
    const id = String(state.customer_id ?? '');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || id === '0') fail('BUYER_ID_NOT_VERIFIED');
    return id;
  }
  function sameIdentity(state, buyer, region) {
    if (identity(state, region) !== buyer) fail('BROWSER_ACCOUNT_CHANGED');
  }
  // Task-local only: evidence comes from a freshly loaded product document, never persisted.
  function taskIdentity(region, now = () => Date.now()) {
    let buyer = null, evidence = null;
    return {
      accept(value) {
        const current = identity(value, region);
        if (buyer !== null && current !== buyer) fail('BROWSER_ACCOUNT_CHANGED');
        buyer = current; evidence = {value, at: now()}; return value;
      },
      current() { const age = evidence ? now() - evidence.at : Infinity;
        return age >= 0 && age <= 15000 ? evidence.value : null; },
    };
  }
  function exactProduct(rows, sku) {
    if (!Array.isArray(rows)) fail('PRODUCT_LIST_SCHEMA_CHANGED');
    const matches = rows.filter(row => row?.product?.sku === sku);
    if (matches.length !== 1) fail('EXACT_SKU_NOT_UNIQUE_OR_NOT_FOUND');
    const row = matches[0], id = String(row.product.id ?? '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) fail('PRODUCT_ID_INVALID');
    const saved = truth(row.other?.is_in_my_wishlist);
    if (saved === null) fail('WISHLIST_STATE_NOT_VERIFIED');
    return {id, saved};
  }
  // 0.4.4 (11-09): GIGA answers a session it wants a human to verify (slider puzzle) with HTTP 200
  // and an empty body. That stops the whole task as GIGA_VERIFICATION_REQUIRED. Nothing here
  // routes around it; the operator solves the puzzle on the page and the desktop resumes.
  // Fewer requests per SKU: known product IDs open the product page directly, one list call
  // covers many products, favorites recheck the server-approved IDs instead of searching again,
  // and identity is rechecked every few read-only items and right before every write.
  const GUARD_EVERY = 10, LIST_CHUNK = 60;
  // Dependency-injected core. No browser/session secrets are returned to callers.
  async function run({state, post, detailRate, load, save, hash, hadLegacyAttempt = () => false, progress = () => {}, skus, site,
    taskId, phase, approved, buyerSalt, expectedBuyerHash, reconcileOnly, known}) {
    const region = REGIONS[site];
    if (!region || !Array.isArray(skus) || !skus.length || skus.length > 30 ||
      new Set(skus).size !== skus.length || skus.some(s => typeof s !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(s)) ||
      !['read_rates','favorites'].includes(phase) || !/^[a-f0-9-]{36}$/.test(taskId)) fail('FROZEN_TASK_SCOPE_INVALID');
    if (known !== undefined && (phase !== 'read_rates' || !known || typeof known !== 'object' || Array.isArray(known) ||
      Object.entries(known).some(([sku, id]) => !skus.includes(sku) || typeof id !== 'string' || !/^[1-9][0-9]{0,14}$/.test(id)) ||
      new Set(Object.values(known)).size !== Object.keys(known).length)) fail('FROZEN_TASK_SCOPE_INVALID');
    const startedAt = new Date().toISOString();
    const buyer = identity(await state(), region);
    let buyerHash;
    if (buyerSalt) {
      if (!/^[a-f0-9]{64}$/.test(buyerSalt)) fail('BUYER_SCOPE_INVALID');
      const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(buyerSalt),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      buyerHash = [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(region.code + ':' + buyer)))].map(n=>n.toString(16).padStart(2,'0')).join('');
      if (phase==='favorites' && buyerHash!==expectedBuyerHash) fail('BROWSER_ACCOUNT_CHANGED');
    }
    const scope = await hash(JSON.stringify({version: VERSION, countryId: region.id, buyer, skus}));
    const previous = await load(scope);
    if (previous && (previous.version !== VERSION || previous.scope !== scope)) fail('CHECKPOINT_SCOPE_CHANGED');
    const result = {version: VERSION, taskId, startedAt, countryId: region.id, countryCode: region.code,
      state: 'CHECKING', items: [], amazonSubmitted: false, ...(buyerHash?{buyerHash}:{})};
    const guard = async () => sameIdentity(await state(), buyer, region);
    let sinceGuard = 0;
    const someGuard = async () => { if (++sinceGuard >= GUARD_EVERY) { sinceGuard = 0; await guard(); } };
    async function list(ids) {
      const rows = [];
      for (let index = 0; index < ids.length; index += LIST_CHUNK) {
        const response = await post('product/list/list', {
          product_ids: ids.slice(index, index + LIST_CHUNK), with_seller: false, with_wishlist: true, type: 'grid'
        });
        if (response?.code !== 200) fail('PRODUCT_READ_REJECTED');
        if (!Array.isArray(response.data)) fail('PRODUCT_LIST_SCHEMA_CHANGED');
        rows.push(...response.data);
      }
      return rows;
    }
    // Only rows of this SKU's own candidate IDs count, so one shared list call cannot cross SKUs.
    const pick = (rows, ids, sku) => exactProduct(rows.filter(row => ids.includes(String(row?.product?.id ?? ''))), sku);
    const resolved = id => ({low:'RATE_LOW',na:'RATE_NA',medium:'RATE_MEDIUM',high:'RATE_HIGH'})[id] || 'RATE_UNVERIFIED';

    if (phase === 'read_rates') {
      const products = [], unresolved = [], search = [];
      // A known ID still has to show the exact SKU on its product page; otherwise it is searched.
      for (const sku of skus) {
        const id = known?.[sku];
        if (!id) { search.push(sku); continue; }
        await someGuard();
        const evidence = await detailRate(id, sku);
        if (evidence?.reason === 'RATE_SKU_UNVERIFIED') { search.push(sku); continue; }
        products.push({sku, id, evidence});
      }
      const found = [];
      for (const sku of search) {
        await someGuard();
        const response = await post('product/list/search', {
          search: sku, page: 1, limit: 20, scene: 1, search_dimension: 1, dimension_type: 1
        });
        if (response?.code !== 200 || !Array.isArray(response.data?.product_list)) fail('PRODUCT_SEARCH_REJECTED_OR_SCHEMA_CHANGED');
        const ids = response.data.product_list.map(String);
        if (!ids.length || ids.length > 20 || ids.some(id => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) { unresolved.push(sku); continue; }
        found.push({sku, ids});
      }
      const rows = found.length ? await list([...new Set(found.flatMap(item => item.ids))]) : [];
      for (const {sku, ids} of found) {
        try {
          const product = pick(rows, ids, sku);
          products.push({sku, id: product.id});
          progress({sku, state: 'EXACT_PRODUCT_RESOLVED'});
        } catch (error) {
          if (error.message !== 'EXACT_SKU_NOT_UNIQUE_OR_NOT_FOUND') throw error;
          unresolved.push(sku);
        }
      }
      if (new Set(products.map(product => product.id)).size !== products.length) fail('PRODUCT_ID_REUSED_FOR_DIFFERENT_SKUS');
      for (const product of products) {
        let evidence = product.evidence;
        if (evidence === undefined) { await someGuard(); evidence = await detailRate(product.id, product.sku); }
        const rate = typeof evidence === 'string' ? evidence : evidence?.rate;
        result.items.push({sku: product.sku, productId: product.id, state: resolved(rate),
          ...(evidence?.reason ? {reason: evidence.reason} : {})});
      }
      for (const sku of unresolved) result.items.push({sku, productId: null, state: 'RATE_UNVERIFIED', reason: 'RESOLVE_FAILED'});
      await guard();
      result.state = 'DETAIL_RATES_READ';
      result.finishedAt = new Date().toISOString();
      return result;
    }

    // The server approved exact product IDs from a verified read. One list call rechecks that each
    // ID still carries its SKU and reads the wishlist state; nothing is searched again.
    const ids = approved && typeof approved === 'object' && !Array.isArray(approved) ? skus.map(sku => approved[sku]) : [];
    if (Object.keys(approved || {}).length !== skus.length || ids.length !== skus.length ||
      ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) || new Set(ids).size !== ids.length)
      fail('SERVER_APPROVAL_PRODUCT_MISMATCH');
    const before = await list(ids);
    const written = [];
    for (const sku of skus) {
      const id = approved[sku];
      let current;
      try { current = pick(before, [id], sku); }
      catch (error) {
        if (error.message !== 'EXACT_SKU_NOT_UNIQUE_OR_NOT_FOUND') throw error;
        result.items.push({sku, productId: id, state: 'FAVORITE_UNVERIFIED', reason: 'RESOLVE_FAILED'});
        continue;
      }
      const itemScope = await hash(JSON.stringify({version: 2, countryId: region.id, buyer, productId: id}));
      const checkpoint = await load(itemScope);
      if (checkpoint && (checkpoint.version !== 2 || checkpoint.scope !== itemScope || checkpoint.sku !== sku))
        fail('CHECKPOINT_SCOPE_CHANGED');
      const old = checkpoint?.item || previous?.items?.[sku];
      const persist = item => save(itemScope, {version: 2, scope: itemScope, sku, item});
      if (old && old.productId !== id) fail('CHECKPOINT_PRODUCT_ID_CHANGED');
      if (current.saved) {
        await persist({productId: id, state: 'VERIFIED_SAVED', checkedAt: new Date().toISOString()});
        result.items.push({sku, productId: id, state: 'DETAIL_LOW_ALREADY_SAVED'});
        continue;
      }
      if (reconcileOnly===true) {
        await persist({productId:id,state:'RECONCILIATION_PENDING',checkedAt:new Date().toISOString()});
        result.items.push({sku,productId:id,state:'FAVORITE_UNVERIFIED',reason:'RECONCILIATION_PENDING'});
        continue;
      }
      // A prior attempt or verified item becoming unsaved is a reconciliation hold, not a fresh add.
      if (old || await hadLegacyAttempt(sku, id, region.id)) {
        result.items.push({sku,productId:id,state:'FAVORITE_UNVERIFIED',reason:'RECONCILIATION_PENDING'});
        continue;
      }
      await guard();
      const startedAt = new Date().toISOString();
      await persist({productId: id, state: 'STARTED', startedAt});
      let accepted = false, stop = null;
      try {
        const added = await post('account/wishlist/addProductsToWish', {
          product_ids: id, group_id: 0, source: ''
        });
        accepted = added?.code === 200;
      } catch (error) {
        // Never resend. The readback below may establish that the write completed. A verification
        // request ends the task once this item's outcome is recorded.
        if (['GIGA_VERIFICATION_REQUIRED', 'TASK_CANCELLED'].includes(error?.message)) stop = error;
      }
      await persist({productId: id, state: accepted ? 'RESPONSE_ACCEPTED' : 'OUTCOME_UNKNOWN', startedAt});
      if (stop) throw stop;
      written.push({sku, id, accepted});
    }
    if (written.length) {
      const after = await list(written.map(item => item.id));
      for (const {sku, id, accepted} of written) {
        let saved = false;
        try { saved = pick(after, [id], sku).saved; }
        catch (error) { if (error.message !== 'EXACT_SKU_NOT_UNIQUE_OR_NOT_FOUND') throw error; }
        if (!saved) {
          result.items.push({sku,productId:id,state:'FAVORITE_UNVERIFIED',reason:'RECONCILIATION_PENDING'});
          continue;
        }
        const itemScope = await hash(JSON.stringify({version: 2, countryId: region.id, buyer, productId: id}));
        await save(itemScope, {version: 2, scope: itemScope, sku, item: {productId: id, state: 'VERIFIED_SAVED', checkedAt: new Date().toISOString()}});
        result.items.push({sku, productId: id, state: accepted ? 'DETAIL_LOW_ADDED' : 'DETAIL_LOW_RECONCILED'});
        progress(result.items[result.items.length - 1]);
      }
    }
    await guard();
    result.state = 'APPROVED_FAVORITES_VERIFIED';
    result.finishedAt = new Date().toISOString();
    return result;
  }
  function classifyRateRows(rows) {
    const labels = /^(?:RMA Rate|Return Rate|退返品率|退货率|退貨率|Retourenquote|RMA-Rate)\s*[:：]?\s*/iu;
    const values = new Map([['low','low'], ['低','low'], ['niedrig','low'],
      ['medium','medium'], ['moderate','medium'], ['中','medium'], ['mittel','medium'],
      ['high','high'], ['高','high'], ['hoch','high']]);
    const detected = new Set();
    for (const row of rows) {
      const value = row.replace(/\s+/gu, ' ').trim();
      if (!labels.test(value)) continue;
      const level = value.replace(labels, '').trim().toLowerCase();
      const category = values.get(level);
      if (category) detected.add(category);
      else if (/^n\s*[/／]\s*a$/iu.test(level)) detected.add('na');
      else detected.add(null);
    }
    return detected.size === 1 ? [...detected][0] : null;
  }


  async function readDetailRate(id, sku, signal, observe = () => {}, checkIdentity = () => {}) {
    const frame = document.createElement('iframe');
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:800px;pointer-events:none;border:0';
    const started = Date.now();
    return new Promise((resolve, reject) => {
      let finished = false, expiring = false, observed = null, observedAt = 0, checkedDocument = null;
      let lastSnapshot = '', lastState = null, productTextSeen = false, boundDocument = null, settleTimer = null, watchdog = null;
      const emit = (event, fields) => { try { observe(event, fields); } catch (_) {} };
      const observer = new MutationObserver(() => inspect());
      const capture = value => {
        lastState = value;
        const key = JSON.stringify(value);
        if (key !== lastSnapshot) { lastSnapshot = key; emit('frame_state', value); }
      };
      function finish(value, code) {
        if (finished) return;
        finished = true;
        observer.disconnect();
        clearTimeout(settleTimer); clearTimeout(watchdog);
        frame.removeEventListener('load', inspect);
        signal.removeEventListener('abort', aborted);
        if (boundDocument) boundDocument.removeEventListener('readystatechange', inspect);
        frame.remove();
        emit(code ? 'request_error' : 'step_end', {durationMs: Math.max(0, Date.now() - started),
          ...(code ? {errorCode: code} : {})});
        if (code) reject(Error(code)); else resolve(value);
      }
      function inspect() {
        if (finished) return;
        const snapshot = {frameAccessible: true, routeType: 'other', readyState: 'unknown',
          panelPresent: false, skuMatched: false, rateFound: false, challengeTextSeen: false, challengeControlSeen: false};
        try {
          const url = new URL(frame.contentWindow.location.href);
          const doc = frame.contentDocument;
          snapshot.routeType = url.href === 'about:blank' ? 'blank' : url.origin !== location.origin ? 'cross_origin'
            : url.searchParams.get('route') === 'account/login' ? 'login'
            : url.searchParams.get('route') === 'product/product' ? 'product' : 'other';
          snapshot.readyState = ['loading', 'interactive', 'complete'].includes(doc?.readyState) ? doc.readyState : 'unknown';
          if (doc && doc !== boundDocument) {
            observer.disconnect();
            if (boundDocument) boundDocument.removeEventListener('readystatechange', inspect);
            boundDocument = doc;
            observer.observe(doc.documentElement || doc, {subtree: true, childList: true,
              characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden']});
            doc.addEventListener('readystatechange', inspect);
          }
          const visibleText = (doc?.body?.innerText || '').slice(0, 4000);
          snapshot.challengeTextSeen = /verify you are human|complete the puzzle|拖动滑块|人机验证|完成安全验证/i.test(visibleText);
          const controls = doc?.querySelectorAll?.('.geetest_panel, .geetest_panel_box, iframe[src*="captcha"], [id*="captcha"]') || [];
          snapshot.challengeControlSeen = [...controls].some(node => node.getClientRects?.().length &&
            doc.defaultView.getComputedStyle(node).visibility !== 'hidden' && doc.defaultView.getComputedStyle(node).display !== 'none');
          if (snapshot.challengeTextSeen && snapshot.challengeControlSeen) {
            capture(snapshot); finish(null, 'GIGA_DETAIL_REVIEW_REQUIRED'); return;
          }
          if (url.origin === location.origin && url.pathname === '/index.php' &&
              url.searchParams.get('route') === 'product/product' && url.searchParams.get('product_id') === id) {
            if (doc?.readyState === 'complete' && checkedDocument !== doc) {
              checkIdentity(doc); checkedDocument = doc;
            }
            const panel = doc?.querySelector('#productShow #centerSide');
            snapshot.panelPresent = !!panel;
            productTextSeen = !!panel?.innerText?.trim();
            const skuText = panel?.innerText?.split(/[\s:：]+/u) || [];
            snapshot.skuMatched = skuText.includes(sku);
            if (snapshot.skuMatched) {
              const rows = [...panel.querySelectorAll('.sku-info')]
                .filter(row => row.getClientRects().length && doc.defaultView.getComputedStyle(row).visibility === 'visible')
                .flatMap(row => (row.innerText || '').split(/\r?\n|\\n/u));
              const rate = classifyRateRows(rows);
              snapshot.rateFound = !!rate;
              capture(snapshot);
              if (rate && observed && rate !== observed) { finish({reason: 'RATE_CONFLICT'}); return; }
              if (rate && !observed) { observed = rate; observedAt = Date.now(); }
              if (rate && doc.readyState === 'complete') {
                const stableFor = rate === 'na' ? 1750 : 250;
                const remaining = stableFor - (Date.now() - observedAt);
                if (remaining <= 0) { finish(rate); return; }
                if (!settleTimer && !expiring) {
                  const expected = Date.now() + remaining;
                  settleTimer = setTimeout(() => {
                    settleTimer = null;
                    const lag = Math.max(0, Date.now() - expected);
                    if (lag > 500) emit('timer_delay', {timerLagMs: lag});
                    inspect();
                  }, remaining);
                }
              }
            }
          }
          capture(snapshot);
        } catch (error) {
          if (['BROWSER_ACCOUNT_CHANGED','LOGIN_REQUIRED','BUYER_NOT_VERIFIED','REGION_SESSION_MISMATCH',
              'BUYER_ID_NOT_VERIFIED','LIVE_SESSION_STATE_SCHEMA_CHANGED'].includes(error?.message)) {
            finish(null, error.message); return;
          }
          const denied = error?.name === 'SecurityError';
          capture({...snapshot, frameAccessible: !denied, ...(denied ? {routeType: 'cross_origin'} : {}),
            errorCode: denied ? 'FRAME_ACCESS_DENIED' : 'FRAME_READ_FAILED'});
          finish(null, 'GIGA_DETAIL_REVIEW_REQUIRED');
        }
      }
      function expire() {
        if (finished) return;
        expiring = true;
        emit('frame_wait', {durationMs: Math.max(0, Date.now() - started)});
        // Timer delivery may be late in hidden tabs. Check already-loaded evidence before declaring failure.
        inspect();
        if (!finished) {
          if (productTextSeen && lastState?.readyState === 'complete' && !lastState.skuMatched) finish({reason: 'RATE_SKU_UNVERIFIED'});
          else finish(null, productTextSeen ? 'GIGA_REQUEST_TIMEOUT' : 'GIGA_DETAIL_REVIEW_REQUIRED');
        }
      }
      function aborted() {
        if (signal.reason?.name === 'TimeoutError') expire();
        else finish(null, 'TASK_CANCELLED');
      }
      frame.addEventListener('load', inspect);
      signal.addEventListener('abort', aborted, {once: true});
      if (signal.aborted) { aborted(); return; }
      watchdog = setTimeout(expire, 30000);
      frame.src = '/index.php?' + new URLSearchParams({route: 'product/product', product_id: id});
      document.body.append(frame);
      inspect();
    });
  }
  async function browserRun() {
    if (location.origin !== 'https://www.gigab2b.com' || window !== window.top) fail('OPEN_GIGA_TOP_LEVEL_PAGE');
    if (!navigator.locks) fail('BROWSER_LOCKS_REQUIRED');
    return navigator.locks.request('edup-giga-browser-favorites', {ifAvailable: true}, async lock => {
      if (!lock) fail('ANOTHER_FAVORITES_TASK_IS_RUNNING');
      const controller = new AbortController();
      root[Symbol.for('edup.giga.abort')] = controller;
      const taskKey = Symbol.for('edup.giga.frozenTask');
      const task = root[taskKey]; delete root[taskKey];
      if (!task) fail('FROZEN_TASK_SCOPE_INVALID');
      const diagnostics = {taskId: task.id, events: []};
      root[Symbol.for('edup.giga.diagnostics')] = {taskId: task.id, events: []};
      let sequence = 0, stepStarted = Date.now();
      const trace = (event, fields = {}) => {
        const current = root[Symbol.for('edup.giga.progress')];
        if (current?.taskId !== task.id) return;
        diagnostics.events.push({source: 'page', seq: ++sequence, event, at: Date.now(), stage: current.stage,
          index: current.index, total: current.total,
          ...(current.productId ? {productId: current.productId} : {}),
          visibility: ['visible', 'hidden', 'prerender'].includes(document.visibilityState) ? document.visibilityState : 'unknown', ...fields});
        diagnostics.events = diagnostics.events.slice(-64);
        root[Symbol.for('edup.giga.diagnostics')] = {taskId: task.id, events: diagnostics.events.map(row => ({...row}))};
      };
      const report = (stage, sku, productId) => {
        trace('step_end', {durationMs: Math.max(0, Date.now() - stepStarted)});
        stepStarted = Date.now();
        root[Symbol.for('edup.giga.progress')] = {taskId: task.id, stage,
          index: sku ? task.skus.indexOf(sku) + 1 : 0, total: task.skus.length,
          ...(typeof productId === 'string' ? {productId} : {})};
        trace('step_start');
      };
      report('starting');
      const frozen = {site: task.site, skus: task.skus, taskId: task.id, phase: task.phase, approved: task.approved,
        buyerSalt:task.buyerSalt,expectedBuyerHash:task.expectedBuyerHash,reconcileOnly:task.reconcileOnly,
        ...(task.known ? {known: task.known} : {})};
      const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
      const urls = [...document.querySelectorAll('link[rel="modulepreload"][href]')]
        .map(link => new URL(link.href, location.href))
        .filter(url => url.origin === location.origin &&
          /^\/public\/assets\/dist\/assets\/global-[a-z0-9]+\.js$/.test(url.pathname) && !url.search && !url.hash);
      const unique = [...new Set(urls.map(url => url.href))];
      if (unique.length !== 1) fail('PAGE_MODULE_CHANGED');
      const native = await import(unique[0]);
      if (typeof native.F !== 'function') fail('NATIVE_STATE_READER_CHANGED');
      const identityEvidence = taskIdentity(REGIONS[frozen.site]);
      const accountMetrics = {detailPages:0, identityFromDetails:0, sessionPages:0, sessionFetches:0};
      let prefetched = null, prefetchTried = false;
      const acceptDocument = doc => {
        const html = doc?.documentElement?.innerHTML || '';
        const matches = [...html.matchAll(/window\.__APP_GLOBAL__\s*=\s*(['"])([^'"\r\n]+)\1/g)];
        if (matches.length !== 1) fail('LIVE_SESSION_STATE_SCHEMA_CHANGED');
        identityEvidence.accept(JSON.parse(new native.F().decrypt(matches[0][2])));
        accountMetrics.identityFromDetails++;
      };
      async function readRate(id, sku) {
        report('detail', sku, id);
        await pace(GAP.page);
        accountMetrics.detailPages++;
        return readDetailRate(id, sku, signal(), trace, acceptDocument);
      }
      const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      let nextRequestAt = 0;
      // 0.4.4: slower than 0.4.3 (1.1 s). Product pages are full page loads, so they wait longest.
      const GAP = {api: 3000, state: 3000, page: 5000, write: 5000};
      async function pace(gap) {
        const delay = Math.max(0, nextRequestAt - performance.now());
        if (delay) {
          const started = Date.now();
          await new Promise(resolve => setTimeout(resolve, delay));
          const lag = Math.max(0, Date.now() - started - delay);
          if (lag > 500) trace('timer_delay', {timerLagMs: lag});
        }
        if (controller.signal.aborted) fail('TASK_CANCELLED');
        nextRequestAt = performance.now() + gap;
      }
      // Network failures get a code instead of the generic BROWSER_TEST_FAILED.
      async function send(url, options) {
        const started = Date.now();
        const requestSignal = signal();
        trace('request_start');
        let response;
        try {
          response = await fetch(url, {...options, signal: requestSignal,
            redirect: options.method === 'POST' ? 'error' : 'manual'});
        }
        catch (error) {
          const code = controller.signal.aborted ? 'TASK_CANCELLED' : requestSignal.aborted ||
            ['TimeoutError', 'AbortError'].includes(error?.name) ? 'GIGA_REQUEST_TIMEOUT' : 'GIGA_REQUEST_FAILED';
          trace('request_error', {durationMs: Math.max(0, Date.now() - started), errorCode: code});
          fail(code);
        }
        const type = response.headers.get('content-type') || '';
        trace('response_headers', {httpStatus: response.status, durationMs: Math.max(0, Date.now() - started),
          contentKind: /json/i.test(type) ? 'json' : /html/i.test(type) ? 'html' : /text/i.test(type) ? 'text' : 'other'});
        if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) fail('GIGA_DETAIL_REVIEW_REQUIRED');
        return response;
      }
      async function request(route, body) {
        const favoriteId = route === 'account/wishlist/addProductsToWish' ? body.product_ids : undefined;
        const sku = body.search || Object.entries(task.approved || {}).find(([, id]) => id === favoriteId)?.[0];
        report(route === 'product/list/search' ? 'search' : route === 'product/list/list' ? 'list' : 'favorite', sku, favoriteId);
        if (controller.signal.aborted) fail('TASK_CANCELLED');
        const allowed = ['product/list/search', 'product/list/list', 'account/wishlist/addProductsToWish'];
        if (!allowed.includes(route)) fail('ROUTE_NOT_ALLOWED');
        await pace(route === 'account/wishlist/addProductsToWish' ? GAP.write : GAP.api);
        const response = await send('/index.php?route=' + route, {
          method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
          headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'ori-status-in-response': 'code'},
          body: JSON.stringify(body)
        });
        if (!response.ok) fail('HTTP_REQUEST_FAILED');
        const raw = await readBody(response);
        // GIGA's answer to a session it wants a human to verify: HTTP 200, empty body.
        if (!raw.trim()) fail('GIGA_VERIFICATION_REQUIRED');
        try { return JSON.parse(raw); } catch (_) { fail('GIGA_RESPONSE_INVALID'); }
      }

      async function state() {
        if (frozen.phase === 'read_rates') {
          const recent = identityEvidence.current();
          if (recent) return recent;
          if (!prefetchTried) {
            prefetchTried = true;
            const first = Object.entries(frozen.known || {}).find(([,id]) => /^[1-9][0-9]{0,14}$/.test(id));
            if (first) {
              const [sku,id] = first;
              prefetched = {sku,id,value:await readRate(id,sku)};
              const combined = identityEvidence.current();
              if (combined) return combined;
            }
          }
        }
        report('session');
        if (controller.signal.aborted) fail('TASK_CANCELLED');
        await pace(GAP.state);
        const productId = Object.values(frozen.known || frozen.approved || {})
          .find(value => typeof value === 'string' && /^[1-9][0-9]{0,14}$/.test(value));
        if (productId) {
          const value = await readSessionPage(productId);
          return frozen.phase === 'read_rates' ? identityEvidence.accept(value) : value;
        }
        try {
          if (typeof accountMetrics !== 'undefined') accountMetrics.sessionFetches++;
          const response = await send('/index.php?route=common/home', {
            credentials: 'same-origin', redirect: 'error', cache: 'no-store'
          });
          if (!response.ok) fail('SESSION_STATE_FETCH_FAILED');
          const html = await readBody(response);
          if (!html.trim()) fail('GIGA_VERIFICATION_REQUIRED');
          const matches = [...html.matchAll(/window\.__APP_GLOBAL__\s*=\s*(['"])([^'"\r\n]+)\1/g)];
          if (matches.length !== 1) fail('LIVE_SESSION_STATE_SCHEMA_CHANGED');
          const value = JSON.parse(new native.F().decrypt(matches[0][2]));
          return frozen.phase === 'read_rates' ? identityEvidence.accept(value) : value;
        } catch (error) {
          if (!['GIGA_REQUEST_FAILED', 'GIGA_REQUEST_TIMEOUT'].includes(error.message)) throw error;
          const value = await readSessionPage();
          return frozen.phase === 'read_rates' ? identityEvidence.accept(value) : value;
        }
      }
      async function readSessionPage(productId) {
        if (typeof accountMetrics !== 'undefined') accountMetrics.sessionPages++;
        const frame = document.createElement('iframe');
        frame.tabIndex = -1;
        frame.setAttribute('aria-hidden', 'true');
        // Account state is server-rendered HTML. Reading it does not need child-page scripts.
        frame.setAttribute('sandbox', 'allow-same-origin');
        frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:800px;pointer-events:none;border:0';
        const started = Date.now();
        const frameSignal = signal();
        const route = productId ? 'product/product' : 'common/home';
        return new Promise((resolve, reject) => {
          let done = false;
          const finish = (value, code) => {
            if (done) return;
            done = true;
            frame.removeEventListener('load', loaded);
            frameSignal.removeEventListener('abort', aborted);
            frame.remove();
            trace(code ? 'request_error' : 'frame_wait', {durationMs: Math.max(0, Date.now() - started), ...(code ? {errorCode: code} : {})});
            if (code) reject(Error(code)); else resolve(value);
          };
          const loaded = () => {
            try {
              const url = new URL(frame.contentWindow.location.href);
              if (url.href === 'about:blank') return;
              const doc = frame.contentDocument;
              trace('frame_state', {frameAccessible: true,
                routeType: url.searchParams.get('route') === 'account/login' ? 'login' : productId ? 'product' : 'other',
                readyState: ['loading', 'interactive', 'complete'].includes(doc?.readyState) ? doc.readyState : 'unknown',
                ...(productId ? {productId} : {})});
              if (url.origin !== location.origin || url.searchParams.get('route') !== route ||
                  productId && url.searchParams.get('product_id') !== productId) {
                finish(null, 'GIGA_DETAIL_REVIEW_REQUIRED'); return;
              }
              const html = doc?.documentElement?.innerHTML || '';
              trace('body_read', {bodyBytes: new TextEncoder().encode(html).byteLength});
              const matches = [...html.matchAll(/window\.__APP_GLOBAL__\s*=\s*(['"])([^'"\r\n]+)\1/g)];
              if (matches.length !== 1) { finish(null, 'GIGA_DETAIL_REVIEW_REQUIRED'); return; }
              finish(JSON.parse(new native.F().decrypt(matches[0][2])));
            } catch (error) {
              trace('frame_state', {frameAccessible: false, routeType: error?.name === 'SecurityError' ? 'cross_origin' : 'other',
                errorCode: error?.name === 'SecurityError' ? 'FRAME_ACCESS_DENIED' : 'SESSION_FRAME_READ_FAILED'});
              finish(null, 'GIGA_DETAIL_REVIEW_REQUIRED');
            }
          };
          const aborted = () => finish(null, controller.signal.aborted ? 'TASK_CANCELLED' : 'GIGA_REQUEST_TIMEOUT');
          frame.addEventListener('load', loaded);
          frameSignal.addEventListener('abort', aborted, {once: true});
          if (frameSignal.aborted) { aborted(); return; }
          frame.src = location.origin + '/index.php?' + new URLSearchParams({route, ...(productId ? {product_id: productId} : {})});
          document.body.append(frame);
        });
      }
      async function readBody(response) {
        const started = Date.now();
        try {
          const text = await response.text();
          trace('body_read', {bodyBytes: new TextEncoder().encode(text).byteLength, durationMs: Math.max(0, Date.now() - started)});
          return text;
        }
        catch (error) {
          trace('request_error', {durationMs: Math.max(0, Date.now() - started), errorCode:
            controller.signal.aborted ? 'TASK_CANCELLED' : ['AbortError', 'TimeoutError'].includes(error.name) ? 'GIGA_REQUEST_TIMEOUT' : 'GIGA_REQUEST_FAILED'});
          if (controller.signal.aborted) fail('TASK_CANCELLED');
          fail(['AbortError', 'TimeoutError'].includes(error.name) ? 'GIGA_REQUEST_TIMEOUT' : 'GIGA_REQUEST_FAILED');
        }
      }
      const prefix = 'edup-giga-favorites-v1:';
      const load = async scope => {
        const text = localStorage.getItem(prefix + scope);
        return text === null ? null : JSON.parse(text);
      };
      const hadLegacyAttempt = (sku, id, countryId) => {
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index);
          if (!key?.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(key.slice(prefix.length))) continue;
          const row = JSON.parse(localStorage.getItem(key));
          if (row?.version === VERSION && row.countryId === countryId && row.items?.[sku]?.productId === id) return true;
        }
        return false;
      };
      const save = async (scope, value) => {
        const text = JSON.stringify(value);
        localStorage.setItem(prefix + scope, text);
        if (localStorage.getItem(prefix + scope) !== text) fail('CHECKPOINT_SAVE_FAILED');
      };
      const probe = prefix + 'storage-check';
      localStorage.setItem(probe, '1');
      if (localStorage.getItem(probe) !== '1') fail('CHECKPOINT_STORAGE_UNAVAILABLE');
      localStorage.removeItem(probe);
      return run({state, post: request, detailRate: async (id, sku) => {
        if (prefetched?.id === id && prefetched.sku === sku) {
          const value = prefetched.value; prefetched = null; return value;
        }
        return readRate(id,sku);
      }, hash, load, save,
        hadLegacyAttempt, ...frozen,
        progress: item => console.log('GIGA_DE_PROGRESS ' + JSON.stringify(item))})
        .then(result => {
          trace('step_end', {durationMs: Math.max(0, Date.now() - stepStarted)});
          return {...result, note: 'GIGA_DIAGNOSTICS_V1 ' + JSON.stringify({version: '0.5.0', taskId: task.id, accountMetrics, events: diagnostics.events})};
        })
        .catch(error => {
          trace('request_error', {errorCode: /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message || '') ? error.message : 'BROWSER_TEST_FAILED'});
          error.diagnosticsNote = 'GIGA_DIAGNOSTICS_V1 ' + JSON.stringify({version: '0.5.0', taskId: task.id, accountMetrics, events: diagnostics.events});
          throw error;
        });
    });
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = {run, identity, exactProduct, classifyRateRows, readDetailRate, taskIdentity, VERSION, GUARD_EVERY, LIST_CHUNK};
  } else {
    return browserRun().then(result => { console.log('GIGA_DE_RESULT ' + JSON.stringify(result)); return result; })
      .catch(error => {
        const code = /^[A-Z0-9_]{1,100}$/.test(error?.message || '') ? error.message : 'BROWSER_TEST_FAILED';
        const result = {version: VERSION, state: 'STOPPED', code,
          note: error.diagnosticsNote || '保留已完成及未知回执，收藏结果不明时需要核对。', amazonSubmitted: false};
        console.log('GIGA_DE_RESULT ' + JSON.stringify(result));
        return result;
      });
  }
})(globalThis);
