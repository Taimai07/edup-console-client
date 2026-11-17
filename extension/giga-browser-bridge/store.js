(function (root) {
  'use strict';
  const regions = {DE: [81, 'DEU'], US: [223, 'USA'], GB: [222, 'GBR'], CA: [38, 'CAN'], JP: [107, 'JPN']};
  const pageSize = 50;
  const fail = code => { throw Error(code); };
  const numericId = value => /^[1-9]\d{0,14}$/.test(String(value ?? ''));
  const storeCode = value => typeof value === 'string' && /^[A-Z0-9][A-Z0-9_.-]{0,39}$/i.test(value);
  const skuCode = value => typeof value === 'string' && /^[A-Z0-9][A-Z0-9_.-]{2,39}$/i.test(value);
  const trueFlag = value => value === true || value === 1 || value === '1' || value === 'true';
  const falseFlag = value => value === false || value === 0 || value === '0' || value === 'false';
  const normalized = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toUpperCase();
  const publicStore = (id, code, name) => {
    if (!numericId(id) || !storeCode(code) || typeof name !== 'string' || !name.trim() ||
        name.length > 160 || /[\x00-\x1f\x7f]/.test(name)) fail('STORE_IDENTITY_UNVERIFIED');
    return {id: String(id), code: code.toUpperCase(), name: name.trim()};
  };

  function parseSelector(value) {
    if (typeof value !== 'string') fail('STORE_INPUT_INVALID');
    const text = value.trim();
    if (!text || text.length > 512 || /[\x00-\x1f\x7f]/.test(text)) fail('STORE_INPUT_INVALID');
    if (/^https?:\/\//i.test(text)) {
      let url;
      try { url = new URL(text); } catch (_) { fail('STORE_URL_INVALID'); }
      const id = url.searchParams.get('id');
      if (url.origin !== 'https://www.gigab2b.com' || url.username || url.password || url.pathname !== '/index.php' ||
          !['seller_store/home', 'seller_store/products', 'seller_store/introduction'].includes(url.searchParams.get('route')) ||
          url.searchParams.getAll('route').length !== 1 || url.searchParams.getAll('id').length !== 1 || !numericId(id))
        fail('STORE_URL_INVALID');
      return {id};
    }
    if (text.length > 160 || /[:/\\]/u.test(text)) fail('STORE_INPUT_INVALID');
    return {text};
  }

  async function runStore({task, state, request, context, readCheckpoint, writeCheckpoint, clearCheckpoint, pace}) {
    const region = regions[task.site];
    if (!region) fail('STORE_REGION_NOT_SUPPORTED');
    function identity(value) {
      if (!trueFlag(value?.is_logged) || !trueFlag(value?.is_buyer)) fail('STORE_BUYER_LOGIN_REQUIRED');
      if (String(value.country_id) !== String(region[0]) || value.country_code !== region[1]) fail('REGION_SESSION_MISMATCH');
      const id = String(value.customer_id ?? '');
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || id === '0') fail('BUYER_ID_NOT_VERIFIED');
      return id;
    }
    const buyer = identity(await state());
    const guard = async () => {
      if (identity(await state()) !== buyer) fail('BROWSER_ACCOUNT_CHANGED');
    };
    const call = async (route, args, method = 'POST') => {
      const response = await request(route, args, method);
      if (Number(response?.code) !== 200) fail('STORE_REQUEST_REJECTED');
      return response.data;
    };
    async function profile(id) {
      const data = await call('seller_store/home/getStoreTop', {id, type: 1}, 'GET');
      const info = data?.seller_info;
      const store = publicStore(info?.seller_id, info?.store_code, info?.store_name);
      if (store.id !== id) fail('STORE_IDENTITY_UNVERIFIED');
      const flag = data.is_collect_seller;
      if (!trueFlag(flag) && !falseFlag(flag)) fail('STORE_FAVORITE_STATUS_UNKNOWN');
      return {store, saved: trueFlag(flag)};
    }
    async function findStore(text) {
      const target = normalized(text);
      const matches = new Map();
      let total, size;
      for (let page = 1; page <= 8; page++) {
        const result = await call('product/list/search', {scene: 1, search: text, search_dimension: 2, dimension_type: 2, page, limit: 20});
        const candidates = result?.store_list;
        const count = Number(result?.pagination?.total);
        if (!Array.isArray(candidates) || !Number.isSafeInteger(count) || count < 0 || candidates.length > 100)
          fail('STORE_SEARCH_UNVERIFIED');
        if (page === 1) {
          total = count;
          size = candidates.length;
          if (!total) fail('STORE_NOT_FOUND');
          if (!size || Math.ceil(total / size) > 8) fail('STORE_SEARCH_TOO_BROAD');
        }
        if (count !== total || candidates.length !== Math.min(size, total - (page - 1) * size) ||
            candidates.some(item => !numericId(item?.seller_id))) fail('STORE_SEARCH_CHANGED');
        const ids = new Set(candidates.map(item => String(item.seller_id)));
        const rows = await call('seller/list/list', {store_list: candidates});
        if (!Array.isArray(rows) || rows.length !== ids.size || rows.some(row => !ids.delete(String(row?.id))))
          fail('STORE_SEARCH_UNVERIFIED');
        for (const row of rows) {
          if (normalized(row.store_code) === target || normalized(row.name) === target) {
            const store = publicStore(row.id, row.store_code, row.name);
            matches.set(store.id, store);
          }
        }
        if (page * size >= total) break;
      }
      if (matches.size !== 1) fail(matches.size ? 'STORE_NAME_AMBIGUOUS' : 'STORE_NOT_FOUND');
      return [...matches.values()][0];
    }
    async function list(id, page) {
      const data = await call('product/list/search', {scene: 3, seller_id: id,
        search_dimension: 1, dimension_type: 1, page, limit: pageSize});
      const ids = data?.product_list;
      const total = Number(data?.pagination?.total);
      if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(ids) ||
          ids.length !== Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize)) ||
          ids.some(id => !numericId(id)) || new Set(ids.map(String)).size !== ids.length)
        fail('STORE_CATALOG_PAGE_UNVERIFIED');
      return {total, ids};
    }
    const result = {taskId: task.id, countryId: region[0], countryCode: region[1], amazonSubmitted: false};
    if (task.action === 'resolve') {
      const selector = parseSelector(task.input);
      const match = selector.id ? null : await findStore(selector.text);
      const {store, saved} = await profile(selector.id || match.id);
      if (match && (match.code !== store.code || normalized(match.name) !== normalized(store.name)))
        fail('STORE_IDENTITY_UNVERIFIED');
      const {total} = await list(store.id, 1);
      if (!total) fail('STORE_CATALOG_EMPTY');
      await guard();
      context.current = {ticket: task.id, site: task.site, buyer, store, total, pages: new Map()};
      return {...result, state: 'STORE_RESOLVED', store, saved, total, pageSize};
    }
    const current = context.current;
    if (!current || current.ticket !== task.ticket || current.site !== task.site || current.buyer !== buyer)
      fail('STORE_RECONNECT_AND_RESOLVE');
    const {store, total} = current;
    if (task.action === 'page') {
      const page = task.page;
      if (!Number.isSafeInteger(page) || page < 1 || page > Math.ceil(total / pageSize)) fail('STORE_PAGE_INVALID');
      const {total: latest, ids} = await list(store.id, page);
      if (latest !== total) fail('STORE_CATALOG_CHANGED');
      const rows = await call('product/list/list', {product_ids: ids, with_seller: true, with_wishlist: false, type: 'grid'});
      const byId = new Map();
      if (!Array.isArray(rows) || rows.length !== ids.length) fail('STORE_CATALOG_PAGE_UNVERIFIED');
      for (const row of rows) {
        const productId = String(row?.product?.id);
        const sku = row?.product?.sku;
        if (!numericId(productId) || !skuCode(sku) || byId.has(productId) || String(row?.seller?.seller_id) !== store.id ||
            normalized(row.seller.store_code) !== store.code) fail('STORE_PRODUCT_SCOPE_MISMATCH');
        byId.set(productId, {productId, sku: sku.toUpperCase()});
      }
      const items = ids.map(id => byId.get(String(id)));
      if (items.some(item => !item) || new Set(items.map(item => item.sku)).size !== items.length)
        fail('STORE_CATALOG_PAGE_UNVERIFIED');
      await guard();
      current.pages.set(page, ids.map(String));
      return {...result, state: 'STORE_PAGE_READ', store, total, page, items};
    }
    if (task.action !== 'save') fail('STORE_ACTION_INVALID');
    const pages = Math.ceil(total / pageSize);
    if (current.pages.size !== pages || new Set([...current.pages.values()].flat()).size !== total)
      fail('STORE_CATALOG_INCOMPLETE');
    for (let page = 1; page <= pages; page++) {
      const expected = current.pages.get(page);
      const latest = await list(store.id, page);
      if (!expected || latest.total !== total || latest.ids.map(String).some((id, i) => id !== expected[i]))
        fail('STORE_CATALOG_CHANGED');
      if (page < pages) await pace();
    }
    const check = async () => {
      const fresh = await profile(store.id);
      await guard();
      if (fresh.store.code !== store.code || normalized(fresh.store.name) !== normalized(store.name))
        fail('STORE_IDENTITY_UNVERIFIED');
      return fresh.saved;
    };
    const key = 'edup-giga-store-save-v1:' + task.site + ':' + buyer + ':' + store.id;
    if (await check()) {
      await clearCheckpoint(key);
      return {...result, state: 'STORE_SAVED_VERIFIED', store, saved: true};
    }
    if (task.allowWrite === false || await readCheckpoint(key)) fail('STORE_FAVORITE_RECONCILIATION_REQUIRED');
    await writeCheckpoint(key);
    try {
      await call('customerpartner/contacted_seller/buyerCollectByIds', {seller_ids: store.id, added_my_seller: 1});
    } catch (_) {
      // The single readback below may confirm an interrupted save.
    }
    if (!await check()) fail('STORE_FAVORITE_RECONCILIATION_REQUIRED');
    await clearCheckpoint(key);
    return {...result, state: 'STORE_SAVED_VERIFIED', store, saved: true};
  }

  async function browserRun() {
    if (location.origin !== 'https://www.gigab2b.com' || window !== window.top) fail('OPEN_GIGA_TOP_LEVEL_PAGE');
    if (!navigator.locks) fail('BROWSER_LOCKS_REQUIRED');
    return navigator.locks.request('edup-giga-browser-favorites', {ifAvailable: true}, async lock => {
      if (!lock) fail('BROWSER_TASK_BUSY');
      const taskKey = Symbol.for('edup.giga.storeTask');
      const task = root[taskKey];
      delete root[taskKey];
      if (!task) fail('STORE_ACTION_INVALID');
      const controller = new AbortController();
      root[Symbol.for('edup.giga.abort')] = controller;
      const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
      const urls = [...new Set([...document.querySelectorAll('link[rel="modulepreload"][href]')]
        .map(link => new URL(link.href, location.href))
        .filter(url => url.origin === location.origin && /^\/public\/assets\/dist\/assets\/global-[a-z0-9]+\.js$/.test(url.pathname) && !url.search && !url.hash)
        .map(url => url.href))];
      if (urls.length !== 1) fail('PAGE_MODULE_CHANGED');
      const native = await import(urls[0]);
      if (typeof native.F !== 'function') fail('NATIVE_STATE_READER_CHANGED');
      const state = async () => {
        const response = await fetch('/index.php?route=common/home', {
          credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: signal()
        });
        if (!response.ok) fail('SESSION_STATE_FETCH_FAILED');
        const values = [...(await response.text()).matchAll(/window\.__APP_GLOBAL__\s*=\s*(['"])([^'"\r\n]+)\1/g)];
        if (values.length !== 1) fail('LIVE_SESSION_STATE_SCHEMA_CHANGED');
        return JSON.parse(new native.F().decrypt(values[0][2]));
      };
      const routes = new Set(['product/list/search', 'seller/list/list', 'seller_store/home/getStoreTop',
        'product/list/list', 'customerpartner/contacted_seller/buyerCollectByIds']);
      // 0.4.4: at least 3 s between store requests; empty 200 = GIGA wants a human to verify.
      let nextAt = 0;
      const request = async (route, body, method) => {
        if (!routes.has(route)) fail('STORE_ROUTE_NOT_ALLOWED');
        const delay = nextAt - Date.now();
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        nextAt = Date.now() + 3000;
        const query = new URLSearchParams({route, ...(method === 'GET' ? body : {})});
        let response;
        try {
          response = await fetch('/index.php?' + query, {
            method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: signal(),
            headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'ori-status-in-response': 'code'},
            ...(method === 'POST' ? {body: JSON.stringify(body)} : {})
          });
        } catch (error) { fail(error?.name === 'TimeoutError' ? 'GIGA_REQUEST_TIMEOUT' : 'GIGA_REQUEST_FAILED'); }
        if (!response.ok) fail('STORE_HTTP_REQUEST_FAILED');
        const raw = await response.text();
        if (!raw.trim()) fail('GIGA_VERIFICATION_REQUIRED');
        try { return JSON.parse(raw); } catch (_) { fail('GIGA_RESPONSE_INVALID'); }
      };
      const contextKey = Symbol.for('edup.giga.storeContext');
      const context = root[contextKey] ||= {};
      const checkpointKey = async key => 'edup-giga-store-save-v1:' +
        [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))]
          .map(value => value.toString(16).padStart(2, '0')).join('');
      return runStore({task, state, request, context, pace: () => new Promise(resolve => setTimeout(resolve, 250)),
        readCheckpoint: async key => localStorage.getItem(await checkpointKey(key)),
        clearCheckpoint: async key => localStorage.removeItem(await checkpointKey(key)),
        writeCheckpoint: async key => {
          const savedKey = await checkpointKey(key);
          localStorage.setItem(savedKey, 'pending');
          if (localStorage.getItem(savedKey) !== 'pending') fail('STORE_CHECKPOINT_SAVE_FAILED');
        }});
    });
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = {parseSelector, runStore};
  } else {
    return browserRun().catch(error => ({
      state: 'STOPPED', code: /^[A-Z0-9_]{1,100}$/.test(error?.message || '') ? error.message : 'STORE_BROWSER_FAILED'
    }));
  }
})(globalThis);
