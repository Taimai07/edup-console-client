// One place that turns server records into what the operator sees for one product:
// stage (where it is), owner (whose turn), one sentence, and the one next action.
// Until the server read model exists (redesign spec §7.1), the client derives this from
// giga_job, the snapshot and local screening receipts. Keep every state text here.
import {issueDetails} from './batch-progress.js';

export const STAGES = Object.freeze([
  ['queued', '待开始'], ['screening', '筛选'], ['preparing', '准备'], ['ready', '待提交'],
  ['creating', '建链中'], ['opening', '开卖核对'], ['selling', '在售'],
]);
export const STAGE_NAME = Object.freeze({...Object.fromEntries(STAGES), excluded: '已排除', skipped: '不上了'});
export const OWNER = Object.freeze({
  you: '等你处理', program: '程序在做', platform: '等亚马逊', maintainer: '维护者处理', none: '',
});
export const OWNER_ORDER = Object.freeze(['you', 'program', 'platform', 'maintainer', 'none']);
export const ACTION = Object.freeze({
  confirm_submit: '确认提交', answer_questions: '回答问题', recheck: '重新检查', prepare: '开始准备',
  rescreen: '重新筛选', check_result: '核对结果', open_buyer_page: '打开买家页面',
  copy_for_maintainer: '复制给维护者', ask_ai: '问 AI', view_report: '看原始报告', skip: '不上这款', unskip: '恢复上架',
});

const PHASE = Object.freeze({
  PREPARING: '准备上架资料', FACTS_PREPARING: '核对商品资料和图片', FIELDS_PREPARING: '整理类目字段',
  COPY_GENERATING: '生成商品文案', SEMANTIC_REVIEW: '复核图片和文案', VALIDATED: '本地校验通过，等亚马逊预检',
  DOCUMENT_READING: '读取说明书', DOCUMENT_MODEL_READING: '逐页识别说明书', document: '逐页识别说明书',
  document_context: '整理说明书内容', document_review: '核对说明书引用', copy: '生成商品文案',
  PRODUCT_TYPE_DISCOVERY: '查亚马逊类目', facts: '核对商品资料和图片', field_selection: '选择商品字段',
  attributes: '整理类目字段', required_fields: '检查必填字段', review: '复核图片和文案', repair: '修正复核问题',
});
export const phaseName = state => PHASE[state] || '';

// Problems the operator can settle by simply running the check again.
const RETRY_KEYS = new Set(['service', 'image-transfer', 'image-network', 'document-size', 'document-reader',
  'document-download', 'category']);
// Problems only a maintainer can fix; asking the operator for facts would be wrong.
const MAINTAINER_KEYS = new Set(['image-maintenance', 'document-model', 'reference', 'request-size', 'document-timeout',
  'process-timeout', 'format', 'taxonomy', 'dg', 'review', 'fabric', 'image']);

const RATE_TEXT = Object.freeze({
  RATE_MEDIUM: '详情页退货率是「中」，按规则不上', RATE_HIGH: '详情页退货率是「高」，按规则不上',
  RETURN_RATE_NOT_LOW: '退货率不是「低」，按规则不上',
  RATE_UNVERIFIED: '没读到详情页退货率', RETURN_RATE_UNVERIFIED: '没读到详情页退货率',
  RATE_FRAME_BLOCKED: '详情页被拦截或跳转，没读到退货率', RATE_TIMEOUT: '详情页读取超时',
  RATE_SKU_UNVERIFIED: '详情页里没找到这款 SKU', RATE_LABEL_UNVERIFIED: '详情页没有可用的退货率标签',
  RATE_CONFLICT: '详情页的退货率标签互相矛盾', RESOLVE_FAILED: '没能确认这款 SKU 对应哪件大健商品',
  FAVORITE_EXPIRED: '收藏记录已过期', FAVORITE_CONNECTION_CHANGED: '换过大健连接，收藏记录要重新核对',
  FAVORITE_NOT_VERIFIED: '收藏结果没核实', NO_FAVORITE_EVIDENCE: '还没有筛选记录', SERVER_RECHECK: '服务器要求重新筛选',
  RECONCILIATION_PENDING: '上次收藏结果待核对',
});
const EXCLUDED_RATES = new Set(['RATE_MEDIUM', 'RATE_HIGH', 'RETURN_RATE_NOT_LOW']);
export const screeningText = reason => RATE_TEXT[reason] || '筛选记录不可用';
export const isExcludedRate = reason => EXCLUDED_RATES.has(reason);

const card = (stage, owner, headline, detail = '', primary = null, extra = {}) =>
  ({stage, owner, headline, detail, primary, secondary: [], ...extra});

