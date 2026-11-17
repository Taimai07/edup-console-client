/* 在已登录的大健网页开发者工具 Console 中运行。
 * 仅检查当前页面状态；不读 Cookie、不收藏、不切换地区，不向外部发送结果。
 */
(async () => {
  const report = {
    probe: 'giga-session-v2',
    checkedAt: new Date().toISOString(),
    expectedCountryId: null,
    loggedIn: null,
    buyer: null,
    countryId: null,
    countryCode: null,
    ready: false,
    status: 'CHECK_NOT_COMPLETED'
  };
  try {
    if (location.origin !== 'https://www.gigab2b.com' || window !== window.top) {
      throw new Error('OPEN_GIGA_TOP_LEVEL_PAGE');
    }
    const urls = [...document.querySelectorAll('link[rel="modulepreload"][href]')]
      .map(link => new URL(link.href, location.href))
      .filter(url => url.origin === location.origin &&
        /^\/public\/assets\/dist\/assets\/global-[a-z0-9]+\.js$/.test(url.pathname) &&
        !url.search && !url.hash);
    const unique = [...new Set(urls.map(url => url.href))];
    if (unique.length !== 1) throw new Error('PAGE_MODULE_CHANGED');
    let timer;
    let module;
    try {
      module = await Promise.race([
        import(unique[0]),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('PAGE_MODULE_TIMEOUT')), 10000);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
    const state = module.g;
    if (!state || typeof state !== 'object') throw new Error('PAGE_STATE_CHANGED');
    const bool = value => [true, 1, '1', 'true'].includes(value) ? true :
      [false, 0, '0', 'false'].includes(value) ? false : null;
    report.loggedIn = bool(state.is_logged);
    report.buyer = bool(state.is_buyer);
    const id = String(state.country_id ?? '');
    report.countryId = /^\d{1,6}$/.test(id) ? Number(id) : null;
    report.countryCode = typeof state.country_code === 'string' &&
      /^[A-Z]{2,3}$/.test(state.country_code) ? state.country_code : null;
    report.ready = report.loggedIn === true && report.buyer === true &&
      ({81:'DEU',223:'USA',222:'GBR',38:'CAN',107:'JPN'})[report.countryId] === report.countryCode;
    report.status = report.ready ? 'BUYER_PAGE_STATE_READ' :
      report.loggedIn === false ? 'LOGIN_REQUIRED' :
      report.countryId !== 81 || report.countryCode !== 'DEU' ? 'REGION_MISMATCH_OR_UNKNOWN' :
      'BUYER_STATUS_NOT_VERIFIED';
  } catch (error) {
    const codes = ['OPEN_GIGA_TOP_LEVEL_PAGE', 'PAGE_MODULE_CHANGED',
      'PAGE_MODULE_TIMEOUT', 'PAGE_STATE_CHANGED'];
    report.status = codes.includes(error?.message) ? error.message : 'PAGE_MODULE_LOAD_FAILED';
  }
  console.log('GIGA_US_SESSION_PROBE ' + JSON.stringify(report));
  return report;
})();
