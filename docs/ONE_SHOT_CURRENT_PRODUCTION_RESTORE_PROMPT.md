# One-Shot Mahar POS Current Production Restore Prompt

Copy everything below and paste it as one prompt into Codex.

---

You are restoring the exact current production version of Mahar POS. Work autonomously until the source, build, and runtime are fully reconstructed and verified.

## Exact trusted source

- Repository: `https://github.com/maharshwemobile-lgtm/maharshwe-pos-multishop.git`
- Trusted release tag: `v1.0.1`
- Required commit: `98702666a056e8fce40cb5aec385077d620a197b`
- Required short SHA: `9870266`
- Production branch name: `deploy/live`
- App version: `1.0.1`
- VPS project path: `/opt/maharshwe/maharshwe-pos`
- Production web root: `/var/www/app.maharshwe.shop`
- Web app: `https://app.maharshwe.shop`
- Landing/store domain: `https://maharshwe.shop`
- Stack: React 18, Vite, Node.js, Express, Prisma, PostgreSQL

## Primary objective

Reconstruct the exact Mahar POS current production source from Git commit `98702666a056e8fce40cb5aec385077d620a197b`.

Do not regenerate or rewrite the application from a written description. Retrieve the real files from Git. The commit SHA is the source of truth.

If the Git repository is unavailable but authorized VPS access exists, copy the clean tracked source from `/opt/maharshwe/maharshwe-pos` without copying secrets, runtime data, database files, uploads, backups, `node_modules`, or built artifacts as source.

## Safety rules

1. Never delete, reset, migrate destructively, or overwrite the production PostgreSQL database.
2. Never print, copy, commit, or expose `.env` secrets.
3. Never commit private keys, tokens, service-account JSON, database dumps, uploads, backups, `node_modules`, or `dist`.
4. Preserve production `.env`, PostgreSQL data, uploaded product/store images, and Nginx configuration.
5. Do not use another branch, newer local dirty files, old archives, cached checkout, or guessed code.
6. Do not modify application behavior during restoration.
7. Do not deploy unless the target is explicitly identified as the authorized VPS.
8. If the fetched commit does not equal the required SHA, stop and report the mismatch.

## Step 1 — Inspect the target

First show:

```bash
pwd
git remote -v
git branch --show-current
git rev-parse HEAD
git status --short
node --version
npm --version
```

If this is an existing VPS checkout, also record without exposing values:

```bash
test -f .env && echo ".env exists" || echo ".env missing"
test -d /var/www/app.maharshwe.shop && echo "web root exists" || echo "web root missing"
```

Back up only the deployment metadata and current source state if needed. Do not copy secrets into Git.

## Step 2 — Retrieve the exact version

Use a clean checkout:

```bash
git clone https://github.com/maharshwemobile-lgtm/maharshwe-pos-multishop.git maharshwe-pos-multishop
cd maharshwe-pos-multishop
git fetch origin --tags --prune
git checkout -B deploy/live 98702666a056e8fce40cb5aec385077d620a197b
```

For an existing authorized checkout:

```bash
git fetch origin --tags --prune
git checkout -B deploy/live 98702666a056e8fce40cb5aec385077d620a197b
```

Do not force-reset a dirty checkout until its uncommitted files have been inspected and safely preserved outside the clean source directory. Never restore dirty files over the trusted commit.

Verify:

```bash
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
git status --short
```

Required:

```text
branch = deploy/live
HEAD = 98702666a056e8fce40cb5aec385077d620a197b
working tree = clean
```

Stop if any required value does not match.

## Step 3 — Restore environment safely

The repository must not contain production secrets.

On an authorized existing VPS, preserve the existing production `.env` in `/opt/maharshwe/maharshwe-pos/.env`.

For a new environment:

1. Read `.env.example`.
2. Create `.env` locally.
3. Ask the operator to provide missing secret values securely.
4. Do not invent credentials.
5. Do not echo secret values in output.

At minimum, validate the presence—not the values—of variables needed by the active runtime, including:

- PostgreSQL connection
- JWT/session authentication
- Google authentication
- mail service when enabled
- Firebase server credentials when enabled
- Firebase public client configuration when enabled
- Google Sheet integration when enabled
- Telegram integration when enabled
- admin integration secrets when enabled

## Step 4 — Install and generate

Use:

```bash
npm install --no-audit --no-fund
npm run db:generate
```

Do not use `npm ci` if lock synchronization prevents installation on this trusted version.

