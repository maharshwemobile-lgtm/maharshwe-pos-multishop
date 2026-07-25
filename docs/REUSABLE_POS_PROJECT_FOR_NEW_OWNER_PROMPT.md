# Reusable Multi-Tenant POS Project Prompt for a New Owner

Copy this complete prompt into Codex. Replace every value inside `<ANGLE_BRACKETS>` before running it.

---

You are a senior full-stack POS/ERP architect, React engineer, Node.js/Express engineer, PostgreSQL/Prisma engineer, Android engineer, DevOps engineer, security reviewer, and mobile-first UI/UX designer.

Create a production-ready multi-tenant POS project for a new owner by adapting the trusted Mahar POS source and workflow. Work autonomously from inspection through build and testing. Do not copy production customer/business data or private credentials.

# 1. New project information

```text
PROJECT_NAME=<NEW_POS_PRODUCT_NAME>
PROJECT_SLUG=<new-pos-project-slug>
OWNER_NAME=<NEW_OWNER_NAME>
OWNER_EMAIL=<NEW_OWNER_EMAIL>
COMPANY_NAME=<NEW_COMPANY_NAME>
DEFAULT_LANGUAGE=<my-or-en>
DEFAULT_CURRENCY=<MMK>
TIMEZONE=<Asia/Rangoon>

WEB_APP_DOMAIN=https://<app.example.com>
LANDING_DOMAIN=https://<example.com>
ADMIN_DOMAIN=https://<admin.example.com>
SUPER_ADMIN_DOMAIN=https://<super.example.com>
API_DOMAIN=https://<api.example.com>

NEW_GITHUB_REPOSITORY=https://github.com/<OWNER>/<NEW_REPOSITORY>.git
VPS_HOST=<NEW_VPS_IP_OR_HOST>
VPS_USER=<DEPLOY_USER>
VPS_PROJECT_PATH=/opt/<PROJECT_SLUG>
WEB_ROOT=/var/www/<app.example.com>
```

# 2. Trusted source template

Use the following source only as a technical template:

```text
SOURCE_REPOSITORY=https://github.com/maharshwemobile-lgtm/maharshwe-pos-multishop.git
SOURCE_TAG=v1.0.1
SOURCE_COMMIT=98702666a056e8fce40cb5aec385077d620a197b
```

Rules:

1. Retrieve the real source at the exact commit.
2. Do not copy Mahar POS production `.env`.
3. Do not copy its PostgreSQL database or database dumps.
4. Do not copy its uploaded shop/product/customer images unless they are generic licensed assets.
5. Do not copy production users, shops, sales, repairs, payments, credits, accounts, audit logs, orders, or notifications.
6. Do not expose or reuse private API keys, OAuth secrets, Firebase Admin credentials, Telegram bot tokens, SMTP credentials, JWT secrets, or VPS keys.
7. Generate independent secrets and configuration for the new project.
8. Preserve open-source/license notices required by the source repository.

# 3. Required product

Build a complete multi-tenant POS/ERP application with:

1. Landing page
2. Web POS application
3. Shop-admin portal
4. Super-admin portal
5. Public online shop per tenant
6. Optional native Android application
7. PostgreSQL database
8. Secure REST APIs
9. Myanmar and English UI
10. Responsive/PWA support

Each shop is an isolated tenant. One shop must never access another shop's data.

# 4. Authentication and onboarding

Implement:

- Email/username/password registration
- Email/username/password login
- Google Sign-In
- Password change/reset
- Remembered username where appropriate
- Session/JWT validation
- Logout
- Registration/login rate limiting
- Cloudflare Turnstile when configured risk/limit requires it
- Suspicious registration monitoring
- Audit events without duplicates

New owner onboarding:

1. Register identity.
2. Create owner user, shop, settings, and subscription in one PostgreSQL transaction.
3. Assign a unique tenant/shop slug.
4. Activate the new legitimate shop.
5. Start the configured Free plan.
6. Open onboarding/shop setup.
7. Require business profile before public storefront activation.

Google login rules:

