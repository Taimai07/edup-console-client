# EDUPLINK architecture entry

Maintainer: Codex, primary project maintainer.
Claude and other collaborators propose annotated changes; maintainer merges them.
Unresolved review comments: the independent review findings for saved-batch recovery have been addressed with targeted regression checks.

## Purpose and structure
Personal Windows operations client. The desktop presents business data and approved
actions; remote services own business credentials, data, preparation and inference.
The public client repository must not contain private service configuration or data.

- desktop/: isolated Electron host, device signing, proxy, updates and diagnostics.
- ui/: shared views; loaded through the desktop edup protocol or development HTTP.
- shared/: contracts and validation shared by the host and tests.
- scripts/ and test/: release packaging, signature and upgrade acceptance.
- private-backend/: local private source; excluded from public export.

## Current state and rules
0.8.5 adds saved100-SKU archive groups and30-second browser CD without client hourly/daily quotas.
Group selection and restart recovery use existing list and request owners; see docs/listing-groups.md.
0.8.5 signed patch installation and hidden self-check passed on both physical PCs; five data files preserved.
The client uses one desktop asset handler and real renderer readiness.
Native offline, skipped-version and missing-dependency rollback checks pass.
Release/install acceptance must be verified separately on each real device.
Native installation and live-data renderer checks are required for release.
Direct migrations from prior signed slots are covered by isolated profiles;
the second physical PC still needs its own post-update confirmation.
Do not interpret an HTML load event or file existence as a working renderer.
User data, device identity and logs must survive updates and rollback.
Clients contact the configured private service; no seller/model credentials in UI.
Actual selling changes require the existing bound confirmation flow.
Existing batches can continue from their saved product list without retyping codes.
Effective reviewed results are reusable; changed facts and current validation remain explicit.
A failed retry preserves prior results and shows the latest attempt separately.
The submission action cannot silently start paid preparation.
Only US listing execution has passed acceptance; do not silently route other sites.
Silent target-app upgrades are authorized; no mouse/keyboard/screenshots/focus control.

## Read when relevant
- docs/listing-groups.md: saved group membership, queue recovery and pacing changes.
- docs/giga-browser.md: region-account check and favorites before new product intake.
- docs/client.md: renderer loading, IPC, health and submission availability.
- docs/updates.md: signed full application patches, skipped versions and recovery.
- docs/private-services.md: private deployment boundaries and acceptance sources.
- docs/batch-submission.md: fixed batch selection, asynchronous submission and per-item results.
Update current intent/state in these documents after changes; do not append a diary.
