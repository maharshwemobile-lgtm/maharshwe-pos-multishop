# Mahar POS v1.0.1 — Full Functional Rebuild and Maintenance Prompt

This is the detailed functional prompt for the current Mahar POS production system. It supplements `MAHAR_POS_CURRENT_VERSION_PROMPT_20260725.md`.

## Exact source baseline

- VPS: `157.245.61.106`
- Source directory: `/opt/maharshwe/maharshwe-pos`
- Public web root: `/var/www/app.maharshwe.shop`
- Branch: `deploy/live`
- Commit: `98702666a056e8fce40cb5aec385077d620a197b`
- Short SHA: `9870266`
- Version: `1.0.1`
- Verified date: 25 July 2026
- Git working tree on VPS: clean when inspected
- Runtime stack: React + Vite + Express + Prisma + PostgreSQL

The repository contains approximately 391 Express route declarations across current and compatibility modules. Do not rebuild those routes blindly. Determine which route registration chain is active from `server/api-connected.js` → `server/api-connected-pr23-v5.js` and preserve route ordering, middleware, and compatibility aliases.

---

# 1. System objective

Build and maintain Mahar POS as a real multi-tenant POS/ERP platform. It must support daily use by non-technical shop owners and staff while protecting every shop's data at the server and database layer.

The system includes:

- Tenant registration and authentication
- Subscription and feature access
- Dashboard
- Sale POS
- Sales history
- Product catalog and variants
- Inventory and stock movements
- Repairs
- Customers and credit
- Money accounts
- Money Transfer/Cash Out
- Bill/Eload balances
- Other income and expense
- Reports
- Online storefront
- Purchases and suppliers
- Google Sheet integration
- Push notifications
- Project settings
- Admin and audit functions
- Responsive/PWA behavior

The goal is not merely to display pages. Every screen must use the existing real APIs and PostgreSQL data.

---

# 2. Universal request lifecycle

Every protected request must follow this conceptual flow:

```text
Browser request
  → security headers / CORS / rate limiting
  → authentication
  → session/JWT validation
  → active user validation
  → shop membership validation
  → subscription/feature validation
  → role/permission validation
  → payload validation
  → tenant-scoped Prisma query/transaction
  → audit/event/notification integration
  → sanitized response
```

Never accept `shopId` from the browser as authority. The active shop comes from the authenticated session. A supplied branch, user, account, product, customer, biller, or order ID must be verified as belonging to the authenticated shop.

Error responses should be clear and stable:

- `400`: invalid input
- `401`: unauthenticated or invalid session
- `403`: permission, subscription, or tenant violation
- `404`: tenant-scoped resource does not exist
- `409`: duplicate/conflict/idempotency error
- `422`: business-rule validation
- `429`: rate limited
- `500`: unexpected server error without leaking secrets or SQL

---

# 3. Authentication, registration, and session behavior

## 3.1 Login

Inputs:

- Tenant ID/shop slug when required by the current login mode
- Email, phone, or username
- Password
- Google identity token for Google login

Expected flow:

1. Apply endpoint-specific rate limits.
2. Use trusted proxy headers only when server proxy trust is correctly configured.
3. Normalize identifier without changing stored user data.
4. Find the user through the existing tenant-aware logic.
5. Verify password hash or Google token.
6. Reject inactive/deleted users.
7. Verify shop/subscription access.
8. Issue the current session/JWT response.
9. Record one audit event, not duplicates.
10. Return sanitized user, shop, role, permission, subscription, and appearance data.

Password failure must clear only the password field in the UI. Tenant and username/email must remain filled.

## 3.2 Registration

Expected flow:

1. Apply global and endpoint registration limits.
2. Trigger Turnstile only according to configured risk/limit behavior.
3. Reject duplicate email, username, or conflicting tenant slug.
4. Create owner user, shop, shop settings, and subscription in one PostgreSQL transaction.
5. Activate legitimate new shops according to the current free-plan rule.
6. Do not auto-suspend a first-time legitimate registration.
7. Link Google identity when Google registration is used.
8. Send registration email if mail is configured; email failure must not corrupt account creation.
9. Record registration/security audit once.
10. Return the next-login/onboarding state.

