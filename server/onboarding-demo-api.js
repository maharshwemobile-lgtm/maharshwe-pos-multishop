const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');
const { cleanupDemoData, seedDemoDataForShop } = require('./onboarding-demo-cleanup');

const DEMO_CATEGORY_NAMES = ['Demo Phones', 'Demo Accessories'];
const DEMO_CUSTOMER_PHONE = '09999999999';
const DEMO_PAYMENT_METHODS = [
  { name: 'Demo Cash', code: 'DEMO_CASH', kind: 'CASH', accountType: 'CASH', supportsMoneyService: false, sortOrder: 10 },
  { name: 'Demo KPay', code: 'DEMO_KPAY', kind: 'WALLET', accountType: 'KPAY', supportsMoneyService: true, sortOrder: 20 },
  { name: 'Demo Bank', code: 'DEMO_BANK', kind: 'BANK', accountType: 'OTHER', supportsMoneyService: false, sortOrder: 30 },
  { name: 'Demo Credit', code: 'DEMO_CREDIT', kind: 'OTHER', accountType: 'OTHER', supportsMoneyService: false, sortOrder: 40 },
];

function canManageDemo(req, res, next) {
  const role = req.auth?.role;
  const permissions = req.auth?.permissions || {};
  if (role === 'SUPER_ADMIN' || role === 'SHOP_ADMIN' || permissions.inventory === true) return next();
  return res.status(403).json({ ok: false, message: 'Demo data ကို Shop Admin သို့ Inventory permission ရှိသူသာ စီမံနိုင်ပါသည်။' });
}

function money(value) {
  return new Prisma.Decimal(value || 0);
}

