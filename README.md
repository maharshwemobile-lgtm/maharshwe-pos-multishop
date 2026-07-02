# Mahar Shwe POS Multi Shop

Version: `1.0.1`

Mahar Shwe POS is a PostgreSQL-based multi-shop POS web app for mobile phone shops and retail teams. The current codebase focuses on tenant/shop isolation, a clean POS sale flow, dynamic payment wallets, Money Service workflow, admin controls, reporting, audit trails, Google login, and Firebase web push support.

## Current production apps

- POS Web App: [https://app.maharshwe.shop](https://app.maharshwe.shop)
- Landing Page: [https://maharshwe.shop](https://maharshwe.shop)
- Admin Portal: [https://admin.maharshwe.shop](https://admin.maharshwe.shop)
- API Health: [https://api.maharshwe.shop/health](https://api.maharshwe.shop/health)

## Main features

- Multi-shop / tenant-based POS
- PostgreSQL and Prisma data layer
- Email/password login and Google sign-in
- Owner, admin, staff, and permission-based access
- Product, category, stock, purchase, and sale management
- Compact POS Sale page for desktop and mobile
- Sale history, payments, customer credits, and reports
- Dynamic payment methods from Finance & Accounts wallets
- Separate Money Service workflow for Cash In / Cash Out fees
- Project Settings for shop setup, UI, wallets, categories, and integrations
- Firebase Cloud Messaging web push notifications
- Audit trail and backup/restore support
- Google Sheet sync integration

## Tenant isolation rule

Every protected API must resolve the logged-in user and active shop on the server side. Client-submitted `tenant_id` or `shop_id` must never be trusted without membership validation.

Tenant-scoped data includes:

- products
- stock
- sales and sale items
- payments
- customer credits
- money accounts
- sale history
- reports
- audit logs
- push notification tokens

## Tech stack

- React 18
- Vite
- Node.js / Express
- PostgreSQL
- Prisma
- Firebase Cloud Messaging
- Google OAuth

## Required runtime

- Node.js 20+
- npm
- PostgreSQL database
- A configured `.env` file

## Local setup

```bash
npm install --no-audit --no-fund
npm run db:generate
npm run db:deploy
npm run build
npm start
```

For development:

```bash
npm run dev
```

## Environment variables

Create `.env` from `.env.example` and fill only real production/development values there. Do not commit secrets.

Common required variables:

```env
PORT=
DATABASE_URL=
JWT_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
NEXT_PUBLIC_FIREBASE_VAPID_KEY=

FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

TELEGRAM_SHEET_API_URL=
TELEGRAM_API_KEY=
MAHARSHWE_ONLINE_ADMIN_API_KEY=
```

## Important scripts

```bash
npm run db:generate
npm run db:deploy
npm run check:sales-v10
npm run check:phase23
npm run build
npm start
```

## Repository hygiene

The repository should contain source code and deployment/configuration files only.

Ignored or removed from Git tracking:

- `node_modules/`
- `dist/`
- `.env`
- logs
- local SQLite/runtime files
- old phase marker documents
- legacy root-level app entry files

Current application source lives mainly in:

- `src/`
- `server/`
- `prisma/`
- `public/`
- `integrations/`
- `deploy/`

## Deployment note

Production deployment should install dependencies on the server, generate Prisma client, build Vite assets, and restart the API process. Do not deploy secrets through Git.

Safe production command pattern:

```bash
npm install --no-audit --no-fund
npm run db:generate
npm run db:deploy
npm run build
npm start
```

## Version history

- `1.0.1` — Multi Shop current clean baseline.
