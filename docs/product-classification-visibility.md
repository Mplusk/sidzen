# Administrative product classification

TN VED and OKPD 2 fields are retained in the product specifications JSON and
protected administrator editor, but omitted from customer specification rows.
The same rows feed both the product overview and full specification table.
Filtering happens on the server, not through CSS. Raw specifications are not
passed to the public gallery/purchase components or Product JSON-LD.

Labels are normalized for case, NFKC, punctuation and spacing, covering Russian
and Latin importer/manual variants, including legacy `ОКПД` labels. No database
rewrite or deletion is required. Other customer properties remain unchanged.

Wildberries import retains its original named fields. Ozon import and legacy
attribute repair retain TN VED attribute 22232 for the editor rather than
discarding it. Fields discarded by historical imports are not guessed or
backfilled; a subsequent explicitly requested synchronization can import them.

`product-specifications.test.ts` checks visibility and non-mutating filtering.
`ozon-attributes.test.ts` checks preservation on import/repair.
`smoke-product-card-http.ts` checks public HTML/RSC for guests and signed-in
administrators, protected editor visibility, and unchanged stored values using
synthetic data in the isolated local QA database. This test also runs in CI.