- Use one OAuth client for all users of this deployment.
- Verify Google identity server-side.
- Match existing user by verified email.
- Create an isolated shop only for an allowed new-owner signup.
- Never trust tenant ID from the browser.

# 5. Roles and permissions

Support at least:

- `SUPER_ADMIN`
- `SHOP_ADMIN`
- `MANAGER`
- `STAFF`
- `VIEWER`

Server-side permissions control:

- Dashboard
- Sales
- Products
- Stock
- Repairs
- Customers/credit
- Money Service
- Finance
- Reports
- Settings
- Users
- Online shop
- Purchasing
- Audit
- Tenant administration

Frontend menu hiding is not authorization.

# 6. Business types

Ask the owner to choose:

- Phone/mobile shop
- Phone repair shop
- General retail
- Mini-mart/grocery
- Mixed business

Show only relevant fields and modules.

Phone mode:

- Phone, Accessories, Electronics, Spare Parts
- Brand/model suggestions
- Barcode and IMEI/serial
- Optional phone variants
- Repair system
- No unnecessary expiry-date field

Retail/mini-mart mode:

- Product/stock/purchasing focus
- Supplier and expiry fields when relevant
- Hide repair-specific functions

Do not rename stable internal identifiers merely to change visible wording.

# 7. Dashboard

Use real tenant PostgreSQL data:

- Today's sales
- Today's total income
- Today's expense
- Net profit
- Sale count
- Pending repairs
- Customer receivable
- Low stock
- Recent activity
- Seven-day sales trend

Avoid duplicate totals. Use tenant timezone.

# 8. Sale POS

Implement:

- Product search
- SKU/barcode search
- Camera barcode scanner
- Scan directly into cart
- Grid/list views
- Product image or category fallback
- Stock display and out-of-stock protection
- Compact mobile cart
- Quantity edit
- Authorized price edit
- Item removal
- Customer/walk-in selection
- Discount
- Dynamic payment types
- Money-account links
- Single payment
- Split payment
- Credit payment
- Checkout
- Stock deduction
- Payment ledger
- Customer credit
- Receipt printing
- Reprint on desktop and mobile
- Sale history
- Void with exact reversal

Checkout uses one PostgreSQL transaction. If any step fails, roll back the sale, stock, payments, account balances, and credit effects.

# 9. Products and stock

Product fields:

- Name
- Category
- Brand
- Model
- SKU
- Barcode
- Cost price
- Selling price
- Stock
- Low-stock threshold
- Optional variants
- Optional expiry date for relevant business type
- Product images
- Online visibility

Behavior:

- Previously used brand/model suggestions
- Product-name brand/model detection but always editable
- Manual barcode or camera scan
- Category required
- 10 items per page
- Search and filters
- Product detail/edit/stock adjustment
- Stock movement ledger
- Import template
- Import preview before approval
- Export

# 10. Repairs

Implement:

- Repair intake
- Shop-configured repair prefix
- Customer/device data
- Brand/model suggestions
- IMEI/serial
- Problem and notes
- Status update/history
- Pending/completed separation
- Cost/revenue/profit
- Repair parts
- Payments
- Voucher/receipt
- Customer portal
- Notification
- Pickup code
- Warranty
- Unique-device history
- Export

Do not hardcode repair-prefix values.

# 11. Customers and credit

Implement:

- Customer profile
- Receivable balance
- Manual debt
- Credit sale
- Repayment/collection
- Payment account integration
- Debt history with date, amount, method, balance, and note

Do not create duplicate or zero-value history rows. Keep supplier payables in Purchasing.

# 12. Accounts and payment methods

Implement:

- Cash/bank/wallet accounts
- Balance
- Adjustment with reason
- Account-to-account transfer
- POS payment-method configuration
- POS show/hide
- Payment-method-to-account link

Do not confuse Money Service wallets with POS payment-method visibility.

# 13. Money Service

Implement:

- Money Transfer
- Cash Out
- Wallet selection
- Amount
- Fee
- Status
- Account effect
- Today summary
- Date-filtered history
- 10 items per page
- Export
- Void and reversal

Money Transfer principal is not Product Sales or profit. Only configured service fee/profit contributes to income.

