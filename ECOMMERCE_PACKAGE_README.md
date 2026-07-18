# Mahar E-commerce Storefront Package

This package contains the complete source used by:

`https://maharshwe.shop/shop/maharshwemobile`

## Included

- Public storefront UI, responsive styles and PWA service worker
- Google customer login and persistent customer sessions
- Product browsing, search, filters, details, favourites and cart
- Checkout, COD/pickup, order history and profile
- Store settings and product image management UI
- Tenant-safe storefront backend API
- Prisma models and all e-commerce migrations
- Storefront logos and fallback product image

## Required environment

```env
DATABASE_URL=
GOOGLE_CLIENT_ID=648689584934-kbfljosfdkui7phmiq9k9o3dfl9un0ql.apps.googleusercontent.com
CUSTOMER_SESSION_SECRET=
```

Telegram variables are optional and are used only for shop support/order notifications. Customer login uses Google.

## Setup

```bash
npm install
npm run db:generate
npm run db:deploy
npm run build
```

The Express application must attach `server/ecommerce-storefront-api.js`. The existing Mahar POS server entry in this package shows the integration point.

Never commit production `.env`, database dumps, private keys or service-account files.
