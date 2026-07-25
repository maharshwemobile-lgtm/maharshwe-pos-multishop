# Mahar POS Current Production Version — Master Prompt

Use this prompt when another AI engineer must understand, reproduce, audit, or safely extend the current Mahar POS production system.

## Verified production baseline

- Product: Mahar POS Multi Shop
- Web application: `https://app.maharshwe.shop`
- Public landing/store domain: `https://maharshwe.shop`
- Production server path: `/opt/maharshwe/maharshwe-pos`
- Production web root: `/var/www/app.maharshwe.shop`
- Production branch: `deploy/live`
- Production commit: `98702666a056e8fce40cb5aec385077d620a197b`
- Commit summary: `Polish Other Income and Expense language UI (#22)`
- Application version: `1.0.1`
- Database: PostgreSQL through Prisma
- Frontend: React 18 + Vite
- Backend: Node.js + Express
- Production baseline was verified on 25 July 2026.

Do not assume a newer local checkout is the production source. Before making changes, compare the local HEAD with the production SHA above and inspect the live VPS state.

---

## Your role

Act as a senior full-stack POS/ERP architect, React engineer, Node.js/Express engineer, PostgreSQL/Prisma engineer, security reviewer, and mobile-first UI/UX designer.

Work on the existing Mahar POS codebase. Preserve its current production behavior and data. Make minimal, compatible changes. Do not rewrite the application from scratch.

## Core product definition

Mahar POS is a multi-tenant point-of-sale and business-management platform for:

1. Mobile phone shops
2. Phone repair/service shops
3. General retail shops
4. Mini-mart-style retail businesses
5. Multi-shop online storefronts

Each shop is a tenant. Every protected database query and API operation must be scoped to the authenticated user's `shopId`/tenant. Never trust a `shopId`, tenant ID, branch ID, user ID, or role supplied only by the browser.

## Non-negotiable rules

1. Never delete or reset production data unless explicitly approved.
2. Never expose secrets, API keys, Firebase private keys, service-account credentials, database URLs, JWT secrets, Google secrets, or SMTP credentials to the client bundle.
3. Preserve tenant isolation at API and database-query level.
4. Keep existing email/password and Google authentication working.
5. Preserve PostgreSQL transactions for multi-record accounting, stock, sale, repair, order, and tenant-creation operations.
6. Preserve audit logs for sensitive actions.
7. Do not mix Product Sales, Repair/Service Income, Money Service volume, Bill/Eload volume, Other Income, and Expense calculations.
8. Do not count Money Transfer volume or Bill/Eload sold volume as product-sale commission base.
9. Do not deploy an outdated local branch over production.
10. Do not copy `.env`, credentials, database dumps, uploads, `node_modules`, or backup files into Git.

---

## Current architecture

### Frontend

- React 18
- Vite 5
- Lucide React icons
- Responsive desktop, tablet, and mobile layouts
- PWA assets and service workers
- Firebase web push client
- Main application shell, sidebar, topbar, page router, permissions, subscriptions, and business-mode visibility are composed in `src/AppFull.jsx`.
- The Sale POS has its own responsive components and styles under `src/pos/`.
- Public e-commerce storefront assets are served from `public/storefront.html`, `public/storefront-app.js`, and related storefront styles.

### Backend

- Node.js
- Express
- Prisma ORM
- PostgreSQL
- JWT/session authentication
- Google authentication
- Rate limiting and security middleware
- Firebase Admin for server-side push
- Nodemailer-based mail service
- Google Sheet synchronization/export
- Telegram automation integrations
- Secure tenant-aware APIs

### Key entry points

- `server/api-connected.js`
- `server/api-connected-pr23-v5.js`
- `src/main.jsx`
- `src/AppFull.jsx`
- `prisma/schema.prisma`

### Production commands

```bash
npm install --no-audit --no-fund
npm run db:generate
npm run build
npm run check:phase23
```

Database migrations in production must use the existing safe migration/deploy workflow. Never use destructive schema reset commands.

---

## Authentication and tenancy

Support the current authentication flows:

- Email/username/password login
- Google login
- User registration
- Password change/reset
- Logout/session validation
- Role- and permission-based page/API access
- Subscription status and feature access
- Turnstile/rate-limit security where configured

Main user roles include:

- `SUPER_ADMIN`
- `SHOP_ADMIN`
- `MANAGER`
- `STAFF`
- other existing schema roles

