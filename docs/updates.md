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

The current stable client is0.8.5, release commit4cfec99afd3084cc3b2dc1c677a3d8e533449fcd.
Windows CI42781395673 passed all gates. Both physical PCs installed the signed patch
from0.8.4 via bootstrap0.6.4, passed hidden packaged renderer and Windows protection
checks, and preserved five identity/business files. Main windows remain closed.
See listing-groups.md for persistent100-SKU archives, queue recovery and30-second CD.
Extension/native0.4.9 is unchanged; full browser background reload remains separate
from the previously verified actual reader20/20 return-rate test.