## 3.3 Google login

Endpoint family:

- `POST /api/auth/google`

Rules:

- Use one Google OAuth client for all users.
- Verify token signature, issuer, audience, expiry, and verified email server-side.
- Never expose the Google client secret.
- Existing email maps to its current assigned shop.
- New owner flow creates an isolated shop only when self-registration is allowed.
- Google login is identity verification, not permission to select arbitrary tenant data.

## 3.4 Session endpoints

- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`

`/api/auth/me` is the current identity source. Logout invalidates the current server-side/session state according to the existing implementation. Do not add duplicate logout APIs to visible Settings UI.

---

# 4. Dashboard / Business Overview

The dashboard summarizes real PostgreSQL data for the authenticated shop and current Myanmar-local business date.

Expected cards and data sources:

- Today's Sale: completed/non-void sales for today
- Today's Total Income: mapped income components only
- Today's Expense: valid non-void expense records
- Product/stock alerts
- Pending repairs, excluding completed repairs
- Customer receivables
- Account/wallet summary where displayed
- Recent activity
- Seven-day sales performance

## 4.1 Today's Total Income

Build from canonical components, without duplicate addition:

```text
Product Sales
+ recognized Repair/Service Income
+ Money Service Fee/Profit
+ Bill/Eload income according to current mapping
+ Other Sale Income
+ Other Service Income
+ Other Top-up Income
+ Other Other Income
```

Do not add:

- raw Money Transfer volume as profit
- cash-out principal
- Bill/Eload refill
- duplicate service records
- voided records
- future-dated records

## 4.2 Seven-day sales performance

- Use real date buckets in shop timezone.
- Show seven continuous days.
- A missing day is zero, not omitted.
- Compare consistent periods.
- Avoid misleading percentages when the previous period is zero.
- Responsive chart labels must not overlap.
- Tooltip/detail values use the configured currency formatting.

---

# 5. Sale POS — full behavior

Primary endpoints:

- `GET /api/pos/catalog`
- `GET /api/pos/payment-methods`
- `POST /api/sales`
- `GET /api/sales`
- `GET /api/sales/:id`
- `POST /api/sales/:id/void`

## 5.1 Catalog loading

1. Authenticate and derive current shop.
2. Load active products and active variants for that shop.
3. Join inventory quantity.
4. Join online/product primary image when available.
5. Apply category-aware fallback art if no image exists.
6. Exclude inaccessible or inactive records.
7. Return newest/current catalog ordering used by production.

The catalog must support:

- Text search
- SKU
- Barcode
- Category filter
- Brand filter
- Stock filter
- Grid/list
- Camera scanner

## 5.2 Scan-to-cart

1. Open camera only after user action and browser permission.
2. Read barcode.
3. Find exact active variant in current tenant.
4. If one match exists, add one unit to cart.
5. Play a small success sound/animation.
6. Prevent duplicate scanner callbacks from adding multiple unwanted units.
7. If no match, show compact actionable error.
8. Never create a product automatically from a sale scan.

## 5.3 Add to cart

1. Validate product/variant is active.
2. Read current available stock.
3. Reject out-of-stock item unless the existing authorized negative-stock rule allows it.
4. If already in cart, increment quantity.
5. Keep quantity at or below available stock.
6. Store the saved cart using current production behavior without showing a giant “Saved cart restored” notification.
7. Update compact cart summary immediately.

## 5.4 Edit cart

Allow:

- Quantity increase/decrease
- Authorized unit-price edit
- Item removal
- Discount handling
- IMEI/serial where required

Recalculate:

```text
lineTotal = quantity × unitPrice - lineDiscount
subtotal = sum(lineTotal)
grandTotal = subtotal - overallDiscount
```

All amounts must use safe decimal/integer monetary handling consistent with existing schema. Do not rely on floating-point UI totals as accounting truth.

## 5.5 Payment

Payment methods are dynamic and come from configuration:

- Method label
- Visible/hidden in POS
- Linked `MoneyAccount`
- Active status

Support:

- Single payment
- Split payment
- Credit

Validation:

- Payment total must equal required paid amount, accounting for credit rules.
- Selected account must belong to current shop.
- Hidden/inactive method cannot be submitted by direct API.
- Credit requires valid customer when the current business rule requires it.

## 5.6 Checkout transaction

Use one PostgreSQL transaction:

1. Re-read current stock with appropriate concurrency protection.
2. Validate every line.
3. Generate unique tenant invoice number.
4. Create `Sale`.
5. Create `SaleItem` snapshots.
6. Decrease `InventoryBalance`.
7. Create `StockMovement` rows.
8. Create `Payment` rows.
9. Update linked `MoneyAccount` balances/ledger behavior.
10. Update customer credit where applicable.
11. Create audit event.
12. Create in-app notification/event hooks where configured.
13. Commit.

If any step fails, roll back all sale, stock, payment, and credit effects.

## 5.7 Sale complete

Show compact actions on desktop and mobile:

- Print
- Reprint
- New Sale
- Close
- View details/history where available

Receipt content comes from current shop settings. No tenant-independent hardcoded shop name.

## 5.8 Sale void

1. Require permission and confirmation.
2. Verify sale belongs to current shop and is not already void.
3. Mark sale void once.
4. Reverse inventory once.
5. Reverse payment/account effects once.
6. Reverse customer credit effect if applicable.
7. Record audit reason and actor.
8. Preserve immutable history.

---

# 6. Sales History

Expected behavior:

- Default view can focus on recent/today records.
- Search invoice, customer, payment, status, cashier.
- Date filtering.
- 10 items per page.
- Detail shows sold line items, quantities, unit prices, discounts, totals, payment split, customer, cashier, timestamp.
- Reprint works on mobile and desktop.
- Void button appears only for authorized, voidable sales.
- Export follows selected filters.

Do not show only a sale header without its item details.

---

# 7. Product and category management

Primary endpoints:

- `GET/POST /api/categories`
- `PATCH/DELETE /api/categories/:id`
- `GET/POST /api/products`
- `GET/PATCH/DELETE /api/products/:id`
- `POST /api/products/:productId/variants`
- `PATCH/DELETE /api/variants/:id`
- `POST /api/products/import`

## 7.1 Category rules for phone shops

Keep the main selector simple:

- Phone
- Accessories
- Electronics
- Spare Parts

Subtype/kind can remain internal or appear only when needed. Do not display a long combined `Category · Kind · Code` label in the main selector.

Delete obsolete categories only after checking references. Never delete a category in use without migration/reassignment.

## 7.2 Product creation

Required:

- Product name
- Valid category

Optional/configured:

- Brand
- Model
- Description
- Barcode
- SKU
- Cost price
- Selling price
- Opening stock
- Low-stock threshold
- Images
- Variant setup
- Expiry date for relevant retail mode

Behavior:

1. User enters product name.
2. Detect known brand prefix where reliable.
3. Suggest model remainder.
4. Keep both editable.
5. Reuse prior tenant brand/model suggestions.
6. User can scan or manually type barcode.
7. Validate tenant-unique SKU/barcode.
8. Create product and initial variant/inventory in one transaction where appropriate.
9. Create opening stock movement if opening stock is nonzero.
10. Suggest optional variants after product creation for phone category.

Do not silently create an “Uncategorized” product.

## 7.3 Product edit/detail

Clicking a product opens:

- Detail
- Edit
- Stock adjustment
- Variant management
- Image/online state where connected

Editing barcode also supports scanner. Images should load from online-shop image records when available.

---

# 8. Inventory and stock

Primary endpoints:

- `GET /api/stock`
- `GET /api/stock/low`
- `GET /api/stock/movements`
- `POST /api/stock/movements`
- `GET /api/inventory/export`
- `POST /api/inventory/import/preview`
- `POST /api/inventory/import`
- purchase/receiving APIs

## 8.1 Stock adjustment

Inputs:

- Product variant
- Direction/type
- Quantity
- Reason/note

Flow:

1. Verify variant belongs to shop.
2. Validate positive quantity.
3. Validate resulting stock if negative is disallowed.
4. Update inventory and create movement atomically.
5. Record user and timestamp.
6. Refresh dashboard/low-stock state.

## 8.2 Import

1. Provide a simple template.
2. Upload CSV/XLSX through current import format.
3. Normalize headers/data.
4. Preview.
5. Show errors, new items, updates, and stock impact.
6. Require approval.
7. Import atomically or in safe batches.
8. Never mutate production during preview.

---

# 9. Repair workflow

Primary endpoint group:

- `GET /api/repair-platform/jobs`
- `GET /api/repair-platform/jobs/:id`
- `POST /api/repair-platform/intake`
- `PATCH /api/repair-platform/jobs/:id/status`
- finance/customer/device/public portal endpoints

## 9.1 Intake

Inputs include:

- Customer
- Phone
- Brand
- Model
- IMEI/serial
- Problem
- Notes
- Estimated amount/date where configured

Flow:

1. Derive shop.
2. Read shop-configured repair prefix.
3. Generate next tenant-safe repair number.
4. Reuse device brand/model suggestions.
5. Create repair and initial status history.
6. Optionally create customer/public access/notification data.
7. Return printable voucher.

Never enforce the old hardcoded prefix list.

## 9.2 Status

- Status can be changed from the repair UI.
- Every status transition creates one history record.
- Invalid transitions are rejected according to current rules.
- Done/completed repairs leave active pending counts.
- Customer notifications use safe generic content.

## 9.3 Repair finance

```text
repairProfit = recognizedRepairRevenue
             - partsCost
             - technicianCost
             - otherRepairCost