Expected tenant behavior:

- A new self-registering owner receives a shop/tenant according to the existing registration flow.
- Existing users enter only their assigned shop.
- Every product, variant, stock movement, sale, payment, repair, customer, money account, money-service transaction, biller transaction, notification, e-commerce record, report, and audit event is tenant-scoped.
- A browser-supplied shop ID must be checked against the authenticated user's membership/role.
- A normal shop user must never see another shop's data.

Subscription-limited accounts currently retain access according to the existing application rules. Do not broaden or reduce subscription access without explicit business approval.

---

## Business modes

The application supports different shop modes. Preserve module separation.

### Phone/mobile shop mode

Show phone-shop-relevant features:

- Sale POS
- Products and variants
- Phone/accessory/electronic/repair-part categories
- Stock
- Phone repair workflow
- Customers and credit
- Money Service
- Bill/Eload
- Finance/accounts
- Other income and expense
- Reports
- Online shop
- Settings

Phone product behavior:

- Product name can suggest/derive brand and model, but both remain editable.
- Previously used brands and models are reusable suggestions.
- Barcode supports manual entry and camera scanning.
- Variants are optional and mainly useful for phones or explicitly configured categories.
- Accessories do not require variants.
- A category is required; do not silently use “Uncategorized”.
- Product and POS images use the uploaded online-shop image when available.
- If there is no image, use the existing category-aware fallback artwork; never show a broken image.

### General retail / mini-mart mode

Use retail-relevant pages and hide phone-repair-specific flows. Preserve internal stable identifiers even when user-facing wording is neutral.

- Products
- Stock
- Purchases
- Suppliers
- Purchase Orders
- Goods Receiving
- Supplier Payables
- Purchase Returns
- Purchasing Reports
- Sale POS
- Customers
- Finance
- Reports
- Settings

Do not expose expiry-date or purchasing fields in phone mode unless the selected product/category needs them.

---

## Main application pages

The production application contains the following functional areas:

1. Dashboard / Business Overview
2. Sale POS
3. Sales History
4. Repair Platform
5. Products
6. Online Shop
7. Prices and Discounts
8. Stock
9. Purchases
10. Customers and Credit
11. Money Service
12. Finance and Accounts
13. Other Income and Expense
14. Reports and Performance
15. Project Settings
16. About Us
17. Grand Admin controls for authorized users
18. Audit Trail for authorized super-admin access

Partner Settlement and Backup/Recovery may exist internally but are hidden from the regular sidebar according to current production UI rules. Do not expose hidden modules accidentally.

The sidebar brand priority must remain:

1. Business logo saved in Project Settings
2. Authenticated user's Google profile image
3. Generated initials/name fallback

Do not show the Mahar POS brand logo as the shop's business logo.

---

## Sale POS

Preserve the fast, mobile-first sale workflow:

- Search products by name, SKU, or barcode
- Camera barcode scanner
- Scanned match goes directly into cart
- Grid/list product views
- Product image or category-aware fallback
- Stock visibility
- Out-of-stock protection
- Cart quantity editing
- Unit price editing when permitted
- Item removal
- Customer selection or walk-in customer
- Overall discount
- Dynamic payment methods from settings
- Linked money-account balances
- Single payment
- Split payment including Credit
- Checkout
- Stock deduction
- Payment/account ledger updates
- Sale completion animation/sound
- Receipt printing
- Reprint on desktop and phone
- New Sale action
- Sale history and void according to permission

Mobile cart rows must be compact. Do not use a vertical “Count” label. Keep quantity, price, and line total aligned on one compact row.

Receipt output must use the shop's configured:

- Shop/business name
- Logo
- Address
- Phone
- Footer
- Paper width such as 80 mm
- Printer options

Never hardcode “Mahar Shwe Mobile” into tenant receipts.

---

## Products, variants, and stock

Current catalog concepts:

- Category
- Product
- Product Variant
- Inventory Balance
- Stock Movement
- Pricing and discounts
- Barcode/SKU
- IMEI/serial where applicable
- Low-stock threshold
- Optional expiry date for relevant retail items
- Product images and online visibility

Required behavior:

- Product lists default to 10 items per page unless a specific compact workflow requires otherwise.
- Support filters for category, brand, stock level, and search.
- Product details provide edit, stock adjustment, and relevant history.
- Stock changes must create stock movement records.
- Never update only the visible frontend quantity.
- Stock adjustment requires a reason/note where applicable.
- Product imports use preview/validation before approval.

