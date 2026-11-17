// Constants and checks shared by the listing sheets. Moved out of listing-sheets.js unchanged (client round 1).

export const SITE_NAME = {US: '美国', DE: '德国', GB: '英国', CA: '加拿大', JP: '日本'};
export const isUnknown = e => e?.outcome === 'unknown' || String(e?.message || '').includes('OUTCOME_UNKNOWN');
