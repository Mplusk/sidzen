# Review moderation and order alerts

## Administration

Account → Store integrations now contains **Telegram · new orders** and
**DeepSeek · review moderation**. Only `settings.write` can read/edit these.
Telegram takes a **bot token**, not an account password, and a numeric chat ID.
Start the bot with `/start`, then obtain your chat ID via the bot's `getUpdates`
API. Keep token-bearing URLs private. Save/check verifies `getMe` and `getChat`
without messaging. The test button explicitly sends a non-personal test message.

Review moderation reuses the existing encrypted DeepSeek key/model, independent
of whether category classification is enabled. It is off until the operator
confirms the processing/transfer arrangements and enables it. A buyer's separate,
optional `review-ai` consent is required. No consent means manual moderation,
not rejection. The setting cannot self-certify legal compliance or necessary
cross-border notification. Existing review consent documents are not rewritten.

## Safety and lifecycle

Only account-owned, delivered/confirmed purchases can submit reviews as before.
Creation atomically adds a durable `ReviewAiJob`, never publishes immediately.
No historical backfill. Only review text/rating and limited public product text
go to DeepSeek. Buyer identity, orders, photos and API tokens are not in prompts.
Local gates detect URLs, contacts, invisible characters and instruction patterns
before API calls. Fixed system policy, JSON data separation, no tools, bounded
response, exact boolean schema, and no generated answer exposed to the buyer
prevent using this feature as an AI chat endpoint. This is layered protection,
not a claim that probabilistic content classification is infallible.

Auto-publication requires relevant, confident, link/profanity/politics/instruction/
personal-data-free classification. Negative ratings/criticism are valid. Photos
go to humans because this integration is text-only. Uncertain/malformed results,
missing consent/config, and exhausted retries stay unpublished in the existing
moderation page, with closed-vocabulary reasons. Human decisions cancel AI work;
leases, content fingerprint and consent rechecks prevent stale publication.
Shared review/privacy lock is preserved. Three bounded attempts on temporary API
failures, no retries on policy failure. Logs never contain review text or raw
provider messages. Review deletion cascades its job and revokes both consents.

Telegram is an atomic per-order outbox for **new orders after enabling**. It does
not slow checkout with API requests and does not send old orders. One worker
lease prevents concurrent sending. Deleted orders/changed config cancel waiting
jobs. Five bounded retries for explicit rate/provider failure; transport timeout
or expired in-flight lease is `UNCERTAIN`, not blindly resent. The settings page
offers confirmed manual retry and explains the possible duplicate. Telegram
does not offer a sendMessage idempotency key, so exactly-once delivery cannot be
guaranteed across ambiguous failures. `SENT` jobs cannot be manually requeued.
Notifications contain only an opaque authenticated admin link; no buyer data,
product data or order number. Link previews are disabled. Secrets use existing
AES-GCM purpose-bound storage. No public Telegram endpoint is added.
If sign-in is needed, the return path is preserved so successful login opens
that order rather than the general dashboard; order-reading permission remains
mandatory before any order lookup.

## Verification

`pnpm test`, `pnpm typecheck`, `pnpm lint`; local-only
`scripts/smoke-review-ai-telegram.ts` verifies real PostgreSQL queues and fixture
API transports, concurrency, policy routing, consent revocation, negative
ratings, manual decision races, rate retries and ambiguous Telegram outcomes.
The script is run by CI before production deployment. It never contacts real
provider accounts or submits real customer reviews/orders.
`scripts/smoke-communications-http.ts` verifies real server actions, role/CSRF
protection, secret masking/encryption, blank-token preservation, settings
revision guards, separate operator confirmation, and protected alert links.

## Storefront density

Mobile gallery arrows have a 28px visible circle and 44px button target, preserving
native swipe and reduced-motion navigation. Desktop controls are unchanged.
Category listings omit duplicate breadcrumbs; active category controls remain.
Footer Shop block is removed. Information contains About, Contacts/requisites,
FAQ, Delivery/order. Legal links remain in their separate footer row.