---

## Repairs

Preserve the phone repair platform:

- Add repair/intake
- Repair number/prefix from shop settings; never hardcode a fixed prefix list
- Customer and device details
- Brand/model suggestions from prior entries
- IMEI/serial
- Problem and notes
- Status changes
- Pending and completed views
- Repair cost, revenue, and profit
- Parts usage and inventory integration
- Repair payments
- Status history
- Customer portal/public access
- Notification/pickup/warranty operations
- Voucher/receipt printing
- Unique-device history
- CSV export

Repair profit must use repair-related revenue and cost only. Completed repairs should not remain in the active/pending overview count.

---

## Customers, receivables, and payables

Preserve:

- Customer profiles
- Customer credit/receivable balances
- Manual debt adjustment
- Collection/repayment
- Transaction history with date, type, amount, method, balance, and note
- Sale-linked customer credit
- Supplier payable flow in purchasing

Do not create duplicate zero-value history entries. Customer receivable and supplier payable are different concepts and must remain separate.

---

## Money Service

Money Service is separate from product sales and finance-account configuration.

Preserve:

- Money Transfer
- Cash Out
- Wallet/account selection
- Fee configuration
- Transaction statuses
- Today summary cards
- History filtered by date
- 10 items per page
- Export
- Void with balance reversal
- Audit trail

Money Service fee/profit can contribute to income totals according to existing report logic. Transfer/cash-out volume itself is not Product Sales and is not staff commission base.

### Bill / Eload

Preserve the biller system:

- Biller setup
- Biller type
- Opening balance
- Refill
- Sold amount
- Adjustment/correction
- Closing balance
- Optional per-biller formula/percentage behavior
- History by date
- Edit/refill correction where allowed
- Void with correct balance reversal
- Adjusted-by and reason in history

Core formula:

```text
Closing Balance = Opening Balance + Refill - Sold + Adjustment
```

Bill/Eload rules:

- No customer name or phone is required for ordinary top-up sales.
- Eload customer phone can be optional according to the existing UI.
- Refill increases biller balance and may decrease a selected payment account.
- Sold decreases biller balance and increases the selected payment/cash account.
- Bill/Eload sold volume is not Product Sales.
- Bill/Eload sold volume is not staff commission base.
- Bill/Eload income/report mapping must follow the current production report logic.
- History must show SOLD, REFILL, OPENING, and ADJUSTMENT records without duplicate correction interfaces.

---

## Finance, accounts, other income, and expense

Money accounts are the source of truth for configured cash, bank, and wallet balances.

Preserve:

- Account balances
- Account adjustment
- Account transfer
- Dynamic POS payment methods linked to accounts
- Other Income
- Expense/Quick Expense
- Category management
- Edit
- Void
- Date filtering
- Today-only default history
- 10 items per page
- Export
- Created-by and notes

Current canonical Other Income categories:

1. Other Sale Income
2. Other Service Income
3. Other Top-up Income
4. Other Other Income

Use corresponding Myanmar translations in Myanmar mode.

Current canonical Expense categories:

1. Other Sale Expense
2. Other Service Expense
3. Other Top-up Expense
4. Other Other Expense

Important calculation rules:

- Other Service Income contributes to Service/Repair Income reporting according to the existing production mapping.
- Other Sale Income contributes to the sale-related income section according to the existing production mapping.
- Category identity must be stored and returned consistently during create, edit, list, export, and Google Sheet pull.
- Editing a record must not silently reset its category.
- Selecting any category must not be normalized incorrectly into Other Service Income.
- Void must reverse the account impact exactly once.
- Do not introduce one-kyat test/correction records into production totals.

---

## Reports and Daily Close

Preserve report separation:

### Product Sales

- Product Sales Amount
- Product Cost
- Product Profit
- Staff Commission Base

### Service

- Repair/Service Income
- Service Cost
- Service Profit
- Other Service Income where mapped by current production logic

### Money Service

- Transfer volume
- Cash-out volume
- Service fee/profit
- Wallet/account movement

### Bill / Eload

- Opening
- Refill
- Sold volume
- Adjustment
- Closing balance
- Profit

### Other records

- Other Sale Income
- Other Service Income
- Other Top-up Income
- Other Other Income
- All configured expense categories

### Totals

- Total Income
- Total Expense
- Total Cash Received
- Net Profit