async function seedPaymentMethods(tx, req) {
  let count = 0;
  for (const method of DEMO_PAYMENT_METHODS) {
    const existing = await tx.$queryRawUnsafe(
      'SELECT id FROM finance_payment_methods WHERE shop_id=$1::uuid AND LOWER(code)=LOWER($2) LIMIT 1',
      req.auth.shopId,
      method.code,
    );
    if (existing[0]) continue;

    const account = await tx.moneyAccount.create({
      data: {
        shopId: req.auth.shopId,
        name: method.name,
        type: method.accountType,
        balance: 0,
        active: true,
      },
    });
    const paymentMethodId = crypto.randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO finance_payment_methods(id,shop_id,name,code,kind,account_id,supports_money_service,active,sort_order,created_by_id,created_at,updated_at)
       VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7,TRUE,$8,$9::uuid,NOW(),NOW())`,
      paymentMethodId,
      req.auth.shopId,
      method.name,
      method.code,
      method.kind,
      account.id,
      method.supportsMoneyService,
      method.sortOrder,
      req.auth.userId,
    );
    count += 1;
  }
  return count;
}

async function seedDemoData(req) {
  const shopId = req.auth.shopId;
  return prisma.$transaction(async (tx) => {
    const categories = {};
    for (const item of [
      { name: 'Demo Phones', kind: 'Phone' },
      { name: 'Demo Accessories', kind: 'Accessories' },
    ]) {
      categories[item.name] = await tx.category.upsert({
        where: { shopId_name: { shopId, name: item.name } },
        update: { kind: item.kind, active: true },
        create: { shopId, name: item.name, kind: item.kind, active: true },
      });
    }

    const demoProducts = [
      {
        category: categories['Demo Phones'],
        name: 'Demo iPhone 13',
        brand: 'Demo',
        model: 'iPhone 13',
        productType: 'Phone',
        groupName: 'Demo Phone',
        variant: { variantName: '128GB / Midnight', sku: 'DEMO-IP13-128-MID', barcode: 'DEMO0001', storage: '128GB', color: 'Midnight', costPrice: 1250000, standardSellingPrice: 1380000, minimumSellingPrice: 1320000, initialQuantity: 3, minAlertQuantity: 1 },
      },
      {
        category: categories['Demo Accessories'],
        name: 'Demo Fast Charger',
        brand: 'Demo',
        model: '20W USB-C',
        productType: 'Accessories',
        groupName: 'Demo Accessories',
        variant: { variantName: '20W White', sku: 'DEMO-CHARGER-20W', barcode: 'DEMO0002', color: 'White', costPrice: 12000, standardSellingPrice: 18000, minimumSellingPrice: 15000, initialQuantity: 10, minAlertQuantity: 2 },
      },
    ];

    let productCount = 0;
    for (const item of demoProducts) {
      let product = await tx.product.findFirst({ where: { shopId, name: item.name } });
      if (!product) {
        product = await tx.product.create({
          data: { shopId, categoryId: item.category.id, groupName: item.groupName, name: item.name, brand: item.brand, model: item.model, productType: item.productType, active: true },
        });
        productCount += 1;
      } else {
        await tx.product.update({ where: { id: product.id }, data: { categoryId: item.category.id, active: true } });
      }

      let variant = await tx.productVariant.findFirst({ where: { shopId, sku: item.variant.sku } });
      if (!variant) {
        variant = await tx.productVariant.create({
          data: {
            shopId,
            productId: product.id,
            categoryId: item.category.id,
            variantName: item.variant.variantName,
            sku: item.variant.sku,
            barcode: item.variant.barcode,
            storage: item.variant.storage || null,
            color: item.variant.color || null,
            costPrice: money(item.variant.costPrice),
            standardSellingPrice: money(item.variant.standardSellingPrice),
            minimumSellingPrice: money(item.variant.minimumSellingPrice),
            active: true,
          },
        });
        await tx.inventoryBalance.create({ data: { shopId, productVariantId: variant.id, quantity: item.variant.initialQuantity, minAlertQuantity: item.variant.minAlertQuantity } });
        await tx.stockMovement.create({ data: { shopId, productVariantId: variant.id, type: 'STOCK_IN', quantityChange: item.variant.initialQuantity, beforeQuantity: 0, afterQuantity: item.variant.initialQuantity, referenceType: 'DEMO_OPENING_STOCK', userId: req.auth.userId, note: 'Demo opening stock' } });
      } else {
        await tx.productVariant.update({ where: { id: variant.id }, data: { productId: product.id, categoryId: item.category.id, active: true } });
        await tx.inventoryBalance.upsert({ where: { productVariantId: variant.id }, update: { quantity: item.variant.initialQuantity, minAlertQuantity: item.variant.minAlertQuantity }, create: { shopId, productVariantId: variant.id, quantity: item.variant.initialQuantity, minAlertQuantity: item.variant.minAlertQuantity } });
      }
    }

    const customer = await tx.customer.findFirst({ where: { shopId, phone: DEMO_CUSTOMER_PHONE } });
    if (!customer) await tx.customer.create({ data: { shopId, name: 'Demo Customer', phone: DEMO_CUSTOMER_PHONE, address: 'Demo address', balance: 0 } });

    const paymentMethods = await seedPaymentMethods(tx, req);

    await tx.auditLog.create({ data: { shopId, userId: req.auth.userId, action: 'DEMO_DATA_SEEDED', entityType: 'onboarding_demo', details: { products: productCount, paymentMethods } } });
    return { products: productCount, categories: Object.keys(categories).length, customers: customer ? 0 : 1, paymentMethods };
  });
}

function attachOnboardingDemoApi(app) {
  const guard = [requireAuth, requireShopUser, requireWritableSubscription, canManageDemo];

  app.post('/api/onboarding/demo-data', ...guard, async (req, res) => {
    try {
      await cleanupDemoData(req.auth.shopId);
      const result = await seedDemoDataForShop({ shopId: req.auth.shopId, userId: req.auth.userId });
      res.json({ ok: true, message: 'Demo data ထည့်ပြီးပါပြီ', result });
    } catch (error) {
      console.error('Demo seed failed:', error);
      res.status(500).json({ ok: false, message: error.message || 'Demo data ထည့်မရပါ' });
    }
  });

  app.delete('/api/onboarding/demo-data', ...guard, async (req, res) => {
    try {
      const result = await cleanupDemoData(req.auth.shopId);
      res.json({ ok: true, message: 'Demo data အကုန်ဖျက်ပြီးပါပြီ', result });
    } catch (error) {
      console.error('Demo cleanup failed:', error);
      res.status(500).json({ ok: false, message: error.message || 'Demo data ဖျက်မရပါ' });
    }
  });
}

module.exports = attachOnboardingDemoApi;
