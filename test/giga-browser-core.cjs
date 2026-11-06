/* 在已登录大健德国站页面的 Console 中粘贴整个文件运行。
 * 只处理下列10款；仅添加收藏，不取消收藏、不切账号、不操作Amazon。
 * Cookie留在浏览器内；结果只输出至Console。失败不自动重试写请求。
 */
(function (root) {
  'use strict';
  const SKUS = Object.freeze(['WTEST1','WTEST2','WTEST3']);
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
  // Dependency-injected core. No browser/session secrets are returned to callers.
  async function run({state, post, load, save, hash, progress = () => {}, skus = SKUS, site = 'DE'}) {
    const region = REGIONS[site];
    if (!region || !Array.isArray(skus) || !skus.length || skus.length > 20 ||
      new Set(skus).size !== skus.length || skus.some(s => typeof s !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(s))) fail('FROZEN_TASK_SCOPE_INVALID');
    const startedAt = new Date().toISOString();
    const buyer = identity(await state(), region);
    const scope = await hash(JSON.stringify({version: VERSION, countryId: region.id, buyer, skus}));
    const previous = await load(scope);
    if (previous && (previous.version !== VERSION || previous.scope !== scope)) fail('CHECKPOINT_SCOPE_CHANGED');
    const ledger = previous || {version: VERSION, scope, countryId: region.id, items: {}};
    const result = {version: VERSION, startedAt, countryId: region.id, countryCode: region.code,
      state: 'CHECKING', items: [], amazonSubmitted: false};
    const guard = async () => sameIdentity(await state(), buyer, region);
    async function read(id, sku) {
      await guard();
      const response = await post('product/list/list', {
        product_ids: [id], with_seller: false, with_wishlist: true, type: 'grid'
      });
      await guard();
      if (response?.code !== 200) fail('PRODUCT_READ_REJECTED');
      const product = exactProduct(response.data, sku);
      if (product.id !== id) fail('PRODUCT_ID_CHANGED');
      return product;
    }
    // Resolve every SKU before the first write. An uncertain search schema sends no favorite request.
    const products = [];
    for (const sku of skus) {
      await guard();
      const response = await post('product/list/search', {
        search: sku, page: 1, limit: 20, scene: 1, search_dimension: 1, dimension_type: 1
      });
      await guard();
      if (response?.code !== 200 || !Array.isArray(response.data?.product_list)) fail('PRODUCT_SEARCH_REJECTED_OR_SCHEMA_CHANGED');
      const ids = response.data.product_list;
      if (!ids.length || ids.length > 20 || ids.some(id => !/^[A-Za-z0-9_-]{1,64}$/.test(String(id)))) fail('SEARCH_IDS_NOT_VERIFIED');
      const detail = await post('product/list/list', {
        product_ids: ids, with_seller: false, with_wishlist: true, type: 'grid'
      });
      await guard();
      if (detail?.code !== 200) fail('PRODUCT_READ_REJECTED');
      const product = exactProduct(detail.data, sku);
      if (!ids.map(String).includes(product.id)) fail('SEARCH_PRODUCT_ID_MISMATCH');
      products.push({sku, id: product.id});
      progress({sku, state: 'EXACT_PRODUCT_RESOLVED'});
    }
    if (new Set(products.map(product => product.id)).size !== skus.length) fail('PRODUCT_ID_REUSED_FOR_DIFFERENT_SKUS');
    for (const {sku, id} of products) {
      const old = ledger.items[sku];
      if (old && old.productId !== id) fail('CHECKPOINT_PRODUCT_ID_CHANGED');
      const current = await read(id, sku);
      if (current.saved) {
        ledger.items[sku] = {productId: id, state: 'VERIFIED_SAVED', checkedAt: new Date().toISOString()};
        await save(scope, ledger);
        result.items.push({sku, productId: id, state: 'ALREADY_SAVED_OR_RECONCILED'});
        continue;
      }
      // A prior attempt or verified item becoming unsaved is a reconciliation hold, not a fresh add.
      if (old) fail('PREVIOUS_ATTEMPT_REQUIRES_RECONCILIATION');
      await guard();
      ledger.items[sku] = {productId: id, state: 'STARTED', startedAt: new Date().toISOString()};
      await save(scope, ledger); // Must persist BEFORE the request.
      let accepted = false;
      try {
        const added = await post('account/wishlist/addProductsToWish', {
          product_ids: id, group_id: 0, source: ''
        });
        accepted = added?.code === 200;
      } catch (_) {
        // Never resend. The single read below may establish that the write completed.
      }
      ledger.items[sku].state = accepted ? 'RESPONSE_ACCEPTED' : 'OUTCOME_UNKNOWN';
      await save(scope, ledger);
      const after = await read(id, sku);
      if (!after.saved) fail('FAVORITE_NOT_VERIFIED_DO_NOT_RESEND');
      ledger.items[sku] = {productId: id, state: 'VERIFIED_SAVED', checkedAt: new Date().toISOString()};
      await save(scope, ledger);
      result.items.push({sku, productId: id, state: accepted ? 'ADDED_AND_VERIFIED' : 'RECONCILED_SAVED'});
      progress(result.items[result.items.length - 1]);
    }
    await guard();
    result.state = 'ALL_SAVED_VERIFIED';
    result.finishedAt = new Date().toISOString();
    return result;
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
      const frozen = task ? {site: task.site, skus: task.skus} : {site: 'DE', skus: [...SKUS]};
      const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
      const urls = [...document.querySelectorAll('link[rel="modulepreload"][href]')]
        .map(link => new URL(link.href, location.href))
        .filter(url => url.origin === location.origin &&
          /^\/public\/assets\/dist\/assets\/global-[a-z0-9]+\.js$/.test(url.pathname) && !url.search && !url.hash);
      const unique = [...new Set(urls.map(url => url.href))];
      if (unique.length !== 1) fail('PAGE_MODULE_CHANGED');
      const native = await import(unique[0]);
      if (typeof native.F !== 'function') fail('NATIVE_STATE_READER_CHANGED');
      const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      async function request(route, body) {
        if (controller.signal.aborted) fail('TASK_CANCELLED');
        const allowed = ['product/list/search', 'product/list/list', 'account/wishlist/addProductsToWish'];
        if (!allowed.includes(route)) fail('ROUTE_NOT_ALLOWED');
        const response = await fetch('/index.php?route=' + route, {
          method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
          signal: signal(),
          headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'ori-status-in-response': 'code'},
          body: JSON.stringify(body)
        });
        if (!response.ok) fail('HTTP_REQUEST_FAILED');
        return response.json();
      }
      async function state() {
        if (controller.signal.aborted) fail('TASK_CANCELLED');
        // Fresh server-rendered state, not the potentially stale global from a background tab.
        const response = await fetch('/index.php?route=common/home', {
          credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: signal()
        });
        if (!response.ok) fail('SESSION_STATE_FETCH_FAILED');
        const html = await response.text();
        const matches = [...html.matchAll(/window\.__APP_GLOBAL__\s*=\s*(['"])([^'"\r\n]+)\1/g)];
        if (matches.length !== 1) fail('LIVE_SESSION_STATE_SCHEMA_CHANGED');
        return JSON.parse(new native.F().decrypt(matches[0][2]));
      }
      const prefix = 'edup-giga-favorites-v1:';
      const load = async scope => {
        const text = localStorage.getItem(prefix + scope);
        return text === null ? null : JSON.parse(text);
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
      return run({state, post: request, hash, load, save, ...frozen,
        progress: item => console.log('GIGA_DE_PROGRESS ' + JSON.stringify(item))});
    });
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = {run, identity, exactProduct, SKUS, VERSION};
  } else {
    return browserRun().then(result => { console.log('GIGA_DE_RESULT ' + JSON.stringify(result)); return result; })
      .catch(error => {
        const code = /^[A-Z0-9_]{1,100}$/.test(error?.message || '') ? error.message : 'BROWSER_TEST_FAILED';
        const result = {version: VERSION, state: 'STOPPED', code,
          note: '保留已完成及未知回执；不自动重发。此结果不代表10款均未修改。', amazonSubmitted: false};
        console.log('GIGA_DE_RESULT ' + JSON.stringify(result));
        return result;
      });
  }
})(globalThis);