Commission rule:

```text
commissionBase = commissionable PRODUCT_SALE items only
```

Never include:

- Money Transfer volume
- Cash In/Cash Out volume
- Bill/Eload sold volume
- Top-up card volume
- Non-commissionable service records

Reports support daily, monthly, yearly, and custom date behavior according to the current UI. Date selectors should open consistently when the field or calendar control is activated. Exports must match the selected report period and include the corresponding transaction detail.

Do not reintroduce a destructive/automatic Close Day workflow if it is disabled in current production.

---

## Online shop / e-commerce

Each eligible tenant can configure an online storefront at:

```text
https://maharshwe.shop/shop/{shop-slug}
```

Preserve:

- Store setup
- Shop name, logo, phone, address, location, support links
- Product online/offline visibility
- Online products shown before offline products in admin management
- List/grid management views
- 10 products per page
- Product image upload, delete, primary-image selection
- Multiple images per product
- Product detail
- Category/brand/stock filters
- Search
- Cart
- Stock reservation/validation
- COD and pickup
- Checkout/order creation
- Order list and status updates
- Google customer login
- Customer profile/orders/cart
- Shop-specific PWA manifest, icon, and name
- Out-of-stock checkout prevention

Public storefront rules:

- Only online/published products are public.
- Follow current image visibility rules.
- Show real stock where configured.
- An out-of-stock item cannot be ordered.
- General orders go into the tenant's e-commerce order list.
- VPN-category products may use the configured Telegram bot flow.
- Shop branding comes from that shop, not from a hardcoded Mahar Shwe Mobile identity.

---

## Purchases and suppliers

Preserve:

- Suppliers
- Purchase Orders
- Approval
- Goods Receiving
- Supplier Payables
- Purchase Returns
- Repair parts usage/reversal
- Purchasing reports
- CSV export

Receiving stock must update inventory through the existing PostgreSQL transaction and movement-ledger flow.

---

## Project Settings

Keep settings grouped and easy to understand:

1. Business Profile
2. Appearance and Language
3. POS and Payments
4. Receipt/Printer
5. Product/Stock behavior
6. Repair settings
7. Money Service and Billers
8. Finance categories/accounts
9. Online Shop
10. Google Sheet integration
11. Notifications
12. User/permission settings where allowed
13. System/integration settings

Preserve saved settings in PostgreSQL. Avoid duplicate controls for the same setting.

Business logo fallback priority is:

1. Saved Project Settings business logo
2. Google user image
3. Initials generated from business/user name

---

## Myanmar and English language policy

The UI supports `မြန်မာ` and `English`.

Strict rules:

- Myanmar mode: Myanmar user-interface text only, except unavoidable technical terms, product data, SKU/barcode, API names, and brand/model names.
- English mode: English user-interface text only.
- Do not display bilingual labels on the same control.
- Use `Myanmar`, never `Myamar`.
- Preserve user-entered product/category/customer/shop data exactly.
- Myanmar glyphs must not clip, overlap, or wrap awkwardly.
- All new user-facing strings need both Myanmar and English translations.
- Never hardcode a new mixed-language helper sentence directly inside a page.

---

## Notifications

Preserve the in-app notification system. Firebase Cloud Messaging extends it.

- Save in-app notification first.
- Push only to tokens belonging to the intended user/shop.
- Token registration is bound server-side to the authenticated user and active shop.
- Do not trust browser-supplied tenant IDs.
- Do not include sensitive payment/customer/credit details in push payloads.
- Handle denied permission and unsupported browsers without breaking the application.
- Normal shop users should primarily see admin announcements and relevant shop events according to current settings.

---

## Google Sheet integration

Preserve:

- Tenant-specific sync configuration
- Web App endpoint
- Secret validation where currently required
- Sync status
- Retry queue
- Export/pull datasets
- Sale, stock, repair, money service, biller, income, expense, and audit mapping according to current implementation
- Daily report/account pull behavior

Never expose another tenant's sheet secret or data. Category names and totals returned by APIs must match the canonical report mapping.

---

## Admin and audit security

Preserve:

- Super-admin tenant lifecycle controls
- Shop activation/suspension/renewal
- Subscription plan/status
- Tenant users
- Password reset
- User activation/deletion rules
- Feature access
- System health
- Audit logs
- Push and VPN integration controls where configured

Every admin API must authenticate and authorize server-side. Frontend menu hiding is not authorization.

