# Mahar POS

**ဖုန်းဆိုင်၊ ဖုန်းပြင်ဆိုင်နှင့် လက်လီအရောင်းဆိုင်များအတွက် Lifetime Free
Multi-tenant POS နှင့် လုပ်ငန်းစီမံခန့်ခွဲမှုစနစ်**

[Live POS](https://app.maharshwe.shop) |
[Landing Page](https://maharshwe.shop) |
[Latest Release](https://github.com/maharshwemobile-lgtm/maharshwe-pos-multishop/releases/latest) |
[Production Restore Prompt](docs/ONE_SHOT_CURRENT_PRODUCTION_RESTORE_PROMPT.md)

Mahar POS သည် အရောင်း၊ ပစ္စည်းနှင့် လက်ကျန်၊ ဖုန်းပြင်၊ ဖောက်သည်အကြွေး၊
ငွေလွှဲဝန်ဆောင်မှု၊ Bill/Eload၊ အခြားဝင်ငွေ/ထွက်ငွေနှင့် Online Shop များကို
တစ်နေရာတည်းတွင် စီမံနိုင်သော Web POS ဖြစ်ပါတယ်။ ဆိုင်တစ်ဆိုင်ချင်းစီ၏ Data ကို
PostgreSQL Database တွင် သီးသန့်ခွဲထားပြီး Desktop၊ Tablet နှင့် Mobile Browser
များတွင် အသုံးပြုနိုင်ပါတယ်။

English: Mahar POS is a lifetime-free, multi-tenant POS and business-management
web application for mobile shops, repair shops, and retail businesses. Every
shop has an isolated PostgreSQL workspace with tenant-safe APIs.

## Lifetime Free Plan

- အခြေခံ POS လုပ်ဆောင်ချက်များကို သက်တမ်းအကန့်အသတ်မရှိ အခမဲ့အသုံးပြုနိုင်ပါတယ်။
- Credit Card ထည့်ရန်မလိုပါ။
- ဆိုင်၏ Product၊ Stock၊ Sale နှင့် Customer Data များကို PostgreSQL တွင်
  သီးသန့်သိမ်းဆည်းထားပါတယ်။
- Premium သို့မဟုတ် အထူးလုပ်ဆောင်ချက်များသည် သတ်မှတ်ထားသော Plan နှင့်
  Permission အလိုက် ဖွင့်ပေးနိုင်ပါတယ်။

## အဓိကလုပ်ဆောင်ချက်များ

- **Sale POS** - Product Search၊ Camera Barcode Scanner၊ Compact Cart၊
  Discount၊ Single/Split/Credit Payment၊ Receipt Print နှင့် Reprint
- **Products & Stock** - Category၊ Brand၊ Model၊ Variant၊ SKU၊ Barcode၊
  Stock Movement၊ Low-stock Alert၊ Import/Export နှင့် Product Image
- **Phone Repair** - Repair Intake၊ IMEI/Serial၊ Status History၊ Parts၊
  Cost/Profit၊ Voucher၊ Pickup၊ Warranty နှင့် Customer Portal
- **Customers & Credit** - ဖောက်သည်စာရင်း၊ အကြွေးရရန်၊ Manual Debt၊
  Repayment နှင့် Debt History
- **Money Service** - Money Transfer၊ Cash Out၊ Wallet/Account၊ Fee၊ History၊
  Export နှင့် Void/Balance Reversal
- **Bill / Eload** - Opening၊ Refill၊ Sold၊ Adjustment၊ Closing Balance၊
  Custom Formula နှင့် Biller History
- **Finance & Accounts** - Cash၊ Bank၊ Wallet၊ Payment Method Link၊
  Account Transfer နှင့် Balance Adjustment
- **Other Income & Expense** - Category၊ Account Impact၊ Edit၊ Void၊
  Date Filter နှင့် Export
- **Reports** - Daily၊ Monthly၊ Yearly၊ Product Profit၊ Service Income၊
  Money Service၊ Bill/Eload နှင့် Expense Report
- **Purchasing** - Supplier၊ Purchase Order၊ Approval၊ Goods Receiving၊
  Payable၊ Return နှင့် Purchasing Report
- **Online Shop** - ဆိုင်တစ်ဆိုင်ချင်းစီအတွက် Product Images၊ Cart၊
  COD/Pickup၊ Order Management၊ Google Customer Login နှင့် PWA
- **Users & Permissions** - Owner၊ Shop Admin၊ Manager၊ Staff၊
  Permission နှင့် Tenant-safe Access
- **Google Sheet & Push** - Google Sheet Sync၊ In-app Notification နှင့်
  Firebase Web Push
- **Myanmar / English** - မြန်မာနှင့် အင်္ဂလိပ် Language ပြောင်းလဲအသုံးပြုနိုင်ခြင်း

## Data လုံခြုံရေး

- Shop တစ်ခုချင်းစီ၏ Data ကို `shopId` ဖြင့် PostgreSQL တွင် သီးသန့်ခွဲထားပါတယ်။
- Browser မှပေးပို့သော Tenant ID ကို တိုက်ရိုက်မယုံဘဲ Authenticated User နှင့်
  Shop Membership ကို API Server ဘက်တွင် စစ်ဆေးပါတယ်။
- Product၊ Stock၊ Sale၊ Payment၊ Repair၊ Credit၊ Money Account၊ Report၊
  Online Order နှင့် Notification များအားလုံး Tenant-scoped ဖြစ်ပါတယ်။
- Sale၊ Stock၊ Payment၊ Credit နှင့် Account ပြောင်းလဲမှုများကို PostgreSQL
  Transaction ဖြင့် အတူတကွ အပြီးလုပ်ဆောင်ပါတယ်။
- Save၊ Edit၊ Void၊ Stock Adjustment၊ User Management နှင့် Admin
  လုပ်ဆောင်ချက်များကို Audit Log မှတ်တမ်းတင်ပါတယ်။
- `.env`, Password, API Key, Firebase Private Key, Database Dump နှင့်
  Production Customer Data များကို GitHub တွင် မတင်ရပါ။

## Production Apps

| Service | URL |
| --- | --- |
| POS Web App | [app.maharshwe.shop](https://app.maharshwe.shop) |
| Landing Page | [maharshwe.shop](https://maharshwe.shop) |
| Shop Admin Portal | [admin.maharshwe.shop](https://admin.maharshwe.shop) |
| API Health | [api.maharshwe.shop/health](https://api.maharshwe.shop/health) |

## Developer

<img src="https://raw.githubusercontent.com/maharshwemobile-lgtm/wallet-note-multitenant/main/public/khun-myint-aung.jpg" alt="Khun Myint Aung" width="180">

| အချက်အလက် | အသေးစိတ် |
| --- | --- |
| Developer | **Khun Myint Aung** |
| Organization | **Mahar Shwe Mobile** |
| Location | Hsisheng Township, Shan State, Taunggyi |
| Email | [maharshwemobile@gmail.com](mailto:maharshwemobile@gmail.com) |
| GitHub | [maharshwemobile-lgtm](https://github.com/maharshwemobile-lgtm) |
| Facebook | [My Choice My Life](https://www.facebook.com/Mychoicemylife2018) |
| Telegram | [@Mylifemychoice68](https://t.me/Mylifemychoice68) |
| Community | [Telegram Community](https://t.me/+2gc9ml7iMgk1ZThl) |
| TikTok | [@maharshwemobile](https://www.tiktok.com/@maharshwemobile) |
| Website | [maharshwe.online](https://maharshwe.online/) |

Mahar POS ကို မြန်မာနိုင်ငံရှိ ဖုန်းဆိုင်၊ ဖုန်းပြင်ဆိုင်နှင့် အသေးစားလုပ်ငန်းများ
အလွယ်တကူအသုံးပြုနိုင်ရန် တည်ဆောက်ထားပါတယ်။ Bug Report၊ အကြံပြုချက်နှင့်
အသုံးပြုနည်းမေးမြန်းမှုများကို Facebook၊ Email သို့မဟုတ် Telegram Community
မှတစ်ဆင့် ဆက်သွယ်နိုင်ပါတယ်။

## Technology

- React 18 and Vite
- Node.js and Express
- Prisma ORM
- PostgreSQL
- Google OAuth
- Firebase Cloud Messaging
- PWA and responsive web UI
- PM2/Nginx production deployment

## Local Development

လိုအပ်ချက်များ:

- Node.js 20 or newer
- npm
- PostgreSQL
- Git

```powershell
git clone https://github.com/maharshwemobile-lgtm/maharshwe-pos-multishop.git
cd maharshwe-pos-multishop
npm install --no-audit --no-fund
Copy-Item .env.example .env
```

`.env` ထဲတွင် Local Development အတွက် `DATABASE_URL`, Authentication Secret
နှင့် လိုအပ်သော Integration Configuration များကို ဖြည့်ပါ။ Production secret
များကို Local Development တွင် ပြန်မသုံးပါနှင့်။

```powershell
npm run db:generate
npm run db:deploy
npm run dev
```

## Quality Checks

```powershell
npm run db:generate
npm run check:phase23
npm run check:sales-v10
npm run check:phase10
npm run check:phase11
npm run check:phase12
npm run build
git diff --check
```

## Project Structure

```text
src/             React pages, POS components, UI and language runtime
server/          Express APIs, authentication, tenant and business logic
prisma/          PostgreSQL schema, migrations and seed
public/          Brand assets, PWA, storefront and service workers
integrations/    Google Apps Script and external integration files
scripts/         Build, backup, verification and deployment helpers
deploy/          Production deployment configuration
docs/            Recovery, functional and reusable project prompts
android-native/  Native Android Mahar POS client
```

## Production Recovery

Windows ပြန်တင်ခြင်း၊ Development PC ပြောင်းခြင်း သို့မဟုတ် VPS Project
ပြန်တည်ဆောက်ခြင်းအတွက် အောက်ပါ Prompt များကို အသုံးပြုနိုင်ပါတယ်။

- [One-Shot Current Production Restore](docs/ONE_SHOT_CURRENT_PRODUCTION_RESTORE_PROMPT.md)
- [Full Functional Rebuild Prompt](docs/MAHAR_POS_FULL_FUNCTIONAL_REBUILD_PROMPT_20260725.md)
- [Reusable Project for a New Owner](docs/REUSABLE_POS_PROJECT_FOR_NEW_OWNER_PROMPT.md)
- [Current Production Architecture](docs/MAHAR_POS_CURRENT_VERSION_PROMPT_20260725.md)

SSH Private Key၊ `.env`၊ Database URL၊ API Key၊ Password၊ Token၊ Production
Upload နှင့် Database Backup များကို GitHub ထဲ မတင်ပါနှင့်။

## Contribution

1. သီးသန့် Feature/Fix Branch တစ်ခုဖွင့်ပါ။
2. Database Query အားလုံးတွင် Tenant Isolation ကို ထိန်းသိမ်းပါ။
3. Accounting Formula ပြောင်းပါက Regression Test ထည့်ပါ။
4. Build နှင့် သက်ဆိုင်ရာ Phase Check များကို အောင်မြင်အောင်စစ်ပါ။
5. Draft Pull Request ဖွင့်ပြီး VPS Test အောင်မြင်မှ Merge/Deploy လုပ်ပါ။

## Version

- `v1.0.1` — Current Multi-Shop production baseline.

Copyright (c) 2026 Khun Myint Aung / Mahar Shwe Mobile.
