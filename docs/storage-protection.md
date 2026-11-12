# Server resource storage protection

The client screens return rates and submits the SKU list with its bound screening
receipt. A successful response means the server durably stored the job, codes and
screening proof. The client marks the segment uploaded and moves to the next one.
An existing stored job is reconciled by its original request ID, including when
backend processing is held or failed.

Server download capacity does not disable upload controls, show a client storage
error banner or cancel the upload queue. Held admissions write only small database
records. A real database write failure must still fail the acknowledgement.

The server retains resource protection before releasing work to the download
pipeline and while writing supplier PDFs/images. The reserve is the larger of
2% of the destination filesystem and 1 GiB. Download holds, errors and capacity
remain server-side operational information. Existing originals and receipts remain.

Tests cover low-space held admission persistence, request idempotence, zero download
launch at intake, completed upload recovery, and enabled controls in a hidden native
Electron renderer under a simulated low-space server status.
