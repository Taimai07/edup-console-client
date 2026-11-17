// Helpers of the listing runner that hold no run state: error codes, retry tables, receipt
// polling and server job reads. Moved out of listing-runner.js unchanged.
import {maintenance} from './listing-local.js';
import {storageCode} from '../common/storage-state.js';

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// 11-09: a list of 2000+ codes stopped for good at the first browser hiccup and each segment waited
// for the server before the browser started the next one. Now every step retries on its own, a
// segment that still fails is set aside while the rest go on, and the browser works on the next
// segment while the server prepares the previous one (still one server job at a time).
export const BROWSER_WAITS = [60e3, 3 * 60e3, 10 * 60e3];
export const CONNECTION = ['GIGA_BROWSER_NOT_CONNECTED', 'GIGA_BROWSER_REGION_MISMATCH', 'GIGA_BROWSER_UPDATE_REQUIRED', 'GIGA_BROWSER_SETUP_REQUIRED'];
export const TRANSIENT = /GIGA_QUERY_RATE_LIMIT|AI_SERVICE_NOT_CONNECTED|AI_SERVICE_TIMEOUT|AI_SERVICE_FAILED|AI_REQUEST_FAILED|AI_SERVICE_RESPONSE_INVALID|OPERATIONS_REQUEST_FAILED|NETWORK_BUSY|HTTP_5\d\d|RESPONSE_TOO_LARGE|ETIMEDOUT|ECONNRESET|fetch failed/;
export const codeOf = error => (String(error?.message || error || '').match(/\b[A-Z][A-Z0-9_]{3,}\b/) || ['REQUEST_FAILED'])[0];
export const unknownOutcome = error => error?.outcome === 'unknown' || String(error?.message || '').includes('OUTCOME_UNKNOWN');
export const stopped = () => Object.assign(Error('LISTING_RUN_STOPPED'), {stopped: true});
export const VERIFY = ['GIGA_VERIFICATION_REQUIRED', 'GIGA_RESPONSE_INVALID', 'GIGA_DETAIL_REVIEW_REQUIRED'];
export const minutes = ms => Math.max(1, Math.ceil(ms / 60e3));
export const duration = ms => ms < 60e3 ? Math.ceil(ms / 1000) + ' 秒' : minutes(ms) + ' 分钟';
export const clock = ms => { const d = new Date(Date.now() + ms); return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };

export function desktopNotice(title, body) {
  try { if (typeof Notification === 'function') new Notification(title, {body}); } catch { /* best effort */ }
}

// Best effort: why a run waited or set a segment aside reaches the diagnostics upload, so the
// server can see where a list stopped. Older desktops without the action simply ignore it.
export function note(event) {
  try { Promise.resolve(window.edup?.maintenance?.('listing-event', event)).catch(() => {}); } catch { /* ignore */ }
}

export async function checkFavorites(task, update) {
  let excluded = [], deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const receipt = await maintenance('giga-browser-task', {id: task.id});
    if (receipt.state === 'rates_read') {
      const screening = await maintenance('giga-browser-screen', {id: task.id});
      const rates = new Map(receipt.items.map(row => [row.sku, row.reason || row.state]));
      excluded = screening.excluded.map(row => ({...row, rate: rates.get(row.sku)}));
      if (!screening.task) return {codes: [], items: [], excluded};
      task = screening.task;
      deadline = Date.now() + 30 * 60 * 1000;
      update('正在收藏通过筛选的商品');
    } else if (receipt.state === 'verified') {
      return {...receipt, excluded: [...excluded, ...(receipt.excluded || [])]};
    } else if (receipt.state === 'stopped') {
      throw Error(receipt.code);
    } else if (receipt.state === 'running_in_browser') {
      const stages = {starting: '开始核对', session: '核对买家账号', search: '搜索商品编号',
        list: '核对商品列表', detail: '读取商品退货率', favorite: '核对收藏'};
      const p = receipt.progress;
      const label = stages[p?.stage] || '等待浏览器返回结果';
      const count = Number.isInteger(p?.index) && Number.isInteger(p?.total) && p.index > 0 && p.index <= p.total
        ? ' · 第 ' + p.index + '/' + p.total + ' 款' : '';
      const elapsed = Number.isFinite(receipt.elapsedSeconds) ? ' · 已用 ' + Math.floor(receipt.elapsedSeconds / 60) + ' 分钟' : '';
      update(label + count + elapsed);
    }
    await wait(2000);
  }
  throw Error('GIGA_BROWSER_RECEIPT_UNKNOWN');
}

// Reads a job, riding out short network trouble. null means the server never made it.
export async function readJob(id) {
  for (let failures = 0; ; failures++) {
    try { return await window.edup.ai('giga_job', {id}); }
    catch (error) {
      if (codeOf(error) === 'JOB_NOT_FOUND') return null;
      if (failures >= 20) throw error;
      await wait(Math.min(60e3, 5e3 * (failures + 1)));
    }
  }
}

export async function waitJob(id, update) {
  for (;;) {
    const job = await readJob(id);
    const blocked = storageCode(job);
    if (blocked) throw Error(blocked);
    if (!job || !['queued', 'running'].includes(job.state)) return job;
    update('服务器还在处理上一段（一次一段，防止服务器过载），这一段筛完后再上传');
    await wait(5000);
  }
}