# 14. Bill / Eload

Implement:

- Biller setup
- Opening balance
- Refill
- Sold
- Adjustment
- Closing balance
- Per-biller percentage/formula
- Account integration
- Unified history
- Refill edit
- Void
- Balance report

Formula:

```text
Closing = Opening + Refill - Sold + Adjustment
```

Bill/Eload sold volume:

- Is not Product Sales
- Is not staff commission base
- May be part of cash received

# 15. Other Income and Expense

Default income categories:

- Other Sale Income
- Other Service Income
- Other Top-up Income
- Other Other Income

Default expense categories:

- Other Sale Expense
- Other Service Expense
- Other Top-up Expense
- Other Other Expense

Implement:

- Create
- Edit date/category/amount/account/note
- Void
- Exact account reversal
- Today default history
- Date filters
- 10 items per page
- Export
- Correct report mapping

Never normalize every category into Other Service Income.

# 16. Reports

Separate:

- Product Sales
- Product Cost
- Product Profit
- Staff Commission Base
- Repair/Service Income
- Service Cost/Profit
- Money Transfer volume
- Money Service fee
- Bill/Eload opening/refill/sold/closing/profit
- Other income
- Expense
- Total cash received
- Net profit

Commission base includes eligible Product Sales only.

Provide:

- Today
- Daily/custom dates
- Monthly
- Yearly
- 10 rows per page
- Excel/CSV export
- Receipt/report print where required

# 17. Purchasing

Implement:

- Suppliers
- Purchase Orders
- Approval
- Goods Receiving
- Stock increase
- Supplier Payables
- Purchase Returns
- Repair-parts integration
- Purchasing reports
- Export

Receiving updates receipt, inventory, stock movements, PO state, and payable atomically.

# 18. Online shop for every tenant

Store URL:

```text
https://<LANDING_DOMAIN_HOST>/shop/{shop-slug}
```

Admin features:

- Store setup
- Shop name/logo/contact/address/location
- COD and pickup
- Online/offline products
- Product images
- Primary image
- Orders
- Order statuses
- 10 items per page

Public features:

- Shop-specific branding
- Search
- Categories
- Filters
- Product detail
- Multiple images
- Real stock
- Out-of-stock protection
- Cart
- Customer login with Google
- COD/pickup checkout
- Customer order history
- PWA install with shop name/logo

Normal orders enter the correct tenant's order list. Optional special categories may open a configured Telegram bot only when explicitly configured.

# 19. Project Settings

Group settings:

1. Business Profile
2. Appearance and Language
3. POS and Payments
4. Receipt/Printer
5. Products and Stock
6. Repair
7. Money Service/Billers
8. Accounts/Categories
9. Online Shop
10. Google Sheet
11. Notifications
12. Users/Permissions
13. System integrations

Logo priority:

1. Saved business logo
2. Google profile image
3. Name initials

Keep product brand and POS product brand separate from each tenant's business brand.

# 20. Myanmar and English

Add a global switch:

- `မြန်မာ`
- `English`

Myanmar mode shows Myanmar UI text only.
English mode shows English UI text only.
Do not mix languages on one label.
Technical terms and user-entered product/brand/model data can remain original.
Centralize translations and provide both languages for every visible string.

# 21. Google Sheet, notifications, and optional integrations

Google Sheet:

- Tenant-specific endpoint and secret
- Test response body, not HTTP code only
- Sync queue/status/retry
- Secure pull/export
- Correct categories and report totals

Notifications:

- In-app notifications
- Firebase web push
- Token bound to authenticated user/shop
- Permission after user action
- No secret in frontend
- No cross-tenant push

Optional integrations:

- Telegram
- Mail
- Firebase Admin
- Agent/OpenAI/Gemini
- VPN/admin integrations

Keep disabled unless valid independent credentials are configured.

# 22. PostgreSQL data model

Reuse/adapt the existing Prisma models rather than duplicating concepts:

