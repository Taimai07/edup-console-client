// Small DOM helpers shared by the listing workspace. No inline styles (CSP style-src 'self').
import {STAGES, STAGE_NAME, OWNER, stageIndex} from './listing-states.js';
import {friendlyError, notify} from './notices.js';

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

// A button that runs async work, locks while running and reports failures as toasts.
export function btn(label, work, {primary = false, disabled = false, title = '', cls = ''} = {}) {
  const b = h('button', {class: [primary ? 'lst-primary' : '', cls].filter(Boolean).join(' ') || null, type: 'button', title: title || null}, label);
  b.disabled = disabled;
  b.addEventListener('click', async event => {
    event.stopPropagation();
    if (b.disabled) return;
    b.disabled = true;
    try { await work(event); }
    catch (error) { notify(friendlyError(error)); }
    finally { if (b.isConnected) b.disabled = disabled; }
  });
  return b;
}

export function badge(card) {
  const owner = card.unknown ? 'unknown' : card.stage === 'selling' ? 'done' : ['excluded', 'skipped'].includes(card.stage) ? 'off' : card.owner;
  const text = card.unknown ? '结果待确认' : card.stage === 'selling' ? '在售' : card.stage === 'excluded' ? '已排除'
    : card.stage === 'skipped' ? '不上了' : OWNER[card.owner];
  return h('span', {class: 'lst-badge lst-badge--' + owner}, text);
}

export function stepper(stage) {
  const at = stageIndex(stage);
  return h('ol', {class: 'lst-stepper', 'aria-label': '上架阶段'}, STAGES.map(([key, name], i) =>
    h('li', {class: i < at ? 'is-done' : i === at ? 'is-now' : ''}, name)));
}

export const stageLabel = stage => STAGE_NAME[stage] || stage;

// Closing cleans up directly instead of waiting for the 'close' event, which some embedded
// browsers never deliver.
export function dialog(title, {wide = false, onClose} = {}) {
  const d = h('dialog', {class: 'lst-dialog' + (wide ? ' lst-dialog--wide' : '')});
  const body = h('div', {class: 'lst-dialog-body'});
  let finished = false;
  const finish = () => { if (finished) return; finished = true; if (d.open) d.close(); d.remove(); onClose?.(); };
  const close = h('button', {class: 'lst-close', type: 'button', 'aria-label': '关闭', onclick: finish}, '×');
  d.append(h('header', {class: 'lst-dialog-head'}, h('h2', {}, title), close), body);
  document.body.append(d);
  d.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  d.addEventListener('close', finish, {once: true});
  d.showModal();
  return {dialog: d, body, close: finish, get closed() { return finished; }, setTitle: t => { d.querySelector('h2').textContent = t; }};
}

export function feedback(level, title, text = '', code = '') {
  return h('div', {class: 'lst-feedback lst-feedback--' + level, role: level === 'error' ? 'alert' : 'status'},
    h('strong', {}, title), text ? h('p', {}, text) : null,
    code ? h('details', {}, h('summary', {}, '排查编号'), h('code', {}, code)) : null);
}

export const bjt = seconds => seconds ? new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(seconds * 1000)) : '—';

export const money = value => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—';
