const { prisma } = require('./prisma');

const PUBLIC_GUIDES = [
  {
    slug: 'register-google-login',
    category: 'start',
    categoryLabel: 'စတင်ခြင်း',
    title: 'Account ဖွင့်ပြီး Login ဝင်နည်း',
    description: 'Email/Password သို့မဟုတ် Google ဖြင့် Account ဖွင့်ပြီး ၁ လ Trial စတင်အသုံးပြုနည်း။',
    steps: ['app.maharshwe.shop ကိုဖွင့်ပါ', 'Register ကိုနှိပ်ပြီး Email သို့မဟုတ် Google ဖြင့်ဝင်ပါ', 'Shop name နှင့် Business type ဖြည့်ပါ', 'Dashboard ပေါ်လာလျှင် Trial စတင်အသုံးပြုနိုင်ပါပြီ'],
  },
  {
    slug: 'business-profile-setup',
    category: 'start',
    categoryLabel: 'စတင်ခြင်း',
    title: 'Business Profile / Logo ပြင်နည်း',
    description: 'ဆိုင်အမည်၊ Logo၊ Receipt header/footer၊ Currency နှင့် Language ကို Project Settings မှ ပြင်နည်း။',
    steps: ['Settings > Business Profile ကိုဝင်ပါ', 'ဆိုင်အမည်၊ ဖုန်း၊ လိပ်စာ၊ Logo ဖြည့်ပါ', 'Receipt header/footer ကိုလိုသလိုပြင်ပါ', 'Save နှိပ်ပြီး Sale POS slip မှာ ပြန်စစ်ပါ'],
  },
  {
    slug: 'products-stock-setup',
    category: 'manage',
    categoryLabel: 'စီမံခန့်ခွဲမှု',
    title: 'Product, Barcode, Stock ထည့်နည်း',
    description: 'Product, Variant, Category, Barcode, Cost/Selling price, Opening stock နှင့် Low stock alert သတ်မှတ်နည်း။',
    steps: ['Products ကိုဝင်ပါ', 'Add Product နှိပ်ပြီး Category/Name/Barcode ဖြည့်ပါ', 'Cost price, Selling price, Opening stock ထည့်ပါ', 'Low stock alert ထားပြီး Save ပါ'],
  },
  {
    slug: 'sale-pos-checkout',
    category: 'pos',
    categoryLabel: 'POS',
    title: 'Sale POS ရောင်းချနည်း',
    description: 'ပစ္စည်းရှာ၊ Cart ထည့်၊ Qty/Discount ပြင်၊ Wallet payment ရွေးပြီး Voucher ထုတ်နည်း။',
    steps: ['Sale POS ကိုဝင်ပါ', 'Product / Barcode ဖြင့်ရှာပြီး Cart ထည့်ပါ', 'Qty, discount, customer name လိုသလိုပြင်ပါ', 'Payment method ရွေးပြီး Complete Sale နှိပ်ပါ'],
  },
  {
    slug: 'sales-history-void-reprint',
    category: 'pos',
    categoryLabel: 'POS',
    title: 'Sales History, Reprint, Void အသုံးပြုနည်း',
    description: 'အရောင်းမှတ်တမ်း ရှာဖွေခြင်း၊ Voucher ပြန်ထုတ်ခြင်း၊ မှားရောင်းထားသည့် Sale ကို Void လုပ်နည်း။',
    steps: ['Sales History ကိုဝင်ပါ', 'Invoice, customer, date ဖြင့်ရှာပါ', 'View / Reprint ဖြင့် slip ပြန်ထုတ်ပါ', 'မှားယွင်းပါက Void ကို reason ဖြင့်လုပ်ပါ'],
  },
  {
    slug: 'repair-service-flow',
    category: 'pos',
    categoryLabel: 'POS',
    title: 'Phone Repair Service အသုံးပြုနည်း',
    description: 'Repair job အသစ်လက်ခံ၊ Status ပြောင်း၊ Payment မှတ်၊ Voucher ထုတ်၊ device history စစ်နည်း။',
    steps: ['Repairs ကိုဝင်ပြီး Add Repair နှိပ်ပါ', 'Customer, device brand/model, problem ဖြည့်ပါ', 'Status ကို Received → In Progress → Completed ပြောင်းပါ', 'Payment မှတ်ပြီး Repair Voucher ထုတ်ပါ'],
  },
  {
    slug: 'money-service-transfer',
    category: 'pos',
    categoryLabel: 'POS',
    title: 'Money Service / ငွေလွှဲဝန်ဆောင်မှု',
    description: 'KPay/Wave/Cash In/Cash Out စာရင်း၊ Fee၊ Wallet balance နှင့် transfer history မှတ်နည်း။',
    steps: ['Money Service ကိုဝင်ပါ', 'Transfer / Cash Out အမျိုးအစားရွေးပါ', 'Wallet, amount, fee, status ဖြည့်ပါ', 'Save ပြီး history နှင့် wallet balance စစ်ပါ'],
  },
  {
    slug: 'bill-eload-flow',
    category: 'pos',
    categoryLabel: 'POS',
    title: 'Bill / Eload Balance အသုံးပြုနည်း',
    description: 'Biller opening balance, refill, sold, adjustment နှင့် closing balance ကို သပ်သပ် report ထုတ်နည်း။',
    steps: ['Money Service > Bill / Eload ကိုဝင်ပါ', 'Biller setup ထည့်ပါ', 'ရောင်းလျှင် Sold မှတ်ပြီး balance လျော့ပါမည်', 'Refill/Adjustment ဖြင့် closing balance ပြန်ညှိပါ'],
  },
  {
    slug: 'customer-credit-debt',
    category: 'manage',
    categoryLabel: 'စီမံခန့်ခွဲမှု',
    title: 'Customer Credit / Debt မှတ်နည်း',
    description: 'ဖောက်သည်ရရန်အကြွေး၊ ပြန်ဆပ်ငွေ၊ Supplier ပေးရန်အကြွေးနှင့် debt history ကြည့်နည်း။',
    steps: ['Customers ကိုဝင်ပါ', 'Customer အသစ်ထည့် သို့မဟုတ် ရှိပြီးသားကို Edit လုပ်ပါ', 'Debt / Collect ဖြင့် အကြွေးယူ/ဆပ် မှတ်ပါ', 'History မှာ ရက်စွဲနှင့် balance ပြန်စစ်ပါ'],
  },
  {
    slug: 'other-income-expense',
    category: 'manage',
    categoryLabel: 'စီမံခန့်ခွဲမှု',
    title: 'အခြားဝင်ငွေ / ထွက်ငွေ မှတ်နည်း',
    description: 'Other sale/service/top-up/other income နှင့် expense category များကို wallet နှင့်ချိတ်မှတ်နည်း။',
    steps: ['အခြားဝင်ငွေ နှင့်ထွက်ငွေ ကိုဝင်ပါ', 'Income သို့မဟုတ် Expense ရွေးပါ', 'Category, wallet, amount, note ဖြည့်ပါ', 'History/Edit/Export မှ ပြန်စစ်ပါ'],
  },
  {
    slug: 'daily-close-report',
    category: 'manage',
    categoryLabel: 'စီမံခန့်ခွဲမှု',
    title: 'Daily Close / Reports အသုံးပြုနည်း',
    description: 'Daily, Monthly, Yearly report များတွင် Product Sales, Service, Money Service, Bill/Eload, Expense ခွဲကြည့်နည်း။',
    steps: ['Reports & Performance ကိုဝင်ပါ', 'Daily / Monthly / Yearly ရွေးပါ', 'Income/Expense/Profit sections ကိုစစ်ပါ', 'လိုအပ်လျှင် Excel/CSV export ထုတ်ပါ'],
  },
  {
    slug: 'google-sheet-sync',
    category: 'manage',
    categoryLabel: 'စီမံခန့်ခွဲမှု',
    title: 'Google Sheet Sync ချိတ်နည်း',
    description: 'Project Settings မှ Apps Script code copy လုပ်ပြီး Sheet Web App URL ချိတ်၍ report/data pull လုပ်နည်း။',
    steps: ['Settings > Google Sheet ကိုဝင်ပါ', 'Apps Script Code ကို Copy လုပ်ပါ', 'Google Sheet > Extensions > Apps Script မှာ paste/deploy လုပ်ပါ', 'Web App URL ကို POS မှာ Save/Test လုပ်ပါ'],
  },
  {
    slug: 'staff-permission',
    category: 'manage',
    categoryLabel: 'စီမံခန့်ခွဲမှု',
    title: 'Staff Role & Permission သတ်မှတ်နည်း',
    description: 'ဝန်ထမ်း account ဖန်တီး၊ password reset၊ Role/Permission ခွဲခြားသတ်မှတ်နည်း။',
    steps: ['Admin/Settings ထဲမှ Staff section ကိုဝင်ပါ', 'Create User ဖြင့် user ထည့်ပါ', 'Role နှင့် permission ရွေးပါ', 'လိုအပ်လျှင် Password Reset လုပ်ပါ'],
  },
  {
    slug: 'mini-mart-purchasing',
    category: 'manage',
    categoryLabel: 'စီမံခန့်ခွဲမှု',
    title: 'Mini Mart Purchasing Flow',
    description: 'Supplier, Purchase Order, Receive Stock, Supplier Payment/Return နှင့် purchasing report ကို တစ်နေရာတည်းမှာ အသုံးပြုနည်း။',
    steps: ['Purchases ကိုဝင်ပါ', 'Supplier ထည့်ပြီး Purchase Order ဖန်တီးပါ', 'Receive Stock ဖြင့် stock လက်ခံပါ', 'Pay / Return နှင့် Reports မှ စာရင်းရှင်းပါ'],
  },
  {
    slug: 'backup-restore',
    category: 'start',
    categoryLabel: 'စတင်ခြင်း',
    title: 'Backup / Restore သိထားရန်',
    description: 'Cloud backup status စစ်ခြင်း၊ backup download နှင့် restore မလုပ်မီ သတိထားရမည့်အချက်များ။',
    steps: ['Backup page မှ latest backup status စစ်ပါ', 'Download ရလျှင် file သိမ်းထားပါ', 'Restore မလုပ်မီ current DB backup ယူပါ', 'Production restore ကို admin approval ဖြင့်သာလုပ်ပါ'],
  },
];

