// The listing workspace ("上架"), semi-automatic since 0.8.7 (user decision 2026-11-11):
// the client only takes SKUs / a 大健 store, reads return rates in the 大健 page, and hands the
// SKUs that passed to the server. Everything after that (AI preparation, checks, Amazon listing,
// missing facts) is handled on the server back end and is no longer shown or driven from here.
// Mounted once and only hidden when another tab is open, so a running screening is never torn
// down by a re-render.
import {h} from './listing-kit.js';
import {createStore} from './listing-store.js';
import {runner} from './listing-runner.js';
import {semiStatus} from './listing-status.js';
import {createBar} from './listing-app-bar.js';
import {createPages} from './listing-app-pages.js';
import {createWizard} from './listing-app-wizard.js';
export {semiStatus};

export function mountListing(root, {call, getSnapshot, isOffline}) {
  const store = createStore({call, getSnapshot, isOffline});
  const ctx = {route: {page: 'lists'}, helpOpen: false};
  const backups = new Map();
  let visible = false, renderedPage = '', timer = null, ticks = 0;
  const selected = new Set(), rows = new Map();
  const selectedGroups = new Set();
  const wizard = {step: 1, source: 'paste', text: '', extraction: null, skipKnown: true, label: ''};

  const bar = h('div', {class: 'lst-bar'}), runnerBox = h('div', {class: 'lst-runner'}), page = h('div', {class: 'lst-page'});
  root.classList.add('lst');
  root.replaceChildren(bar, runnerBox, page);

  const go = next => { ctx.route = next; selected.clear(); render(true); page.scrollIntoView?.({block: 'start'}); };
  const offline = () => isOffline();
  // Only lists made on a client; old server AI batches belong to the back end now.
  const myLists = () => store.lists().filter(l => l.source === 'local');
  const allCards = () => myLists().flatMap(l => store.cardsFor(l));
  Object.assign(ctx, {store, backups, selected, rows, selectedGroups, wizard, bar, runnerBox, page, call, go, offline, myLists, allCards, render});
  createBar(ctx); createPages(ctx); createWizard(ctx);

  // ---------- render loop ----------
  function render(force = false) {
    if (!visible) return;
    ctx.renderBar();
    ctx.renderRunner();
    const key = JSON.stringify([ctx.route.page, ctx.route.id, ctx.route.groupId, ctx.route.filter, store.site]) + (ctx.route.page === 'new' ? ':' + wizard.step : '');
    if (ctx.route.page === 'list' && !force && key === renderedPage) { ctx.renderTableOnly(); return; }
    if (ctx.route.page === 'new' && !force && key === renderedPage) return;  // never wipe what the operator is typing
    renderedPage = key;
    const scroll = page.scrollTop;
    const parts = ctx.route.page === 'new' ? ctx.wizardPage() : ctx.route.page === 'list' ? ctx.listPage()
      : ctx.route.page === 'uploaded' ? ctx.uploadedPage() : ctx.lists();
    page.replaceChildren(...parts.flat().filter(Boolean));
    page.scrollTop = scroll;
  }

  let pending = false;
  const schedule = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; render(); }, 60); };
  store.subscribe(schedule);
  let lastAdmission = null;
  runner.subscribe(state => {
    const admission = state.admission;
    if (admission && admission.requestId !== lastAdmission) {
      lastAdmission = admission.requestId;
      store.invalidateJob(admission.rootJobId);
    }
    schedule();
  });

  // Jobs are read only to learn which SKUs reached the server; finished ones are re-read rarely.
  async function tick() {
    if (!visible || document.hidden) return;
    ticks++;
    await store.refreshBrowser();
    if (ticks % 12 === 1) await store.refreshService();
    const ids = ctx.route.page === 'list' ? (store.list(ctx.route.id)?.jobs || []) : myLists().flatMap(l => l.jobs);
    await store.refreshJobs(ids, {fast: 10000, slow: 10 * 60000});
  }

  return {
    show() {
      const first = !visible;
      visible = true;
      if (first) { renderedPage = ''; render(true); tick(); }
      else render(true);
      if (!timer) timer = setInterval(tick, 5000);
    },
    hide() { visible = false; clearInterval(timer); timer = null; },
    refresh() { ticks = 0; store.refreshJobs(myLists().flatMap(l => l.jobs), {force: true}); tick(); },
    store, runner,
  };
}
