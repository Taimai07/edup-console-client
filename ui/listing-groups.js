// Persistent user-selected archives, independent of transport segments.
export const GROUP_SIZE = 100;
export function archiveGroups(list) {
  if (Array.isArray(list.groups)) return list.groups;
  const codes = [...new Set(list.codes)];
  const total = Math.ceil(codes.length / GROUP_SIZE);
  return Array.from({length: total}, (_, index) => ({
    id: list.id + ':group:' + (index + 1), index: index + 1,
    label: '第 ' + (index + 1) + ' 组', codes: codes.slice(index * GROUP_SIZE, (index + 1) * GROUP_SIZE),
  }));
}

export function groupTask(list, group) {
  if (!archiveGroups(list).some(g => g.id === group.id && JSON.stringify(g.codes) === JSON.stringify(group.codes)))
    throw Error('LISTING_GROUP_SCOPE_INVALID');
  return {kind: list.kind || 'prepare', site: list.site, codes: [...group.codes],
    listId: list.id, groupId: group.id, journalCodes: list.journalCodes || list.codes,
    label: (list.label || '清单') + ' · ' + group.label};
}

export function restoredArchive(result) {
  const codes = result.items.map(row => row.sku);
  if (!result.id || codes.length !== result.total || new Set(codes).size !== codes.length)
    throw Error('SKU_LIST_RECEIPT_INVALID');
  const list = {id: result.id, backupId: result.id, backup: 'saved', site: result.site,
    source: result.source, store: result.store, label: result.label || '服务器清单',
    created: result.savedAt, codes, kind: 'prepare',
    jobs: [...new Set(result.items.map(row => row.preparation?.rootJobId || row.preparation?.jobId).filter(Boolean))]};
  return {...list, groups: archiveGroups(list)};
}