```

Do not include product-sale or Money Service profit.

---

# 10. Customers and credit

Primary endpoints:

- `GET/POST /api/customers`
- `GET/PATCH /api/customers/:id`
- `PATCH /api/customers/:id/balance`
- `POST /api/customers/:id/collect`

## 10.1 Manual debt

Allow recording a customer amount owed to the shop.

1. Verify customer belongs to shop.
2. Require nonzero amount and note/reason.
3. Update balance atomically.
4. Create one debt-history record.
5. Do not create a duplicate zero-value “Paid” row.

## 10.2 Collection

1. Validate positive collection amount.
2. Prevent over-collection unless explicitly supported.
3. Update receivable.
4. Add money to selected tenant account.
5. Create history with date, method, reference, resulting balance, note.

Supplier payable is managed in purchasing, not customer credit.

---

# 11. Money accounts and payment configuration

Primary endpoints:

- `GET /api/payments/accounts`
- `POST /api/payments/accounts/:id/adjust`
- `POST /api/payments/accounts/transfer`
- `GET /api/finance/settings/catalogs`
- payment-method CRUD endpoints
- `GET /api/pos/payment-methods`

## 11.1 Account adjustment

- Require account, signed/directional amount, and reason.
- Verify tenant.
- Apply once.
- Create auditable transaction/history.

## 11.2 Transfer

Use one transaction:

1. Verify source and destination belong to same shop.
2. Source and destination must differ.
3. Validate amount.
4. Decrease source.
5. Increase destination.
6. Create linked history/audit.

## 11.3 POS method configuration

A POS payment type is not the same as a Money Service wallet.

- POS visibility toggle controls whether method appears at checkout.
- Account link determines which `MoneyAccount` receives payment.
- Rename changes display label without breaking stable identity.
- Cash, KBZ, Credit, Bank, etc. are configuration data; avoid rigid frontend hardcoding.

---

# 12. Money Transfer and Cash Out

Primary endpoints:

- `GET /api/money-service/settings`
- `PUT /api/money-service/settings/rates`
- `GET /api/money-service/dashboard`
- `GET/POST /api/money-service/transactions`
- `GET /api/money-service/transactions/:id`
- `POST /api/money-service/transactions/:id/collect`
- `POST /api/money-service/transactions/:id/void`

## 12.1 Transfer

Inputs:

- Date
- Type = transfer
- Source wallet/account
- Receiver name/number as configured
- Amount
- Fee
- Status
- Note

Allowed business statuses should use the current simplified set rather than exposing unnecessary internal states.

Account effect:

- Principal movement follows transfer direction/current implementation.
- Fee is recognized separately as Money Service income.

## 12.2 Cash Out

Inputs:

- Date
- Type = cash out
- Receiving/linked wallet
- Customer name/number optional according to current flow
- Amount
- Fee
- Completion status

## 12.3 Void

1. Verify transaction belongs to shop.
2. Reject already-void transaction.
3. Reverse all linked account effects once.
4. Reverse recognized fee once.
5. Keep row and mark void.
6. Store reason, actor, and timestamp.

History defaults to today, supports date filter, export, and 10 items per page.

---

# 13. Bill / Eload

Primary endpoints:

- `GET/POST /api/billers`
- `PUT/DELETE /api/billers/:id`
- transaction creation endpoints for opening/refill/sold/adjustment
- `POST /api/biller-transactions/:id/void`
- `PUT /api/biller-transactions/:id/refill`
- `GET /api/biller-transactions`
- `GET /api/reports/biller-balance`

## 13.1 Biller

Fields:

- Tenant/shop
- Optional branch
- Name
- Type
- Opening balance
- Current balance
- Active state
- Formula/percentage configuration where supported

## 13.2 Sold

1. Validate biller and amount.
2. Reject amount above current balance unless authorized negative balance is enabled.
3. Calculate configured refill/rebate/profit behavior.
4. Decrease biller balance.
5. Increase selected receiving account when linked.
6. Create `SOLD` ledger.
7. Report under Bill/Eload, not Product Sales.

## 13.3 Refill

1. Validate biller and amount.
2. Increase biller balance.
3. Decrease selected funding account if linked.
4. Create `REFILL` ledger.
5. Do not count refill as income.

Refill can be edited through the dedicated endpoint. The edit must apply the difference, not add the full replacement amount twice.

## 13.4 Adjustment

- Requires reason.
- Supports increase/decrease.
- Records actor and reason.
- Appears in the same unified Bill/Eload history.
- Do not show duplicate correction panels.

## 13.5 Balance report

For selected range:

```text
Opening = closing balance before start date
Refill = sum(REFILL)
Sold = sum(SOLD)
Adjustment = signed sum(ADJUSTMENT)
Closing = Opening + Refill - Sold + Adjustment
```

Voided records do not contribute.

---

# 14. Other Income and Expense

Primary endpoints:

- `GET /api/business-control/overview`
- `POST /api/business-control/other-income`
- `POST /api/business-control/expenses`
- `GET /api/business-control/records`
- `GET /api/business-control/records/export`
- `PATCH /api/business-control/records/:type/:id`
- `POST /api/business-control/records/:type/:id/void`
- income/expense category CRUD endpoints

## 14.1 Canonical categories

Income:

- Other Sale Income
- Other Service Income
- Other Top-up Income
- Other Other Income

Expense:

- Other Sale Expense
- Other Service Expense
- Other Top-up Expense
- Other Other Expense

Each has an independent Myanmar and English label. The record stores a stable category identity. Display translation must not alter accounting identity.

## 14.2 Create

Inputs:

- Date
- Category
- Label/description
- Amount
- Payment account
- Note

Flow:

1. Resolve selected canonical/custom category.
2. Verify account belongs to shop.
3. Create record.
4. Increase account for income or decrease for expense.
5. Save category identity, display label snapshot, creator, date, and note.
6. Update overview/report mapping once.

## 14.3 Edit

Allow changing:

- Date
- Category
- Amount
- Description/note
- Account where current rule permits

Apply account delta correctly:

1. Reverse old account effect.
2. Apply new account effect.
3. Update record.
4. Preserve audit history.

Never force all edited categories into Other Service Income.

## 14.4 Void

1. Reverse account impact once.
2. Mark void instead of deleting financial history.
3. Exclude from totals/exports.
4. Record actor/reason.

History:

- Today by default
- Date selector for older records
- 10 items per page
- Clear Edit and Void buttons
- Stock-list-quality responsive layout

---

# 15. Reports and accounting formulas

Primary endpoints:

- `GET /api/reports/daily-close`
- `GET /api/reports/business`
- `GET /api/reports/summary`
- purchasing/repair/biller report endpoints

## 15.1 Product Sales

```text
productSales = sum(nonVoidSaleItem.quantity × effectiveUnitPrice - discount)
productCost = sum(nonVoidSaleItem.quantity × costSnapshot)
productProfit = productSales - productCost
```

## 15.2 Staff commission

```text
commissionBase = sum(
  eligible non-void sale items
  where isCommissionable = true
  and reportGroup = PRODUCT_SALE
)
```

Exclude Bill/Eload, Money Service principal, cash movement, repair unless explicitly part of a separate commission rule, and non-commissionable items.

## 15.3 Other subtotals

```text
otherIncomeSubtotal =
  Other Sale Income
  + Other Service Income
  + Other Top-up Income
  + Other Other Income