function submissionCard(sub) {
  const r = sub.result || {}, code = r.code || r.platform?.reason || r.platform?.code || '';
  const readback = sub.operationId ? 'check_result' : null;
  switch (sub.state) {
    case 'queued': case 'checking': return card('creating', 'program', '排队等提交', '服务器在逐款检查提交条件。');
    case 'submitting': return card('creating', 'program', '正在提交到亚马逊');
    case 'accepted': return card('creating', 'platform', '亚马逊已接收，等结果回读', '系统会自动回来查；不用重复提交。', null,
      {secondary: readback ? [readback] : []});
    case 'needs_reconciliation': return readback
      ? card('creating', 'you', '可能已经提交，先核对结果', '这次提交没收到明确结果。先核对，不要重复提交。', readback, {unknown: true, code})
      : card('creating', 'program', '可能已经提交，系统正在核对', '不要重复提交，稍后刷新。', null, {unknown: true, code});
    case 'not_sent': return card('ready', 'you', '没发出去，可以放心重新提交', '服务器确认这次提交没有发给亚马逊。', 'confirm_submit', {code});
    case 'rejected': return card('ready', 'you', '亚马逊没接受这次提交', '看原始报告了解原因，处理后重新检查。', 'recheck',
      {code, secondary: ['view_report', 'ask_ai']});
    case 'needs_review': {
      if (code === 'PRICING_RULE_CHANGED_REPREPARE') return card('preparing', 'you', '定价规则变了，没有提交', '重新检查后按新售价确认。', 'recheck', {code});
      if (/PRICE_DRIFT/.test(code)) return card('preparing', 'you', '大健价格变了，没有提交', '重新检查后核对新售价再确认。', 'recheck', {code});
      if (/STOCK_DRIFT/.test(code)) return card('preparing', 'you', '大健库存变了，没有提交', '重新检查库存后再确认。', 'recheck', {code});
      if (/OWNER_FACTS|DETAIL_DRIFT/.test(code)) return card('preparing', 'you', '商品资料在确认后变了，没有提交', '重新检查后再确认。', 'recheck', {code});
      if (/VALIDATION/.test(code)) return card('preparing', 'you', '亚马逊预检没通过，没有提交', '看原始报告了解原因，处理后重新检查。', 'recheck',
        {code, secondary: ['view_report', 'ask_ai']});
      if (['PREVIEW_PROGRAM_FAILED', 'PREVIEW_CHECK_FAILED', 'PRE_SUBMIT_PROGRAM_ERROR', 'SUBMISSION_REQUIRES_CHECK'].includes(code))
        return card('ready', 'maintainer', '提交前检查程序出错，没有提交', '不需要你补资料，等维护者修复。', 'copy_for_maintainer', {code});
      return card('ready', 'maintainer', '提交前检查没通过，没有提交', '资料已保留，不会自动重复提交。', 'copy_for_maintainer', {code});
    }
    default: return null;
  }
}

function snapshotCard(live) {
  if (!live) return null;
  const buyable = (live.status || []).includes('BUYABLE');
  const qty = Number.isFinite(Number(live.available)) ? Number(live.available) : null;
  if (buyable && qty > 0) return card('selling', 'none', '在售 ' + qty + ' 件', '', 'open_buyer_page', {asin: live.asin});
  return card('opening', 'program', '零库存链接已建立，等自动核对和库存同步',
    '系统核对刊登属性、图片和平台报价。实际买家页面可点开查看，大健没货时库存保持为 0。', null, {asin: live.asin,
      secondary: live.asin ? ['open_buyer_page'] : []});
}