- Shop
- Subscription
- User
- ShopSettings
- Category
- Product
- ProductVariant
- InventoryBalance
- StockMovement
- Customer
- Sale
- SaleItem
- Payment
- Repair
- RepairPayment
- RepairStatusHistory
- MoneyAccount
- MoneyServiceTransaction
- Biller
- BillerTransaction
- DailyClosing
- AuditLog
- AppNotification
- UserPushToken
- E-commerce entities
- Admin history/role entities

Every business entity must be tenant-scoped.

# 23. Security

- Helmet/security headers
- Restricted CORS
- Secure cookies/token storage according to architecture
- Password hashing
- Rate limits
- Turnstile support
- Input validation
- URL/file validation
- Upload type/size limits
- Server-side permissions
- Tenant filtering
- Audit
- No private data in client bundle
- No plaintext secrets in logs
- Idempotency for order/payment-sensitive requests

# 24. New branding

Replace user-facing source branding with:

```text
Product name: <NEW_POS_PRODUCT_NAME>
Company: <NEW_COMPANY_NAME>
Logo files: <NEW_LOGO_PATHS>
Primary color: <PRIMARY_COLOR>
Secondary color: <SECONDARY_COLOR>
Support phone: <SUPPORT_PHONE>
Support email: <SUPPORT_EMAIL>
Telegram/support link: <SUPPORT_LINK>
Address: <COMPANY_ADDRESS>
```

Do not rename internal database fields, migrations, API contracts, stable route IDs, or permission keys merely for branding.

# 25. Independent environment

Create `.env.example` without secrets.

Configure independent values for:

- `DATABASE_URL`
- JWT/session secrets
- Google OAuth client ID/secret
- Turnstile site/secret key
- Firebase public values
- Firebase Admin values
- SMTP/mail
- Telegram bot
- Google Sheet
- Admin integrations

Generate new secrets. Never reuse Mahar POS production secrets.

# 26. Build and verification

Run:

```bash
npm install --no-audit --no-fund
npm run db:generate
npm run build
npm run check:phase23
npm run check:sales-v10
npm run check:phase10
npm run check:phase11
npm run check:phase12
node --test server/business-record-categories.test.js
```

Test desktop and mobile:

- Registration/login/Google
- Tenant isolation
- Sale and stock deduction
- Split/credit payment
- Print/reprint
- Sale void
- Product/stock/scan
- Repair
- Credit
- Money Service
- Bill/Eload
- Other income/expense
- Reports
- Purchasing
- Online shop/order/PWA
- Settings/language
- Notifications

# 27. GitHub workflow

1. Create a clean new repository.
2. Keep source history/licensing as required.
3. Use a `codex/initial-production-build` branch.
4. Never commit `.env`, keys, database dumps, uploads, `node_modules`, `dist`, or backups.
5. Commit the verified source.
6. Push.
7. Open a Draft PR.
8. Merge only after VPS test approval.
9. Tag the first stable release.

# 28. VPS deployment

On the new authorized VPS:

1. Install Node.js, PostgreSQL/client requirements, Nginx, and the selected process manager.
2. Clone the new repository into `<VPS_PROJECT_PATH>`.
3. Create independent `.env`.
4. Install dependencies.
5. Generate Prisma.
6. Apply safe migrations to the new empty database.
7. Build.
8. Sync `dist` to `<WEB_ROOT>`.
9. Start one API process.
10. Configure Nginx and HTTPS.
11. Verify health and domains.

Do not touch Mahar POS production VPS or database while building the new owner's project.

# 29. Required deliverables

Provide:

1. Complete source
2. `.env.example`
3. Prisma migrations
4. README
5. Deployment SOP
6. Backup/restore SOP
7. Admin/operator guide
8. API summary
9. Test report
10. Security report
11. GitHub repository/PR
12. VPS deployment report
13. Stable release ZIP/tag
14. Safe rollback procedure

# 30. Final instruction

Do not only make a visual demo. Build real APIs and PostgreSQL-backed workflows. Keep every transaction tenant-safe and auditable. Preserve accounting separation. Make the UI simple enough for ordinary shop staff. Do not claim completion until build, focused tests, browser tests, and the authorized VPS smoke test pass.

---

End of reusable prompt.
