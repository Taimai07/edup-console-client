// Local per-computer records and the 大健 page state judgement used by the listing runner.
// Moved out of listing-runner.js unchanged (client round 1: move only, no behaviour change).
import {archiveGroups} from './listing-groups.js';

export const KEY = {screens: 'edup:listing:screens:v1', skips: 'edup:listing:skips:v1', lists: 'edup:listing:lists:v1', run: 'edup:listing:run:v1',
  pace: 'edup:listing:pace:v2', usage: 'edup:listing:giga-usage:v1', queue: 'edup:listing:queue:v1'};
export const read = (key, fallback) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
export const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* per-viewer convenience only */ } };
const REGION = {US: 'USA', DE: 'DEU', GB: 'GBR', CA: 'CAN', JP: 'JPN'};
export const maintenance = (action, arg) => window.edup.maintenance(action, arg);

// Local, per-computer records the server does not keep yet (spec §7.2 screen_outcomes).
export const local = {
  screens: () => new Map(Object.entries(read(KEY.screens, {}))),
  recordScreens(site, rows) {
    if (!rows.length) return;
    const all = read(KEY.screens, {});
    for (const row of rows) all[site + ':' + row.sku] = {reason: row.reason, at: Date.now()};
    const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 3000);
    write(KEY.screens, Object.fromEntries(kept));
  },
  clearScreens(site, skus) {
    const all = read(KEY.screens, {});
    for (const sku of skus) delete all[site + ':' + sku];
    write(KEY.screens, all);
  },
  skips: () => new Set(read(KEY.skips, [])),
  setSkip(site, sku, on) {
    const all = new Set(read(KEY.skips, []));
    on ? all.add(site + ':' + sku) : all.delete(site + ':' + sku);
    write(KEY.skips, [...all]);
  },
  lists: () => read(KEY.lists, []),
  saveList(list) {
    const all = read(KEY.lists, []).filter(x => x.id !== list.id);
    all.unshift({...list, groups: archiveGroups(list)});
    // Archives must not silently evict older user lists or ignore storage failure.
    localStorage.setItem(KEY.lists, JSON.stringify(all));
  },
  ensureGroups(listId) {
    const all = read(KEY.lists, []), list = all.find(x => x.id === listId);
    if (list && !Array.isArray(list.groups)) {
      list.groups = archiveGroups(list);
      localStorage.setItem(KEY.lists, JSON.stringify(all));
    }
    return list;
  },
  // Remembers whether the server has a copy of this list (sku_list_save), so a failed backup is
  // still visible after the app restarts.
  setBackup(listId, patch) {
    const all = read(KEY.lists, []);
    const list = all.find(x => x.id === listId);
    if (list) { Object.assign(list, patch); write(KEY.lists, all); }
  },
  addJob(listId, jobId) {
    const all = read(KEY.lists, []);
    const list = all.find(x => x.id === listId);
    if (list && !list.jobs.includes(jobId)) { list.jobs.push(jobId); write(KEY.lists, all); }
  },
};

// The one judgement of "is the 大健 page usable for this site" (spec §6.1).
export function browserState(status, site, busy = false) {
  if (!window.edup?.maintenance) return {key: 'desktop', ok: false, label: '需要桌面客户端', tone: 'grey'};
  if (!status || status.code === 'GIGA_BROWSER_SETUP_REQUIRED') return {key: 'setup', ok: false, label: '未设置', tone: 'grey'};
  if (busy) return {key: 'busy', ok: true, label: '正在执行大健任务', tone: 'blue'};
  if (!status.connected) return {key: 'offline', ok: false, label: '未连接', tone: 'red'};
  if (status.extensionProtocol !== 4) return {key: 'update', ok: false, label: '需要更新扩展', tone: 'amber'};
  const ins = status.inspection || {};
  if (ins.loggedIn !== true || ins.buyer !== true) return {key: 'login', ok: false, label: '没登录买家账号', tone: 'amber'};
  if (REGION[site] && ins.countryCode !== REGION[site])
    return {key: 'region', ok: false, label: '地区不符（当前是 ' + (ins.countryCode || '未知') + '）', tone: 'amber'};
  return {key: 'ok', ok: true, label: '已连接 · ' + (ins.countryCode || site) + ' 买家账号', tone: 'green', wide: status.accountScopeV2 === true};
}
