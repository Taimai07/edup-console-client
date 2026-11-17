// Browser-read pacing policy and local usage history. Moved out of listing-runner.js unchanged.
import {KEY, read, write} from './listing-local.js';

// Owner policy: 30-second CD, no client hour/day quotas. v2 deliberately does not inherit
// old v1 quotas. Verification and site errors still pause/back off; ID navigation is no
// guarantee against supplier throttling. Usage history and recovery journals remain intact.
export const PACE_DEFAULTS = Object.freeze({
  restMinutes: 0.5,     // 30 seconds between browser dispatches
  hourly: 0,           // no client hourly quota; site responses still govern retries
  daily: 0,            // no client daily quota
  resumeHour: 9,        // when the daily allowance is used up, carry on the next day from 9:00
});
export function pace() {
  const saved = read(KEY.pace, {});
  const out = {...PACE_DEFAULTS};
  for (const key of Object.keys(out)) if (Number.isFinite(saved?.[key]) && saved[key] >= 0) out[key] = saved[key];
  return out;
}
const dayOf = ms => { const d = new Date(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
const DAILY_RESUME = 'edup:listing:giga-daily-resume:v1';
export const usage = {
  rows: () => read(KEY.usage, []).filter(row => row && Number.isFinite(row.at) && Number.isFinite(row.n)),
  record(site, n, now = Date.now()) {
    const rows = usage.rows().filter(row => now - row.at < 36 * 3600e3);
    rows.push({site, n, at: now});
    write(KEY.usage, rows);
  },
  available(site, now = Date.now(), p = pace()) {
    const rows = usage.rows().filter(row => row.site === site);
    const day = rows.filter(row => dayOf(row.at) === dayOf(now)).reduce((sum, row) => sum + row.n, 0);
    const hour = rows.filter(row => now - row.at < 3600e3).reduce((sum, row) => sum + row.n, 0);
    return Math.max(0, Math.floor(Math.min(p.daily ? p.daily - day : Infinity, p.hourly ? p.hourly - hour : Infinity)));
  },
  // How long to wait before `n` more SKUs may be read for `site`, and why. 0 = go now.
  wait(site, n, now = Date.now(), p = pace()) {
    const rows = usage.rows().filter(row => row.site === site);
    const today = dayOf(now);
    const day = rows.filter(row => dayOf(row.at) === today).reduce((sum, row) => sum + row.n, 0);
    const resumes = read(DAILY_RESUME, {}), resume = resumes[site];
    if (p.daily && resume?.limit === p.daily && Number.isFinite(resume.until) && now < resume.until &&
        resume.day !== today && rows.some(row => dayOf(row.at) === resume.day)) {
      return {ms: resume.until - now, why: 'daily', day, remaining: Math.max(0, p.daily - day), resumeHeld: true};
    }
    if (p.daily && day + n > p.daily) {
      const next = new Date(now); next.setDate(next.getDate() + 1); next.setHours(p.resumeHour, 0, 0, 0);
      resumes[site] = {day: today, until: next.getTime(), limit: p.daily};
      write(DAILY_RESUME, resumes);
      return {ms: next.getTime() - now, why: 'daily', day, remaining: Math.max(0, p.daily - day)};
    }
    const hour = rows.filter(row => now - row.at < 3600e3).sort((a, b) => a.at - b.at);
    const hourUsed = hour.reduce((sum, row) => sum + row.n, 0);
    let used = hourUsed, until = now;
    for (const row of hour) {
      if (!p.hourly || used === 0 || used + n <= p.hourly) break;
      used -= row.n; until = row.at + 3600e3;
    }
    const last = rows.reduce((max, row) => Math.max(max, row.at), 0);
    const rest = last ? last + p.restMinutes * 60e3 : 0;
    const at = Math.max(until, rest);
    return at > now ? {ms: at - now, why: until >= rest ? 'hourly' : 'rest', day, hour: hourUsed,
      remaining: p.hourly ? Math.max(0, p.hourly - hourUsed) : null} : {ms: 0, day};
  },
};
