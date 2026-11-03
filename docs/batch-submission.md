# Batch submission

Maintainer: Codex. This is the client contract, not private deployment configuration.

The user reviews a fixed list of eligible products with their prices and quantities,
then confirms once. Ineligible products stay visible with their own explanation.
Preparing a quote cannot publish. The model cannot confirm its own proposal.

The server persists the confirmed selection before reporting it as queued. Closing
the window does not cancel the task. Each product is checked and processed separately;
one product needing correction does not block the others. Price, facts or inventory
changes hold the affected item rather than silently expanding the confirmed action.

Rows distinguish queued, checking, submitting, accepted, rejected and unresolved.
Accepted does not mean all product attributes, media or buyability are verified.
An uncertain submission must be read back before another attempt, including after
a service restart. Repeated clicks and reconnects must not duplicate publication.

Root batch identity and the original product list remain stable. Child preparation
results merge by product code. Status polling must preserve material input and
ignore an old response after a history selection changes. Currency belongs in
the price header; quantity zero is an explicit listing intent, not missing data.

Acceptance includes the actual paired desktop-to-server proposal path, complete
root rows after opening a single product, and the visible batch confirmation list.
Queue fault tests use isolated adapters; real publication requires its own authorized
business acceptance. A successful HTTP-only page test is insufficient.