```

Expense report must enumerate current valid expense categories rather than omit Quick Expense categories.

## 15.4 Date modes

- Today: no custom-range fields
- Daily/custom: show start/end date
- Monthly: select month; cards and transactions use that month
- Yearly: select year; cards and transactions use that year

Export must use the exact active filter and include transaction rows.

---

# 16. E-commerce admin

Primary endpoints:

- `GET/PUT /api/ecommerce/settings`
- `GET /api/ecommerce/products`
- `PUT /api/ecommerce/products/:productId`
- `POST /api/ecommerce/products/:productId/images`
- `DELETE /api/ecommerce/images/:id`
- `PATCH /api/ecommerce/images/:id/primary`
- `GET /api/ecommerce/orders`
- `PATCH /api/ecommerce/orders/:id/status`

## 16.1 Store setup

Manage:

- Enabled/disabled
- Shop name
- Logo
- Phone
- Address
- Map/location
- Telegram/support
- COD
- Pickup
- Theme/branding

View Store must be visually prominent but should require enabling/configuring the online shop first where current rules require it.

## 16.2 Products and images

- Online tab first
- Offline tab separate
- Default list view
- Optional grid view
- 10 items per page
- Multi-select online/offline toggle
- Clicking item opens detail
- Clicking image block opens upload
- Upload accepts current safe image formats/size
- Save file to production upload path
- Persist database image record
- Set/delete/primary operations update UI and public storefront

An online item without an image should be visually muted in admin and encouraged to add an image according to current storefront policy.

## 16.3 Orders

Store order status values:

- Pending
- Preparing
- Ready
- Completed
- Cancelled

Status filters must work. Status update verifies shop ownership. Cancelled/failed orders release any active reserved stock according to current implementation.

---

# 17. Public storefront

Primary endpoints:

- `GET /api/public/store/:slug`
- `GET /api/public/store/:slug/products`
- shop-specific manifest
- customer auth/profile/cart/order endpoints
- `POST /api/public/store/:slug/orders`

## 17.1 Store loading

1. Resolve active shop by slug.
2. Load public settings.
3. Load public/online products only.
4. Load primary images and stock.
5. Return shop-specific logo/name/contact/location.
6. Never expose private cost, internal notes, secrets, or another shop's data.

## 17.2 Cart

- Guest or authenticated customer cart
- Quantity cannot exceed available/reservable stock
- Out-of-stock item disabled
- Persistent cart according to current session logic
- Back navigation closes modal/detail before leaving the site

## 17.3 Checkout

Inputs:

- Customer identity/name
- Phone
- Address or pickup selection
- Cart
- Optional note
- Idempotency key

Flow:

1. Rate limit.
2. Resolve store tenant.
3. Validate every current product, online state, price, and stock.
4. Calculate server-side total.
5. Create order and item snapshots atomically.
6. Apply current stock reservation logic.
7. Return order number.
8. Show order confirmation.
9. Normal products remain in Mahar POS e-commerce order list.
10. Only configured VPN product flow redirects/opens Telegram.

## 17.4 PWA

Manifest and icons must be shop-specific:

- App name = shop name
- Icon = shop logo or safe fallback
- Start URL = that shop route
- Theme colors = storefront theme

Do not use the Mahar POS internal app logo for every tenant storefront install.

---

# 18. Purchasing

Endpoint families:

- Suppliers
- Purchase Orders
- Approval
- Goods Receiving
- Payables
- Returns
- Repair parts
- Reports/export

## 18.1 Purchase Order

1. Select supplier.
2. Add products/variants and quantities/costs.
3. Save draft.
4. Approve with permission.
5. Preserve ordered vs received quantities.

## 18.2 Receiving

Use one transaction:

1. Validate PO and remaining quantities.
2. Create receipt.
3. Increase inventory.
4. Create stock movements.
5. Update PO status.
6. Create/update supplier payable.

## 18.3 Return

1. Validate received stock.
2. Decrease inventory.
3. Create reversal movement.
4. Adjust payable/refund state.
5. Keep audit history.

---

# 19. Google Sheet sync

Primary endpoints:

- Project Settings integration GET/PUT/test/retry
- Sync status/retry
- Secret-protected export GET/POST
- Remittance export extension

Flow:

1. Tenant admin configures Apps Script Web App URL.
2. Server stores tenant configuration.
3. Test performs real request and checks response body, not HTTP 200 alone.
4. `{"ok":false,"message":"Invalid secret"}` is failure even with HTTP 200.
5. Events enter sync queue according to current integration.
6. Retry processes failed/pending events.
7. Pull/export validates tenant secret and dataset.
8. Returned categories and totals use the same report mapping as UI.

Never show another tenant's endpoint or secret.

---

# 20. Notifications and Firebase

Primary endpoints:

- Push status
- Register/deactivate/delete token
- Test
- In-app notification list/read/read-all
- Admin send endpoints

Flow:

1. Ask permission only after user action.
2. Register service worker.
3. Get FCM token with VAPID public key.
4. Submit token to authenticated endpoint.
5. Server binds token to session user and shop.
6. Save in-app notification before optional push.
7. Foreground message updates UI.
8. Denied/unsupported state does not break app.

Do not repeatedly trigger low-stock notices for the same unchanged condition without current deduplication/cooldown behavior.

---

# 21. Settings behavior

Primary endpoint:

- `GET /api/project-settings`

Write endpoints:

- Preferences
- Business
- Appearance
- Slip
- API/integrations
- Google Sheet test
- System

Settings response must be sanitized. Private server credentials never return to the frontend.

## 21.1 Branding

Priority:

1. Saved shop logo
2. Google profile image
3. Generated initials

Mahar POS application brand and tenant business brand are separate.

## 21.2 Language

Store one global user/shop preference according to current behavior:

- `my`/Myanmar
- `en`/English

Every visible page must render one language at a time. Product, brand, model, customer, and user-entered values are not translated.

## 21.3 Receipt

Store:

- Width
- Header/shop info
- Logo behavior
- Footer
- Auto print
- Copies/options

Web and Android clients should consume the same logical configuration.

---

# 22. Admin, tenant lifecycle, and subscription

Endpoint groups:

- Grand admin overview
- Shops
- Shop settings/features
- Tenant users
- Password reset
- Subscription get/create/update/renew/cancel
- Suspend/activate/delete
- System health
- Integration status
- Audit logs

Rules:

- Super admin is separate from shop admin.
- Shop admin manages only assigned shop.
- New legitimate shop starts active under current free plan.
- Subscription clearly identifies Free/Paid and plan duration.
- Deleted tenants/users do not remain in selectors or counts.
- Permanent delete requires explicit high-risk confirmation and should not be the default.
- Active shop deletion follows current lifecycle safeguards.

---

# 23. Backup and recovery

Endpoints:

- `GET /api/backups/status`
- `GET /api/backups/download`

Rules:

- Authorized users only.
- Export/query must match current Prisma relations.
- Do not use obsolete relation names such as a non-existent `Sale.staff`.
- Backup download must not expose `.env` or server secrets.
- Database restore requires explicit approval and verified backup.

---

# 24. Audit

Endpoints:

- `GET /api/audit/events`
- `GET /api/audit/integrity`

Rules:

- Audit Trail UI is super-admin-only under current app visibility.
- Each business action should create one canonical event.
- Avoid duplicate events from route handler plus multiple overlapping middleware.
- Preserve actor, shop, action, resource, timestamp, and safe metadata.
- Never store plaintext passwords, tokens, or secrets.

---

# 25. Complete acceptance-test matrix

## Authentication

- Valid email/password login succeeds.
- Wrong password preserves tenant and username fields.
- Google login maps to correct shop.
- User A cannot request User B data.
- Rate limiting works without blocking ordinary use.

## Sale

- Search and scanner add correct item.
- Out-of-stock cannot be added.
- Quantity/price edits recalculate.
- Split payment including credit validates.
- Checkout creates one sale.
- Stock decreases exactly once.
- Linked accounts increase exactly once.
- Mobile/desktop print and reprint work.
- Void reverses effects once.

## Products/stock

- Category required.
- Brand/model suggestions work and remain editable.
- Barcode uniqueness enforced per tenant.
- Opening stock creates movement.
- Adjustment creates movement.
- Import preview makes no data change.

## Repair

- Add repair works.
- Prefix is shop-configured.
- Status history is complete.
- Done repair leaves pending count.
- Profit uses repair data only.
- Voucher prints.

## Credit

- Manual debt creates one history row.
- Collection updates customer and account.
- No duplicate zero repayment.
- Tenant isolation works.

## Money Service

- Transfer/Cash Out account effects are correct.
- Fee contributes to income once.
- Principal does not become product sales.
- Void reverses once.
- Today/date history and export work.

## Bill/Eload

- Opening/refill/sold/adjustment formula balances.
- Refill edit applies difference.
- Void reverses once.
- Sold excluded from product commission.
- Unified history shows actor/reason.

## Other records

- Each of four income categories remains distinct.
- Each expense category remains distinct.
- Edit preserves or intentionally changes category.
- Other Service Income maps to service section.
- Account effects follow income/expense direction.
- Void removes totals and reverses account.

## Reports

- Daily/monthly/yearly/custom values use selected dates.
- Income components sum exactly once.
- Expense categories are complete.
- Export matches UI period.
- Commission excludes service/transfer/biller volume.

## E-commerce

- Tenant store branding is correct.
- Only online products appear.
- Images upload/display/delete/primary work.
- Out-of-stock cannot checkout.
- Order appears in correct tenant admin.
- Order status filters work.
- PWA uses shop name/logo.

## Settings/i18n

- Myanmar mode contains no avoidable English UI labels.
- English mode contains no Myanmar UI labels.
- Saved logo has highest priority.
- Receipt configuration is honored.
- Secrets absent from browser responses/bundle.

## Build

- Prisma generation succeeds.
- Production build succeeds.
- Phase checks succeed.
- Relevant regression tests succeed.
- Browser console has no new errors.

---

# 26. Do-not-regress checklist

Before changing any module, verify that the change does not:

- Replace current production with an older UI
- Drop Online Shop code
- Reintroduce hidden Partner/Backup menu items
- Mix Myanmar and English
- Replace tenant logo with Mahar POS logo
- Reset Other Income categories
- Duplicate history/audit rows
- Count Bill/Eload as Product Sales
- Count Money Transfer principal as income
- Break mobile cart layout
- Hide mobile Reprint
- Change report API mappings unexpectedly
- Trust tenant ID from browser
- Expose secrets
- Modify production DB without backup/approval

---

# 27. Required engineering response format

For every requested change, first identify:

1. User-visible requirement
2. Existing owning component
3. Existing owning API
4. Existing Prisma entities
5. Account/stock/report side effects
6. Tenant and permission checks
7. Regression risks

Then implement, test, and report:

- Baseline commit
- Changed files
- Behavior before/after
- API/database impact
- Build/tests
- VPS test
- GitHub status
- Rollback

Do not respond with recommendations only when implementation is requested.

---

# 28. Final operating instruction

Use the existing code as the source of truth. This document describes intended current behavior, but when a field name, enum, relation, route order, or transaction detail differs, inspect commit `9870266` and the live PostgreSQL-safe implementation before editing.

The correct result is not “the page looks right.” The correct result is:

- UI is simple,
- API is real,
- PostgreSQL records are correct,
- stock/account/report effects agree,
- tenant isolation holds,
- mobile and desktop work,
- language is consistent,
- audit is singular,
- build passes,
- and the verified VPS behavior matches the source pushed to GitHub.
