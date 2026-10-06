# Contact-request checkout

New checkout submissions create `Order.kind=APPLICATION`, status `NEW`, line-item/contact snapshots, a delivery preference and an audit entry. They never create `Payment`, `FiscalReceipt` or `OzonDeliveryJob`. Any obsolete payment form value is ignored. Old browser payment actions are disabled.

Incoming requests appear at `/admin/orders/` and through **Заявки покупателей** in the account menu. Contact the buyer manually. Supported application statuses: NEW, APPROVED, IN_PROGRESS, PACKED, SHIPPED, DELIVERED, CANCELED. Internal notes and tracking are editable. Delivery is organized manually; selecting a status does not submit a shipment or perform fiscalization.

DELIVERED requires explicit staff confirmation that the purchase happened and the buyer received the goods. `purchaseConfirmedAt` plus the account-owned delivered line item permits a verified-purchase review. Merely submitting an application never does. Reopening/canceling clears this attestation.

Deletion requires `orders.write` and matching order-number confirmation. It sets `deletedAt` atomically with audit. Deleted orders disappear from active admin/customer lists; staff can inspect their history under **Удалённые**. Existing bank, fiscal and carrier records remain for reconciliation. Deletion is not a refund or carrier cancellation. Archived applications cannot be edited or accessed through customer detail/success pages. Customer documents from historical purchases remain accessible to their owner.

Legacy payment integrations are tucked into an archive section in administrator settings; old obligations still reconcile. No new application uses those settings, even if the old integration remains enabled. The carrier worker will not submit jobs for an application or archived order.

Email confirmation retains the existing opt-in processor configuration; no new external notifier is configured. Administrator delivery of requests is through the dashboard/list, not a promise of email/SMS notification.

Additive migration: `20261006020000_order_applications`. Prior order kind is ORDER; historical payment/shipping data is not rewritten. Tests include isolated local HTTP workflows for guests/customers, auth/CSRF, simultaneous submissions, no financial/carrier records, status confirmation, review eligibility, archival and preserved historical fiscal receipts.
