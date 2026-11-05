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

Current account/market publication receipts are merged across batches. Accepted or unresolved submissions take precedence over historical preparation failures and cannot re-enter new-listing preparation. Reports retain their original evidence and identify newer submission state; batch chat shows current status alongside historical answers.

Root batch identity and the original product list remain stable. Child preparation
results merge by product code. Status polling must preserve material input and
ignore an old response after a history selection changes. Currency belongs in
the price header; quantity zero is an explicit listing intent, not missing data.

Acceptance includes the actual paired desktop-to-server proposal path, complete
root rows after opening a single product, and the visible batch confirmation list.
Queue fault tests use isolated adapters; real publication requires its own authorized
business acceptance. A successful HTTP-only page test is insufficient.


## Continuing an existing batch
Select a saved batch and continue its checks without re-entering product codes. A complete
unchanged reviewed result can reuse its facts, media, copy and review while current quotes,
stock, source bytes and preview are checked. Partial stages use compatible completed request
receipts; uncertain requests are never silently replayed. Changes invalidate the affected work.
A failed continuation preserves earlier results, shows the failed attempt and requires recheck
before submission. Overlapping work for the same product joins its existing task rather than
launching another preparation. Accepted or unresolved publication stays readback-only.

Problem cards explain what is unresolved, why and the next action. Unknown report content
is not automatically treated as missing product facts. Material editing remains bound to
the batch and product; saving material, confirming a fact and confirming publication are
separate actions. Clicking submit does not start paid preparation.
