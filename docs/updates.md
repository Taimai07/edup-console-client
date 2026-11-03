# Updates and recovery

Maintainer: Codex. No unresolved collaborator comments.

Application patches contain the complete application payload, not a delta against
the immediately previous client. Compatible bootstrap/runtime installations can
skip versions. Older or incompatible bootstrap/runtime installations use the signed
full installer. Do not replace a previously published version's immutable assets.

The installed bootstrap verifies the signed envelope, payload hash, allowed paths
and version, then stages a separate slot. Activation records previous/pending slots.
A working renderer must acknowledge health; a failed first boot must preserve the
previous usable version and all business files. A self-check must not bless a patch
without exercising the same desktop resource and renderer path.

Acceptance covers a clean install, compatible skipped-version upgrade, unsupported
bootstrap fallback, offline launch, missing renderer dependency, rollback and data
preservation. An actual second household PC is a separate acceptance surface from
two simulated profiles. Server request records can show its version/connectivity,
but cannot prove its window renders correctly.

The current locally accepted client is 0.7.11. The startup repair was validated by
direct migration from official 0.7.4 and 0.7.7 payloads using separate synthetic
profiles; subsequent signed patches preserve that bootstrap and renderer check.
Local packaged installation reports renderer readiness and preserved state.
These results do not certify the second physical computer's display or network.
If a broken older UI cannot reach its update page, the signed full installer
provides an independent repair route; it preserves the product's user-data folder.