const cache = new Map();
const ttlMs = 45_000;

function getCached(key) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  cache.delete(key);
  return null;
}

function setCached(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function safeCount(model, args = {}) {
  try {
    if (!prisma[model]?.count) return 0;
    return await prisma[model].count(args);
  } catch (_error) {
    return 0;
  }
}

function normalizeBusinessType(value) {
  return String(value || 'PHONE_SHOP')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeShopLocation(address) {
  const text = String(address || '').trim();
  if (!text) return '';
  return text.split(/[,၊\n]/).map((part) => part.trim()).filter(Boolean).slice(0, 2).join(', ');
}

function attachPublicLandingApi(app) {
  app.get('/api/public/stats', async (_req, res) => {
    try {
      const cached = getCached('stats');
      if (cached) return res.json(cached);
      const now = new Date();
      const [registeredShops, activeShops, users, products, sales, repairs, trialSubs, activeSubs, recentClosings] = await Promise.all([
        safeCount('shop'),
        safeCount('shop', { where: { active: true } }),
        safeCount('user', { where: { active: true } }),
        safeCount('product', { where: { active: true } }),
        safeCount('sale', { where: { status: { not: 'VOIDED' } } }),
        safeCount('repair'),
        prisma.subscription?.findMany ? prisma.subscription.findMany({ where: { status: 'TRIAL', endsAt: { gte: now } }, select: { shopId: true }, distinct: ['shopId'] }).catch(() => []) : [],
        prisma.subscription?.findMany ? prisma.subscription.findMany({ where: { status: 'ACTIVE', endsAt: { gte: now } }, select: { shopId: true }, distinct: ['shopId'] }).catch(() => []) : [],
        prisma.dailyClosing?.count ? prisma.dailyClosing.count().catch(() => 0) : 0,
      ]);
      const addresses = prisma.shop?.findMany
        ? await prisma.shop.findMany({ where: { active: true, address: { not: null } }, select: { address: true }, take: 500 }).catch(() => [])
        : [];
      const locations = new Set(addresses.map((row) => safeShopLocation(row.address)).filter(Boolean)).size;
      const payload = setCached('stats', {
        ok: true,
        activeShops,
        trialShops: trialSubs.length,
        paidShops: activeSubs.length,
        registeredShops,
        users,
        products,
        sales,
        repairs,
        dailyClosings: recentClosings,
        locations,
        updatedAt: new Date().toISOString(),
      });
      res.set('Cache-Control', 'public, max-age=45');
      return res.json(payload);
    } catch (error) {
      console.error('public stats failed:', error);
      return res.status(500).json({ ok: false, message: 'Unable to load public stats' });
    }
  });

  app.get('/api/public/active-users', async (req, res) => {
    try {
      const limit = Math.min(10, Math.max(1, Number.parseInt(req.query.limit, 10) || 4));
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await prisma.$queryRaw`
        WITH login_stats AS (
          SELECT shop_id, COUNT(*)::int AS login_count, MAX(created_at) AS last_audit_at
          FROM audit_logs
          WHERE shop_id IS NOT NULL
            AND action IN ('LOGIN_SUCCESS', 'GOOGLE_LOGIN_SUCCESS')
            AND created_at >= ${since}
          GROUP BY shop_id
        ), user_stats AS (
          SELECT shop_id, MAX(last_login_at) AS last_login_at
          FROM users
          WHERE shop_id IS NOT NULL AND active = TRUE AND last_login_at IS NOT NULL
          GROUP BY shop_id
        )
        SELECT s.id, s.name,
          COALESCE(l.login_count, 0)::int AS "loginCount",
          GREATEST(l.last_audit_at, u.last_login_at) AS "lastActiveAt"
        FROM shops s
        LEFT JOIN login_stats l ON l.shop_id = s.id
        LEFT JOIN user_stats u ON u.shop_id = s.id
        WHERE s.active = TRUE AND (l.login_count > 0 OR u.last_login_at IS NOT NULL)
        ORDER BY COALESCE(l.login_count, 0) DESC,
          GREATEST(l.last_audit_at, u.last_login_at) DESC NULLS LAST
        LIMIT ${limit}
      `;
      res.set('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        periodDays: 30,
        updatedAt: new Date().toISOString(),
        users: rows.map((row) => ({
          shopId: row.id,
          displayName: row.name,
          loginCount: Number(row.loginCount || 0),
          lastActiveAt: row.lastActiveAt ? new Date(row.lastActiveAt).toISOString() : null,
        })),
      });
    } catch (error) {
      console.error('public active users failed:', error);
      return res.status(500).json({ ok: false, message: 'Unable to load active users' });
    }
  });
  app.get('/api/public/shops/active', async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(24, Math.max(1, Number.parseInt(req.query.limit, 10) || 12));
      const search = String(req.query.search || '').trim();
      const location = String(req.query.location || '').trim();
      const businessType = String(req.query.businessType || '').trim();
      const where = { active: true };
      if (search) where.name = { contains: search, mode: 'insensitive' };
      if (businessType) where.businessType = businessType.includes(' ') ? businessType.toUpperCase().replace(/\s+/g, '_') : businessType;
      const cacheKey = `shops:${page}:${limit}:${search}:${location}:${businessType}`;
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);
      const [totalRaw, rows] = await Promise.all([
        prisma.shop.count({ where }).catch(() => 0),
        prisma.shop.findMany({
          where,
          select: {
            id: true,
            slug: true,
            name: true,
            logoUrl: true,
            address: true,
            businessType: true,
            createdAt: true,
            _count: { select: { products: true, sales: true, users: true } },
          },
          orderBy: [{ createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }).catch(() => []),
      ]);
      let shops = rows.map((shop) => ({
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        logo: shop.logoUrl || '',
        location: safeShopLocation(shop.address),
        businessType: normalizeBusinessType(shop.businessType),
        description: `${shop._count?.products || 0} products · ${shop._count?.sales || 0} sales records`,
        verified: true,
        status: 'active',
      }));
      if (location) shops = shops.filter((shop) => shop.location === location);
      const payload = setCached(cacheKey, {
        ok: true,
        page,
        limit,
        total: location ? shops.length : totalRaw,
        shops,
        updatedAt: new Date().toISOString(),
      });
      res.set('Cache-Control', 'public, max-age=45');
      return res.json(payload);
    } catch (error) {
      console.error('public shops failed:', error);
      return res.status(500).json({ ok: false, message: 'Unable to load public shops' });
    }
  });

  app.get('/api/public/guides', (req, res) => {
    const category = String(req.query.category || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const limit = Math.min(60, Math.max(1, Number.parseInt(req.query.limit, 10) || PUBLIC_GUIDES.length));
    let guides = PUBLIC_GUIDES;
    if (category && category !== 'all') guides = guides.filter((guide) => guide.category === category);
    if (search) {
      guides = guides.filter((guide) => [guide.title, guide.description, ...(guide.steps || [])].join(' ').toLowerCase().includes(search));
    }
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({
      ok: true,
      total: guides.length,
      guides: guides.slice(0, limit),
    });
  });
}

module.exports = attachPublicLandingApi;
