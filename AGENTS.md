# EDUPLINK architecture entry

Maintainer: Codex, primary project maintainer.
Claude and other collaborators propose annotated changes; maintainer merges them.
Unresolved review comments: none recorded.

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
Only US listing execution has passed acceptance; do not silently route other sites.
Silent target-app upgrades are authorized; no mouse/keyboard/screenshots/focus control.

## Read when relevant
- docs/client.md: renderer loading, IPC, health and submission availability.
- docs/updates.md: signed full application patches, skipped versions and recovery.
- docs/private-services.md: private deployment boundaries and acceptance sources.
Update current intent/state in these documents after changes; do not append a diary.

