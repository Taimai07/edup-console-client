// The listing runner: hands one screened segment to the server (safe to repeat with the same request id).
// Split out of listing-runner.js unchanged (client round 3); the module state the runner shares is `rs` in listing-runner-state.js.
import {TRANSIENT, codeOf, unknownOutcome, stopped} from './listing-runner-io.js';
import {rs} from './listing-runner-state.js';
import {pause} from './listing-runner-screen.js';

// Hands one screened segment to the server. The same request id is safe to send again: the
// server returns the job it already made for it, so unknown outcomes and busy hours are retried.
async function admit(op, site, receipt, requestId, parentJobId, update, previouslyUncertain = false) {
  const accepted = new Set(receipt.codes);
  const browserScreen = {id: receipt.screenId, site, items: receipt.items.filter(row => accepted.has(row.sku)),
    ...(receipt.buyerHash ? {buyerHash: receipt.buyerHash} : {})};
  const deadline = Date.now() + 45 * 60 * 1000;
  let tries = 0;
  let uncertain = previouslyUncertain;
  for (;;) {
    try {
      const job = await window.edup.ai(op, {codes: receipt.codes, requestId, site,
        ...(op === 'giga_prepare' ? {browserScreen} : {}), ...(parentJobId ? {parentJobId} : {})});
      if (!job?.id) throw Error('GIGA_ADMISSION_RECEIPT_INVALID');
      return job;
    } catch (error) {
      const unknown = unknownOutcome(error), text = String(error?.message || '');
      uncertain ||= unknown;
      if (!uncertain && text.includes('GIGA_RETURN_SCREEN_REQUIRED')) throw Object.assign(error, {screenRequired: true});
      if (!(unknown || TRANSIENT.test(text)) || Date.now() >= deadline || rs.stopRequested) throw Object.assign(error, {admitUnknown: uncertain});
      const busy = text.includes('GIGA_QUERY_RATE_LIMIT');
      update(busy ? '服务器本小时处理名额用完了，1 分钟后自动再交' : '没确认服务器是否收到（' + codeOf(error) + '），用同一个编号自动再交');
      await pause(busy ? 60e3 : Math.min(60e3, 10e3 * ++tries));
      if (rs.stopRequested) throw Object.assign(stopped(), {admitUnknown: uncertain});
    }
  }
}

export {admit};