Do not run destructive Prisma commands. Do not run `prisma migrate reset`, `db push --force-reset`, database recreation, or seed against production.

Inspect migration status before applying anything:

```bash
npx prisma migrate status
```

Apply existing safe migrations only if the target database requires them and production authorization explicitly allows it:

```bash
npm run db:deploy
```

## Step 5 — Validate the source

Run:

```bash
npm run build
npm run check:phase23
npm run check:sales-v10
npm run check:phase10
npm run check:phase11
npm run check:phase12
```

Also run available focused regression tests, especially:

```bash
node --test server/business-record-categories.test.js
```

Fix only restoration/build-environment problems. Do not redesign, refactor, add features, rename labels, alter formulas, or change API behavior.

After build, verify:

- `dist` exists
- no private secret appears in generated client files
- no production database was changed unexpectedly
- source working tree remains clean

## Step 6 — Verify core functional structure

Confirm the exact source contains:

- Authentication and Google login
- Multi-tenant shop isolation
- Dashboard
- Sale POS and split payments
- Sales history, print, reprint, and void
- Products, categories, variants, images, barcode scanner
- Inventory and stock movements
- Repair intake, status, finance, history, voucher, customer portal
- Customers and credit
- Money accounts and dynamic POS payment methods
- Money Transfer and Cash Out
- Bill/Eload opening, refill, sold, adjustment, edit, void, and balance reports
- Other Income and Expense create/edit/void/category mapping
- Daily/monthly/yearly reports
- Purchases, suppliers, receiving, payables, and returns
- Online shop, product images, orders, storefront, customer login, and PWA
- Project Settings, language, branding, receipt/printer
- Google Sheet integration
- Firebase/in-app notifications
- Admin, tenant, subscription, health, and audit functions

Do not recreate missing files manually if the commit checkout is incomplete. Treat that as a repository integrity error and report it.

## Step 7 — Local runtime smoke test

Start the existing application using its package scripts:

```bash
npm run dev
```

Verify:

- frontend loads
- `/health` or `/api/health` returns success
- login screen loads
- no immediate browser console crash
- API connects to the configured PostgreSQL database

If test credentials are not supplied, do not invent them. Perform unauthenticated health and page checks and report authenticated tests as pending.

## Step 8 — Authorized VPS deployment

Only on the authorized production VPS:

1. Confirm source path is `/opt/maharshwe/maharshwe-pos`.
2. Confirm exact required SHA again.
3. Preserve `.env` and uploads.
4. Build from the trusted source.
5. Use the repository deployment script:

```bash
npm run deploy:webroot:api
```

If the script is unavailable or fails, inspect `scripts/deploy-app-webroot.sh`. The final built frontend must synchronize to:

```text
/var/www/app.maharshwe.shop
```

Do not deploy into a different web root.

Restart only the existing Mahar POS API process using the process manager already configured on the VPS. Do not create a duplicate server process or change ports without inspection.

## Step 9 — Production verification

Verify:

```bash
git rev-parse HEAD
git status --short
curl -fsS https://app.maharshwe.shop/
curl -fsS https://app.maharshwe.shop/api/health
```

Then test in a browser:

- Login page and logo
- Myanmar/English switch
- Sidebar and refresh page restoration
- Dashboard
- Sale POS catalog
- Product images/fallbacks
- Cart editing
- Payment methods
- Mobile reprint visibility
- Products and stock
- Repair page
- Money Service and Bill/Eload
- Other Income/Expense categories
- Reports
- Online Shop management
- Public storefront
- Settings

Do not create, void, delete, adjust, or sell real production records during smoke testing unless the operator explicitly authorizes a test transaction.

## Step 10 — Required final report

Return:

1. Repository URL
2. Release tag
3. Required SHA
4. Actual local/VPS SHA
5. Whether SHA matches
6. Branch
7. Working-tree status
8. Environment presence check without secret values
9. Dependency installation result
10. Prisma generation and migration status
11. Build result
12. Check/test results
13. Local health result
14. Production deployment result
15. Production health result
16. Core module verification
17. Files changed during restoration
18. Any blocked credentials/configuration
19. Safe rollback source SHA and command

Success is allowed only when:

```text
HEAD = 98702666a056e8fce40cb5aec385077d620a197b
working tree = clean
build = passed
health = passed
production web root = /var/www/app.maharshwe.shop
```

If any of these fail, do not claim the current production version has been reconstructed.

---

End of one-shot prompt.