function itemCard(item, {running, mode}) {
  const code = item.reason || item.failure?.code || '';
  if (item.state === 'ALREADY_SUBMITTED' || item.state === 'PUBLICATION_PENDING')
    return card('creating', 'platform', '已有提交记录，等亚马逊结果', '不会重复提交。');
  if (item.latestAttempt && !running)
    return card('preparing', 'you', '上次重新检查没完成，原结果保留', '处理好之后再重新检查一次；不需要重新输入编码。', 'recheck',
      {code: item.latestAttempt.reason || code});
  if (item.state === 'PREVIEW_VALID') return card('ready', 'you', '预检通过，可以提交', '核对售价和库存后确认。', 'confirm_submit');
  if (running && (PHASE[item.state] || !item.state)) return card('preparing', 'program', '正在' + (PHASE[item.state] || '准备上架资料'));
  if (item.state === 'COLOR_FAMILY_REVIEW_REQUIRED')
    return card('preparing', 'maintainer', '可能和别的颜色是同一款', '颜色合并功能还没接到工作台，先交维护者处理，不会重复建链接。', 'copy_for_maintainer');
  if (['PREVIEW_VALID_DRAFT_STOCK_HOLD', 'PREPARED_OUT_OF_STOCK'].includes(item.state))
    return card('preparing', 'you', '库存状态要重新核对', '新链接可以按库存 0 建立，重新检查一次即可。', 'recheck');
  if (mode !== 'ai_workflow' && ['NEEDS_INPUT', 'MODEL_EXECUTION_DISABLED', 'COPY_READY_REVIEW_REQUIRED'].includes(item.state))
    return card('preparing', 'you', '只读取了资料，还没准备', '开始准备后才会生成上架资料。', 'prepare');
  const failed = ['PREPARATION_EXCEPTION', 'EXCEPTION', 'NEEDS_SOURCE_REVIEW', 'PREVIEW_REJECTED'].includes(item.state) ||
    /^(PLANNER_|MODEL_|INFERENCE_)/.test(code);
  if (!failed) return running ? card('preparing', 'program', '正在准备上架资料')
    : card('preparing', 'you', '准备没完成', '重新检查一次；不需要重新输入编码。', 'recheck', {code});
  const problems = issueDetails(item);
  const questions = problems.filter(p => p.needsInput);
  if (questions.length) return card('preparing', 'you', '要你回答 ' + questions.length + ' 个问题',
    questions.map(p => p.title).join('；'), 'answer_questions', {code, problems, secondary: ['ask_ai']});
  if (item.failure?.details?.reason === 'plan_usage_paused')
    return card('preparing', 'you', '模型服务暂停过，这一步没执行', '不需要补资料。服务恢复后重新检查。', 'recheck', {code, problems});
  if (/BUDGET|DAILY_CALL_CAP/.test(code))
    return card('preparing', 'you', '今天的模型调用额度用完了', '不需要补资料。额度恢复后重新检查。', 'recheck', {code, problems});
  if (problems.length && problems.every(p => RETRY_KEYS.has(p.key)))
    return card('preparing', 'you', problems.map(p => p.title).join('；'), '不需要补资料，重新检查一次即可。', 'recheck', {code, problems});
  if (problems.some(p => p.key.startsWith('unmapped')) && !problems.some(p => MAINTAINER_KEYS.has(p.key)))
    return card('preparing', 'you', '报告里有一项没说清楚', '先问 AI 具体缺什么；不要猜着补资料。', 'ask_ai', {code, problems});
  if (item.state === 'PREVIEW_REJECTED' && !problems.length)
    return card('preparing', 'maintainer', '亚马逊预检没通过', '看原始报告了解平台反馈；需要维护者处理。', 'copy_for_maintainer',
      {code, problems, secondary: ['view_report']});
  if (/UNCERTAIN|CHECK_PENDING/.test(code))
    return card('preparing', 'maintainer', '模型请求结果不明，没有自动重发', '不需要补资料，等维护者核对。', 'copy_for_maintainer', {code, problems});
  return card('preparing', 'maintainer', problems.length ? problems.map(p => p.title).join('；') : '准备程序出错',
    '程序侧的问题，不需要你补资料。', 'copy_for_maintainer', {code, problems, secondary: ['view_report', 'ask_ai']});
}

// One product inside one server job. `screen` is the local screening record, `live` the
// snapshot product row, `skipped` the operator's local "不上这款".
export function productCard({sku, job = {}, item, quote, submission, screen, live, skipped = false}) {
  const running = ['queued', 'running', 'starting'].includes(job.state);
  const mode = job.preparationMode || job.result?.preparationMode;
  let c = null;
  if (skipped) c = card('skipped', 'none', '你选了不上这款', '', 'unskip');
  if (!c && live && (submission?.state === 'verified' || ['ALREADY_SUBMITTED', 'PUBLICATION_PENDING'].includes(item?.state) || !item))
    c = snapshotCard(live);
  if (!c && submission?.state === 'verified')
    c = card('opening', 'program', '零库存链接已建立，等自动核对和库存同步', '经营数据同步后会显示在售数量。');
  if (!c && submission) c = submissionCard(submission);
  if (!c && quote?.quoteScreen) c = quote.quoteScreen === 'GIGA_LANDED_QUOTE_OVER_3000_USD'
    ? card('excluded', 'none', '采购价加运费超过 3000 USD，按规则不上')
    : card('preparing', 'maintainer', '报价或币种待核实，已暂停', '', 'copy_for_maintainer', {code: quote.quoteScreen});
  if (!c && item) c = itemCard(item, {running, mode});
  if (!c && screen) {
    if (isExcludedRate(screen.reason)) c = card('excluded', 'none', screeningText(screen.reason));
    else if (screen.reason) c = card('screening', 'you', screeningText(screen.reason), '需要连好大健页面再筛选一次。', 'rescreen', {code: screen.reason});
  }
  if (!c && running) c = card('preparing', 'program', job.state === 'queued' ? '排队等准备' : '正在准备上架资料');
  if (!c && ['failed', 'interrupted'].includes(job.state))
    c = card('preparing', 'you', job.state === 'interrupted' ? '服务器重启，这一段中断了' : '这一段处理失败了',
      '原资料保留，重新检查即可。', 'recheck', {code: job.result?.code || job.state});
  if (!c && job.id) c = card('preparing', 'you', '只读取了报价，还没准备', '', 'prepare');
  if (!c) c = card('queued', 'you', '还没开始', '', null);
  return {sku, name: quote?.name || live?.name || '', jobId: job.id, rootJobId: job.rootJobId || job.id,
    created: job.created || null, quote: quote || null, submission: submission || null, item: item || null,
    asin: c.asin || live?.asin || null, ...c};
}