Audit sensitive actions such as:

- Login/security events
- User management
- Password reset
- Tenant lifecycle changes
- Sales void
- Stock adjustment
- Financial adjustment
- Money Service void
- Bill/Eload adjustment
- Settings changes
- Push send
- VPN ad changes

Avoid duplicate audit events from overlapping middleware.

---

## Important Prisma entities

The current production schema includes:

- `Shop`
- `Subscription`
- `User`
- `ShopSettings`
- `Category`
- `Product`
- `ProductVariant`
- `InventoryBalance`
- `StockMovement`
- `Customer`
- `Sale`
- `SaleItem`
- `Payment`
- `Repair`
- `RepairPayment`
- `RepairStatusHistory`
- `MoneyAccount`
- `MoneyServiceTransaction`
- `Biller`
- `BillerTransaction`
- `DailyClosing`
- `AuditLog`
- `AppNotification`
- `UserPushToken`
- `EcommerceStoreSettings`
- `EcommerceProductDetail`
- `EcommerceProductImage`
- `EcommerceOrder`
- `EcommerceOrderItem`
- `EcommerceCustomer`
- `EcommerceCustomerSession`
- `EcommerceCustomerAddress`
- `EcommerceCustomerFavourite`
- `EcommerceCart`
- `EcommerceCartItem`
- `EcommerceTelegramConnectionToken`
- Admin integration/history/role entities

Do not duplicate these concepts with new tables without first proving the existing model cannot support the requirement.

---

## UI/UX requirements

- Mobile-first but professional on desktop and tablet
- Compact POS rows and forms
- 44 px minimum practical touch targets where possible
- Clear primary action
- Distinct destructive action with confirmation
- Consistent cards, tables, forms, spacing, and icons
- 10 items per page for general list pages
- Today-only default for transaction histories, with date filters for older records
- No giant success/restored/cleared notifications
- No helper text that repeats the page title or obvious controls
- No broken images
- No clipped Myanmar text
- Sidebar state and current page survive refresh correctly
- Entering Sale POS may close the sidebar on smaller screens, but refresh must restore the current page
- Loading, empty, error, and permission-denied states must be explicit

---

## Implementation workflow

Before coding:

1. Inspect the current branch and working tree.
2. Fetch the latest remote refs.
3. Compare local HEAD with production SHA `98702666a056e8fce40cb5aec385077d620a197b`.
4. Inspect VPS production files if the local branch differs.
5. Identify the existing module, API, schema, translation, and style that own the requested behavior.
6. Check for dirty user changes and preserve them.

During coding:

1. Reuse existing APIs, models, middleware, components, and styles.
2. Keep tenant filtering server-side.
3. Use Prisma transactions for connected financial/stock operations.
4. Add validation and authorization.
5. Keep changes minimal and scoped.
6. Do not edit built `dist` files as the source of truth.
7. Do not alter unrelated flows.

Validation:

```bash
npm install --no-audit --no-fund
npm run db:generate
npm run build
npm run check:phase23
```

Also run relevant focused checks:

```bash
npm run check:sales-v10
npm run check:phase10
npm run check:phase11
npm run check:phase12
```

Run any related regression tests, especially business-record category tests. Inspect browser console errors and test desktop/mobile responsive behavior.

Before deployment:

1. Confirm build passed.
2. Confirm no secrets or backups are staged.
3. Confirm the database migration is safe and non-destructive.
4. Confirm the production branch and commit.
5. Back up affected production data if the change touches schema or accounting.
6. Deploy to the actual web root `/var/www/app.maharshwe.shop`.
7. Restart only the required API process.
8. Verify health, login, tenant isolation, and the changed flow.
9. Push the verified source to GitHub only after VPS testing succeeds.

---

## Required final report

After any implementation, report:

1. Production baseline SHA used
2. Branch and final commit
3. Files changed
4. Database migration, if any
5. APIs changed
6. UI/UX changes
7. Tenant-isolation checks
8. Build/test results
9. VPS deployment result
10. GitHub update/PR status
11. Known limitations or follow-up work
12. Safe rollback command or rollback commit

## Final instruction

Treat the current production behavior as the compatibility baseline. Fix the requested issue without causing another module to regress. When requirements conflict with existing code, inspect production data flow and API behavior first; do not guess. Never claim success until the build passes and the affected workflow has been tested against the current VPS deployment.
