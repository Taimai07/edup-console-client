// The submit sheet (spec §6.6), the answer-questions form (§6.7) and the product drawer (§6.5).
import '../common/human-report.js';
import {h, badge, stepper, money, stageLabel} from './listing-kit.js';
import {ACTION} from './listing-states.js';
import {preparationReport} from '../operations/operations.js';
import {batchChat} from '../operations/batch-chat.js';
import {SITE_NAME} from './listing-sheets-common.js';
export {openSubmitSheet} from './listing-submit-sheet.js';
export {openQuestions} from './listing-questions.js';

// Product drawer: the "now" box and details. `ctx.action(card, id)` runs an action.
export function renderDrawer(target, card, ctx) {
  const {site, call, offline} = ctx;
  target.replaceChildren();
  const close = h('button', {class: 'lst-close', type: 'button', 'aria-label': '关闭', onclick: ctx.close}, '×');
  const head = h('header', {class: 'lst-drawer-head'}, h('div', {}, h('h2', {}, card.sku), h('p', {class: 'muted'}, [card.name, SITE_NAME[site] || site].filter(Boolean).join(' · '))), close);
  const now = h('section', {class: 'lst-now lst-now--' + (card.unknown ? 'unknown' : card.owner)});
  const fill = c => {
    now.replaceChildren(h('div', {class: 'lst-now-line'}, badge(c), h('strong', {}, c.headline)), h('p', {class: c.detail ? '' : 'lst-hide'}, c.detail || ''),
      h('div', {class: 'lst-actions'}, c.primary ? ctx.actionButton(c, c.primary, true) : h('span', {class: 'muted'}, '无需操作'),
        (c.secondary || []).filter(a => !['ask_ai', 'view_report'].includes(a)).map(a => ctx.actionButton(c, a)), c.stage !== 'skipped' && !['selling', 'excluded'].includes(c.stage) && c.primary !== 'skip'
          ? ctx.actionButton(c, 'skip') : null));
  };
  fill(card);
  const facts = h('section', {class: 'lst-drawer-facts'});
  const fillFacts = c => {
    const rows = [];
    if (c.quote) rows.push(['大健报价', money(c.quote.purchaseQuote) + ' + 运费 ' + money(c.quote.shippingQuote) + ' ' + (c.quote.currency || '')],
      ['大健库存', c.quote.available ?? '—']);
    if (c.submission) rows.push(['提交记录', c.submission.state + (c.submission.result?.code ? ' · ' + c.submission.result.code : '')]);
    if (c.asin) rows.push(['ASIN', c.asin]);
    rows.push(['批次', c.rootJobId || '还没交给服务器'], ['排查编号', c.code || '—']);
    facts.replaceChildren(h('h3', {}, '资料'), h('dl', {class: 'lst-dl'}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))])));
    if (c.problems?.length) facts.append(h('h3', {}, '问题说明'), ...c.problems.map(p => h('div', {class: 'lst-problem'},
      h('strong', {}, p.title), h('p', {}, p.why), h('p', {class: 'muted'}, '怎么办：' + p.next))));
  };
  fillFacts(card);
  const extra = h('section', {class: 'lst-drawer-extra'});
  let closeChat = null;
  const tabs = h('div', {class: 'lst-tabs'},
    card.rootJobId ? h('button', {type: 'button', onclick: () => {
      closeChat?.(); closeChat = null; extra.replaceChildren();
      preparationReport(extra, card.item?.sourceJobId || card.jobId || card.rootJobId, card.sku, card.code ? 'failure' : 'status');
    }}, ACTION.view_report) : null,
    card.rootJobId ? h('button', {type: 'button', onclick: () => {
      closeChat?.(); extra.replaceChildren(); const box = h('section'); extra.append(box);
      closeChat = batchChat(box, card.rootJobId, {call, offline});
    }}, ACTION.ask_ai) : null);
  target.append(head, now, stepper(card.stage), h('p', {class: 'muted lst-stage-now'}, '现在：' + stageLabel(card.stage)), facts, tabs, extra);
  return {
    update(c) { fill(c); fillFacts(c); target.querySelector('.lst-stepper')?.replaceWith(stepper(c.stage));
      const s = target.querySelector('.lst-stage-now'); if (s) s.textContent = '现在：' + stageLabel(c.stage); },
    openTab(name) { [...tabs.children].find(b => b.textContent === (name === 'ask_ai' ? ACTION.ask_ai : ACTION.view_report))?.click(); },
    dispose() { closeChat?.(); },
  };
}
