// The listing runner: keeping within the page-read allowance, waiting for the 大健 page or a human check, and screening one segment.
// Split out of listing-runner.js unchanged (client round 3); the module state the runner shares is `rs` in listing-runner-state.js.
import {reconcileGigaFavorites} from '../giga/giga-browser.js';
import {maintenance, browserState} from './listing-local.js';
import {pace, usage} from './listing-pace.js';
import {wait, BROWSER_WAITS, CONNECTION, VERIFY, codeOf, stopped, minutes, duration, clock, desktopNotice, note, checkFavorites} from './listing-runner-io.js';
import {rs, emit} from './listing-runner-state.js';

// Keeps the 大健 page reads within the allowance. Waiting can be paused like any other wait.
async function throttle(site, n, update) {
  for (;;) {
    if (rs.stopRequested) throw stopped();
    const p = pace();
    if ((p.daily && n > p.daily) || (p.hourly && n > p.hourly)) throw Error('LISTING_PACE_SEGMENT_TOO_LARGE');
    const w = usage.wait(site, n, Date.now(), p);
    if (!w.ms) return;
    const text = w.why === 'daily' ? (w.resumeHeld ? '按每日额度恢复时间等待' : '今日已安排读取 ' + w.day + '/' + p.daily + ' 款次（含重试），剩余 ' + w.remaining + '；本段需要 ' + n + ' 款')
        + '，' + clock(w.ms) + ' 自动继续（软件要开着）'
      : w.why === 'hourly' ? '本小时已安排读取 ' + w.hour + '/' + p.hourly + ' 款次（含重试），剩余 ' + w.remaining + '；本段需要 ' + n + ' 款，' + minutes(w.ms) + ' 分钟后自动继续'
      : '按节奏休息，' + duration(w.ms) + '后继续读取（今日已安排读取 ' + w.day + ' 款次，含重试）';
    update(text);
    await pause(Math.min(w.ms, 60e3));
  }
}

// GIGA wants a human on the page (slider puzzle). No automatic retries here: requests from a
// session under verification only make it worse. 继续 tries again, 取消 ends the run.
async function waitForVerification(code, count) {
  note({code, step: 'verification'});
  const detail = code === 'GIGA_DETAIL_REVIEW_REQUIRED';
  const text = detail ? '商品详情页未能核实，' + count + ' 款已暂停。请检查大健页面是否有验证、登录或商品异常提示，处理后点继续。'
    : '大健要求人工验证，' + count + ' 款暂停。请在大健页面随便搜一个商品，按提示完成拼图验证，然后点「已完成验证，继续」。';
  desktopNotice(detail ? 'EDUPLINK：请检查大健商品页面' : 'EDUPLINK：大健要求人工验证', text);
  emit({phase: 'need', need: detail ? 'detail' : 'verify', message: text});
  const go = await new Promise(resolve => { rs.resumeSignal = resolve; });
  rs.resumeSignal = null;
  if (go === false) throw Object.assign(Error('LISTING_RUN_CANCELLED'), {cancelled: true});
  if (rs.stopRequested) throw stopped();
  emit({phase: 'running', need: null, message: '已确认验证完成，继续'});
}

// Waits that end early when the operator asks to pause.
async function pause(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end && !rs.stopRequested) await wait(Math.min(1000, end - Date.now()));
}

// The 大健 page has to be usable. Instead of stopping, keep checking every 10 s and carry on by
// itself once it is; 继续 just checks at once, 取消 ends the run.
async function waitForBrowser(site, count) {
  let asked = false;
  for (;;) {
    const status = await maintenance('giga-browser-status').catch(() => null);
    const b = browserState(status, site);
    if (b.ok) {
      if (asked) emit({phase: 'running', need: null, message: '大健页面已连好，继续'});
      return status;
    }
    if (!asked) { asked = true; note({code: 'GIGA_BROWSER_' + b.key.toUpperCase(), step: 'browser'}); }
    emit({phase: 'need', need: 'browser', message: '有 ' + count + ' 款要在大健页面处理。请连好大健页面（' + b.label + '），连好后会自动继续。'});
    const go = await new Promise(resolve => { rs.resumeSignal = resolve; setTimeout(() => resolve('check'), 10000); });
    rs.resumeSignal = null;
    if (go === false) throw Object.assign(Error('LISTING_RUN_CANCELLED'), {cancelled: true});
    if (rs.stopRequested) throw stopped();
  }
}

// Reads rates, records the screening and favorites one segment, recovering by itself: waits for
// the page, closes out a task left unfinished last time, and retries with growing pauses.
async function screenSegment(codes, site, update) {
  let attempt = 0, expiryWaits = 0;
  for (;;) {
    if (rs.stopRequested) throw stopped();
    try {
      await throttle(site, codes.length, update);
      update('正在大健页面逐款读取退货率（' + codes.length + ' 款）');
      const started = await maintenance('giga-browser-start', {site, codes});
      usage.record(site, codes.length);
      const receipt = await checkFavorites(started, update);
      if (receipt.codes.length && (receipt.site !== site || receipt.codes.some(sku => !codes.includes(sku))))
        throw Error('GIGA_BROWSER_RECEIPT_SCOPE_MISMATCH');
      return receipt;
    } catch (error) {
      if (error.cancelled || error.stopped) throw error;
      const code = codeOf(error);
      if (code === 'LISTING_PACE_SEGMENT_TOO_LARGE') throw error;
      if (CONNECTION.includes(code)) { await waitForBrowser(site, codes.length); continue; }
      if (VERIFY.includes(code)) { await waitForVerification(code, codes.length); continue; }
      if (code === 'GIGA_BROWSER_TASK_REQUIRES_RECONCILIATION') {
        try {
          update('上次的大健收藏没收尾，正在自动核对');
          await reconcileGigaFavorites(undefined, () => !rs.stopRequested, update);
          continue;
        } catch (reconcileError) {
          // A read task from last time is still open; it expires within 30 minutes.
          if (codeOf(reconcileError) === 'GIGA_FAVORITE_RECONCILIATION_NOT_REQUIRED' && expiryWaits++ < 35) {
            update('上一个大健读取任务还没结束，1 分钟后再试（最多等它 30 分钟过期）');
            await pause(60e3);
            continue;
          }
        }
      }
      if (attempt >= BROWSER_WAITS.length) throw error;
      const ms = BROWSER_WAITS[attempt++];
      note({code, step: 'browser', attempt});
      update('大健页面这一步没成功（' + code + '），' + ms / 60e3 + ' 分钟后自动重试（第 ' + attempt + '/' + BROWSER_WAITS.length + ' 次）');
      await pause(ms);
    }
  }
}

export {throttle, pause, screenSegment, waitForBrowser, reconcileGigaFavorites};
