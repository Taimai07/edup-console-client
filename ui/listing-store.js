// Data for the listing workspace: lists, server jobs, browser status and the derived cards.
// Fetching is paced: running jobs every few seconds, finished jobs rarely (spec §8.4).
import {jobCards, mergeCards, productCard} from './listing-states.js';
import {runner, local} from './listing-runner.js';
import {bjt} from './listing-kit.js';

const DAY = 86400;

export function createStore({call, getSnapshot, isOffline}) {
  const listeners = new Set();
  const jobs = new Map();          // id -> {job, at, error}
  const invalidated = new Set();
  let batches = [], sites = null, service = null, browser = null, site = 'US', version = 0;
  const changed = () => { version++; for (const fn of listeners) fn(version); };

  const liveBySku = () => {
    const rows = getSnapshot()?.products || [];
    return new Map(rows.filter(p => p.site === site).map(p => [p.sku, p]));
  };

  // A "清单" is what the operator started together. Lists made in the new wizard are kept on this
  // computer; older server batches without one show as their own list.
  function lists() {
    const mine = local.lists().filter(l => l.site === site);
    const claimed = new Set(mine.flatMap(l => l.jobs));
    const legacy = site === 'US' ? batches.filter(b => !claimed.has(b.id)).map(b => ({
      id: 'job:' + b.id, label: '批次 · ' + bjt(b.created),
      site, created: b.created, codes: b.codes || [], jobs: [b.id], source: 'server'})) : [];
    return [...mine.map(l => ({...l, source: 'local'})), ...legacy].sort((a, b) => b.created - a.created);
  }

  function cardsFor(list) {
    const live = liveBySku(), screens = local.screens(), skips = local.skips();
    const fromJobs = list.jobs.map(id => jobs.get(id)?.job).filter(Boolean)
      .map(job => jobCards(job, {site, liveBySku: live, screens, skips}));
    const merged = mergeCards(fromJobs);
    const seen = new Set(merged.map(c => c.sku));
    const run = runner.state, runningCodes = new Set(runner.busy() && run.task?.site === site ? run.task.codes : []);
    for (const sku of list.codes) {
      if (seen.has(sku)) continue;
      let c = productCard({sku, screen: screens.get(site + ':' + sku), live: live.get(sku), skipped: skips.has(site + ':' + sku)});
      if (runningCodes.has(sku) && ['queued', 'screening'].includes(c.stage))
        c = {...c, stage: 'screening', owner: 'program', headline: '在大健页面筛选中', detail: '', primary: null};
      merged.push(c);
    }
    return merged.map(c => ({...c, listId: list.id, listSource: list.source}));
  }

  async function fetchJob(id) {
    const refreshAfterAdmission = invalidated.delete(id);
    try {
      const job = await call('giga_job', {id});
      const prev = jobs.get(id);
      const sig = JSON.stringify([job.state, job.result, job.submissions, job.childJobs]);
      jobs.set(id, {job: {...job, created: job.created || prev?.job?.created || batches.find(b => b.id === id)?.created}, at: Date.now(), sig});
      if (prev?.sig !== sig) changed();
    } catch (error) {
      if (refreshAfterAdmission) invalidated.add(id);
      const prev = jobs.get(id);
      jobs.set(id, {...(prev || {}), at: Date.now(), error});
      if (!prev?.error) changed();
    }
  }

  // Refresh the given jobs: running ones after `fast` ms, finished ones after `slow` ms.
  let inflight = false;
  async function refreshJobs(ids, {fast = 5000, slow = 60000, force = false} = {}) {
    if (inflight || isOffline()) return;
    inflight = true;
    try {
      const now = Date.now();
      const due = ids.filter(id => {
        const e = jobs.get(id);
        if (!e || force || invalidated.has(id)) return true;
        const live = ['queued', 'running'].includes(e.job?.state);
        return now - e.at >= (live ? fast : slow);
      }).slice(0, 6);
      for (const id of due) await fetchJob(id);
    } finally { inflight = false; }
  }

  async function refreshBatches() {
    try {
      const r = await call('batch_chat_list');
      const next = (r.batches || []).map(b => ({id: b.id, created: b.created, codes: b.codes || []}));
      if (JSON.stringify(next) !== JSON.stringify(batches)) { batches = next; changed(); }
    } catch { /* lists from this computer still show */ }
  }

  async function refreshService() {
    try {
      service = await call('service_status');
      const next = service.listingSites || {sites: []};
      if (JSON.stringify(next) !== JSON.stringify(sites)) {
        sites = next;
        if (!sites.sites.some(s => s.code === site) && sites.sites[0]) site = sites.sites[0].code;
      }
      changed();
    } catch { sites = sites || {sites: [], unavailable: true}; changed(); }
  }

  async function refreshBrowser() {
    if (!window.edup?.maintenance) return;
    const next = await window.edup.maintenance('giga-browser-status').catch(() => ({connected: false, code: 'GIGA_BROWSER_SETUP_REQUIRED'}));
    const sig = JSON.stringify([next.connected, next.inspection, next.extensionProtocol, next.accountScopeV2, next.code]);
    if (sig !== browser?.sig) { browser = {...next, sig}; changed(); }
  }

  function recentLists(days = 14, maxJobs = 12) {
    const since = Date.now() / 1000 - days * DAY, out = [];
    let count = 0;
    for (const l of lists()) {
      if (l.created < since && out.length) break;
      if (count + l.jobs.length > maxJobs && out.length) break;
      out.push(l); count += l.jobs.length;
    }
    return out;
  }

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get version() { return version; },
    get site() { return site; },
    setSite(code) { if (code && code !== site) { site = code; changed(); } },
    get sites() { return sites; },
    get service() { return service; },
    get browser() { return browser; },
    jobs, lists, cardsFor, recentLists, refreshJobs, refreshBatches, refreshService, refreshBrowser, fetchJob,
    invalidateJob(id) { invalidated.add(id); },
    job: id => jobs.get(id)?.job || null,
    list: id => lists().find(l => l.id === id) || null,
    homeCards() { return mergeCards(recentLists().map(cardsFor)); },
    touch: changed,
  };
}
