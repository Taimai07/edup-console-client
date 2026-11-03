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

