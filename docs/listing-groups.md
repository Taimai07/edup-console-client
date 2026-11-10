# Saved SKU groups and execution pacing

Maintainer: Codex. Owner: A5.1 listing workspace and its local list/runner store.
Uses existing D2 sku_list_save/status/index contracts; no new API or database table.

Imports are saved before any execution. Each list retains immutable original membership,
source, server backup ID and jobs, plus stable groups of at most 100 SKUs. 1952 SKUs
produce 20 groups (19x100+52). Group selection chooses independent saved scopes;
browser/network requests remain smaller transport segments, not user archive groups.

Legacy lists acquire group metadata without changing list IDs, memberships, job links
or original journal scope. A legacy uncertain segment crossing a chosen group boundary
must be reconciled whole; never split/rekey an uncertain request. Group viewing filters
the product table and action selection, including after a background refresh.

The whole list remains backed up through D2. Another PC can restore that immutable list
as 100-SKU groups via the server backup panel. Existing job owners are retained; before
executing a backed-up group the UI refreshes server status and admits only not_started
or screened items. Items with an existing preparation/submission require their existing
per-item continuation, not another independent prepare call. Archive storage failure is
reported before dispatch; old archives are never silently dropped at a count limit.

Runner queue owner is A5.1. States remain queued/running/need/paused/error/done;
persist active task before dequeuing it, and persist remaining selections. Restart does
not auto-execute: explicit resume combines active and queued tasks and deduplicates.
Pause/cancel stops later groups too. Clearing the pending queue keeps archives and
request journals. done means handed to the server, not successful listing/publication.

Owner-approved pacing: 30 seconds between browser dispatches, no client hour/day quota.
pace:v2 intentionally does not inherit old pace:v1 defaults or overrides. Usage records
are retained; old daily resume gates are inactive while daily=0. Verification, login,
region, supplier throttling/backoff and unknown-write reconciliation remain unchanged.
Direct product IDs do not guarantee the absence of supplier verification.

Regression coverage: stable grouping/restoration, no archive eviction, failed persistence,
legacy quota isolation, selected groups 1+3 across pause/restart, original request recovery,
and an isolated nonfocusable Electron renderer exercising real UI selection/filtering.
No real supplier or Amazon writes are performed by these tests.