export function jobCards(job, {site, liveBySku = new Map(), screens = new Map(), skips = new Set()} = {}) {
  const items = new Map((job.result?.pipeline?.items || []).map(x => [x.sku, x]));
  const quotes = new Map((job.result?.products || []).map(x => [x.code, x]));
  const subs = new Map();
  for (const s of (job.submissions || []).flatMap(x => x.items || [])) subs.set(s.sku, s);
  const codes = [...new Set([...(job.codes || []), ...quotes.keys(), ...items.keys()])];
  return codes.map(sku => productCard({sku, job, item: items.get(sku), quote: quotes.get(sku), submission: subs.get(sku),
    screen: screens.get(site + ':' + sku), live: liveBySku.get(sku), skipped: skips.has(site + ':' + sku)}));
}

// Newest record wins when the same SKU appears in several jobs.
export function mergeCards(lists) {
  const best = new Map();
  for (const c of lists.flat()) {
    const prev = best.get(c.sku);
    if (!prev || (c.created || 0) >= (prev.created || 0)) best.set(c.sku, c);
  }
  return [...best.values()];
}

export const TODO_ORDER = Object.freeze([
  ['check_result', '结果待确认', '提交后没收到明确结果，先核对，不要重复提交'],
  ['confirm_submit', '确认提交', '售价和库存已算好；新链接只建零库存，不会接单'],
  ['answer_questions', '回答问题', '供应商资料没写清楚的地方'],
  ['rescreen', '重新筛选', '需要连好大健页面'],
  ['recheck', '重新检查', '不需要补资料，再检查一次即可'],
  ['prepare', '开始准备', '只读取了报价的商品'],
  ['ask_ai', '问 AI', '报告没说清缺什么，先问清楚'],
]);

export function summarize(cards) {
  const owners = Object.fromEntries(OWNER_ORDER.map(k => [k, 0]));
  const stages = Object.fromEntries([...STAGES.map(([k]) => [k, 0]), ['excluded', 0], ['skipped', 0]]);
  for (const c of cards) {
    stages[c.stage] = (stages[c.stage] || 0) + 1;
    if (!['selling', 'excluded', 'skipped'].includes(c.stage)) owners[c.owner] = (owners[c.owner] || 0) + 1;
  }
  const todo = [];
  for (const [action, label, hint] of TODO_ORDER) {
    const items = cards.filter(c => c.owner === 'you' && c.primary === action);
    if (items.length) todo.push({action, label, hint, items});
  }
  return {owners, stages, todo, maintainer: cards.filter(c => c.owner === 'maintainer' && !['excluded', 'skipped'].includes(c.stage)),
    selling: stages.selling};
}

export function sortCards(cards) {
  const rank = c => ['selling', 'excluded', 'skipped'].includes(c.stage) ? 10 + ['selling', 'excluded', 'skipped'].indexOf(c.stage)
    : OWNER_ORDER.indexOf(c.owner);
  return [...cards].sort((a, b) => rank(a) - rank(b) || STAGES.findIndex(s => s[0] === a.stage) - STAGES.findIndex(s => s[0] === b.stage)
    || a.sku.localeCompare(b.sku));
}

export const stageIndex = stage => STAGES.findIndex(s => s[0] === stage);

// What the operator pastes to the maintainer (Codex / Claude).
export function maintainerNote(c, site) {
  return ['EDUPLINK 上架问题', '站点：' + site, 'SKU：' + c.sku, '批次：' + (c.rootJobId || '—'),
    '阶段：' + (STAGE_NAME[c.stage] || c.stage), '现在：' + c.headline, '排查编号：' + (c.code || '—')].join('\n');
}
