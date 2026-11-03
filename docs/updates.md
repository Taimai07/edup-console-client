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
