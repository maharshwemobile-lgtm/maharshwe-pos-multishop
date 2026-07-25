# Mahar POS Multi Shop

Version: `1.0.1`

Mahar POS is a PostgreSQL-based multi-shop POS web app for mobile phone shops and retail teams. The current codebase focuses on tenant/shop isolation, a clean POS sale flow, dynamic payment wallets, Money Service workflow, admin controls, reporting, audit trails, Google login, and Firebase web push support.

## မြန်မာလို အကျဉ်းချုပ်

Mahar POS သည် ဖုန်းဆိုင်၊ ဖုန်းပြင်ဆိုင်နှင့် အထွေထွေလက်လီဆိုင်များအတွက် ဖန်တီးထားသော Multi-Shop POS နှင့် လုပ်ငန်းစီမံခန့်ခွဲမှုစနစ်ဖြစ်သည်။

- ဆိုင်တစ်ဆိုင်ချင်းစီ၏ အချက်အလက်ကို PostgreSQL တွင် သီးခြားကာကွယ်ထားသည်။
- အရောင်း POS၊ ပစ္စည်းနှင့် လက်ကျန်၊ ဖုန်းပြင်၊ ဖောက်သည်အကြွေး၊ ငွေလွှဲဝန်ဆောင်မှု၊ Bill/Eload နှင့် စာရင်းချုပ်များကို တစ်နေရာတည်းတွင် အသုံးပြုနိုင်သည်။
- Desktop၊ Tablet နှင့် Mobile Browser များတွင် အသုံးပြုနိုင်သည်။
- Email/Password နှင့် Google Account ဖြင့် ဝင်ရောက်နိုင်သည်။
- ဆိုင်တိုင်းအတွက် Online Shop နှင့် PWA အထောက်အပံ့ပါဝင်သည်။
- အခြေခံ POS လုပ်ဆောင်ချက်များကို Lifetime Free Plan ဖြင့် အသုံးပြုနိုင်သည်။ အဆင့်မြင့်လုပ်ဆောင်ချက်များကို သတ်မှတ်ထားသော Plan နှင့် Permission အလိုက် အသုံးပြုနိုင်သည်။

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

## Developer information

Mahar POS is developed and maintained by the Mahar POS development team.

| Item | Information |
| --- | --- |
| Product | Mahar POS Multi Shop |
| Developer / Maintainer | Mahar POS Development Team |
| Organization | Mahar Shwe Mobile |
| GitHub | [maharshwemobile-lgtm](https://github.com/maharshwemobile-lgtm) |
| Email | [maharshwemobile@gmail.com](mailto:maharshwemobile@gmail.com) |
| Website | [maharshwe.shop](https://maharshwe.shop) |
| POS Application | [app.maharshwe.shop](https://app.maharshwe.shop) |
| Support Community | [Telegram](https://t.me/+2gc9ml7iMgk1ZThl) |
| Primary market | Myanmar |

### Developer အချက်အလက်

Mahar POS ကို Mahar POS Development Team မှ တည်ဆောက်ပြီး Mahar Shwe Mobile မှ စီမံထိန်းသိမ်းထားပါသည်။

- Project ပြင်ဆင်လိုသူများသည် အထက်ပါ GitHub Organization မှ Issue သို့မဟုတ် Pull Request ဖွင့်နိုင်သည်။
- အသုံးပြုမှုနှင့် အကောင့်ဆိုင်ရာအကူအညီအတွက် Email သို့မဟုတ် Telegram Community မှ ဆက်သွယ်နိုင်သည်။
- Database၊ Authentication၊ Tenant Isolation နှင့် ငွေစာရင်းဆိုင်ရာပြောင်းလဲမှုများကို Production မတင်မီ Build/Test အပြည့်အစုံ စစ်ဆေးရမည်။
- `.env`, Password, API Key, Firebase Private Key, Database Dump နှင့် Production Customer Data များကို GitHub တွင် မတင်ရပါ။

## Contribution and security

Before opening a pull request:

1. Create a dedicated feature/fix branch.
2. Keep all database queries tenant-scoped.
3. Do not change accounting formulas without regression tests.
4. Run Prisma generation, focused checks, and the production build.
5. Never include secrets, production data, uploads, backups, `node_modules`, or `dist`.
6. Open a Draft PR and deploy only after review and VPS verification.

## Version history

- `1.0.1` — Multi Shop current clean baseline with PostgreSQL, responsive POS, Money Service, Online Shop, Myanmar/English UI, and tenant-safe APIs.
