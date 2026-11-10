# Server resource storage protection

Owners: E2 guards resource writes; D2 refuses new resource jobs and preserves idempotent
readback; D7 exposes live storage status; A5 displays it and stops the local queue.
Existing K1 operations are unchanged: service_status/status, giga_collect/giga_prepare,
giga_job. Errors GIGA_SERVER_STORAGE_LOW and GIGA_SERVER_STORAGE_UNAVAILABLE are passed
unchanged to the client. They are resource holds, not missing product facts.

Reserve is max(2% filesystem total,1GiB) measured against available bytes on actual
resource destinations, including temporary storage. Check before connecting, against
Content-Length when known, and before each1MiB read/write. Convert disk-full/quota errors
to the storage error. Stop only the bounded PDF renderer if space falls while rendering.
Completed originals and business journals are preserved; partial files owned by the
current failed download are cleaned. Checks are not atomic reservations against other
services; the reserve leaves room for bounded concurrency and bookkeeping.

The server does not admit a new resource job while blocked. Existing request IDs remain
queryable. A queued job reaching the guard ends as failed with the explicit storage code;
successful sibling items remain in its result. No background retry or automatic cleanup.
After freeing space the operator explicitly resumes the original work.

The task banner shows storage insufficient and remaining GiB/percentage. New group
execution and resume are blocked while the live status is blocked. A mid-queue resource
failure stops later admissions and preserves the pending queue. Manual recovery skips
successful siblings and retries only unfinished items. Old error receipts alone do not
keep the live storage latch set once service_status reports healthy capacity.

Tests use simulated disk statistics and isolated authenticated RPC, not a full real disk.
Native Electron tests verify the warning and disabled group action without user windows
or supplier/Amazon calls. Deployment and live status receipts are tracked separately.
