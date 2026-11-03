# Client loading and startup

Maintainer: Codex. No unresolved collaborator comments.

The UI is shared, but production uses edup://console through Electron's protocol
handler. HTTP-browser testing alone cannot establish desktop loadability.
All imported scripts, CSS and iframe assets must be reachable through that handler.
The host must fail closed for unknown paths and never expose arbitrary local files.

Renderer readiness means JavaScript initialized, navigation exists and either live
data, a usable cache, or an actionable offline/settings view is rendered. Network
availability must not be a prerequisite for opening settings or updating the app.
Health acknowledgement belongs after this readiness signal, not did-finish-load.
The self-check now opens a hidden renderer in its own temporary browser session,
using the production protocol handler and the real application module graph.
It verifies initialized navigation and an actionable offline view before accepting
health. Missing dependencies are startup failures even if HTML loaded successfully.

The AI iframe is isolated and communicates through the existing bounded bridge.
Business reports use safe text/DOM rendering. Raw diagnostics remain in maintenance.
Never fix a load failure by disabling Electron sandboxing or opening arbitrary paths.

## Submission availability
Site discovery is a read-only business operation in the shared desktop/server
contract. A successful private-server call does not prove the desktop permits it.
The UI contract regression check and native signed-client acceptance cover this.

Product readiness, selected-site availability and live business connectivity are
separate conditions. If a ready row is disabled, explain the blocking condition
beside that row. Do not let an old dashboard-cache failure silently disable a
currently reachable business flow. A retry must refresh site discovery too.
Single-item submission requests a bound proposal before final confirmation.
Batch submission displays a fixed price/quantity list before one confirmation;
the private server persists and processes it independently of the window lifetime.
Keep the root batch selected when a child is refreshed. Merge child status into
the original rows; never replace a multi-item list with one item's preparation job.
Discard stale responses after the user selects another batch. See batch-submission.md.
