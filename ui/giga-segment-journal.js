// Persist scoped request IDs before admission so a closed view cannot lose them.
export async function openSegmentJournal(storage, scope) {
  const serial = JSON.stringify([scope.site, scope.operation, scope.parent || '', scope.codes]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serial));
  const key = 'edup:giga-segments:v1:' + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2,'0')).join('');
  const prior = storage.getItem(key);
  const records = prior ? JSON.parse(prior) : {};
  if (!records || typeof records !== 'object' || Array.isArray(records)) throw Error('GIGA_SEGMENT_JOURNAL_INVALID');

  function write(segment, record) {
    const next = {...records,[segment]:record};
    storage.setItem(key, JSON.stringify(next));
    records[segment]=record;
  }

  return {
    entries: () => Object.entries(records),
    reserve(segment, codes) {
      const previous=records[segment];
      if (previous && JSON.stringify(previous.codes)!==JSON.stringify(codes)) throw Error('GIGA_SEGMENT_JOURNAL_CONFLICT');
      if (previous && !['failed','interrupted','not_admitted'].includes(previous.state)) return previous.requestId;
      const requestId=crypto.randomUUID();
      const history=previous?[...(previous.history||[]),previous.requestId]:[];
      write(segment,{codes,requestId,state:'admitting',history});
      return requestId;
    },
    seen(segment, job) {
      const previous=records[segment];
      if (!previous || typeof job?.id!=='string') throw Error('GIGA_SEGMENT_JOURNAL_CONFLICT');
      write(segment,{...previous,jobId:job.id,state:job.state});
    },
  };
}
