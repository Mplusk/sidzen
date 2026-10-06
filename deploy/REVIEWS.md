# Verified purchase reviews

Public product pages show approved reviews, rating and photo thumbnails. The
average and JSON-LD use **all** published reviews, not just the current page.
Reviews paginate by 10. Existing reviews are preserved by an additive migration;
they are not marked as verified purchases retrospectively.

## Buyer

`/account/reviews/` lists eligible products and the buyer's own reviews. A review
can also be submitted from the product page. Eligibility is checked on the
server twice: account-owned order, DELIVERED, payment PAID, no ambiguous refund,
and a positive-quantity line for the exact product. Guest purchases are not
claimed by matching email. Register/login before buying for this capability.
One review per account/product; concurrent submissions cannot create duplicates.
Ratings 1–5 and text 10–3000 characters. The public pseudonym is deliberately
separate from the account name. Deleting requires confirmation and ownership.

## Moderation

`/account/review-moderation/` requires `content.write` or superadmin. The account
navigation exposes it to these roles. New reviews wait for approval. Admins can
publish or hide, but cannot rewrite the customer's text/rating. Low ratings are
not a reason for rejection. Decisions enter AuditLog without review contents.

## Photos and publication permission

Up to five JPG/PNG/WebP photos, 5 MB each, 24 million input pixels maximum.
Images are actually decoded and re-encoded as WebP up to 1600 px; original
EXIF/GPS/XMP is discarded. Animation and disguised SVG are rejected. Files use
random names under `private-uploads/reviews`, in the existing persistent
`model-files` volume already included in server backups. They are not public
static files. The photo route checks publication/consent or owner/staff access,
returns no-store, and becomes inaccessible after deletion or withdrawal.
The worker removes orphan UUID WebPs older than 24 hours after crashes or
product deletion; it never touches model uploads or referenced photos.

The separate, initially unchecked publication consent has its own immutable
version and operator snapshot. Deletion revokes it. A general withdrawal in
`/account/privacy/` immediately unpublishes verified reviews and revokes their
consents; admins cannot republish them. Export includes the owner's reviews.
Operator privacy configuration/localization gates submission. This technical
implementation does not replace the operator's legal/organizational duties.

## Verification

Unit tests cover authorization, purchase matching, races/rollback, low ratings,
consent, withdrawal, files/metadata, pagination and export isolation.
`scripts/smoke-reviews-http.ts` runs only against disposable local `shop_qa` and
tests real PostgreSQL + HTTP create/moderate/read/photos/withdraw/delete without
contacting payment, delivery or fiscal providers. Its synthetic users, orders,
payments, reviews and files are removed in finally.
