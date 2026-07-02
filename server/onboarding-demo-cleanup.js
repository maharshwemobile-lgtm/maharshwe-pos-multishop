const { prisma } = require('./prisma');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEMO_CATEGORY_NAMES = ['Demo Phones', 'Demo Accessories', 'Demo Groceries', 'Demo Drinks', 'Demo Household'];
const DEMO_CUSTOMER_PHONE = '09999999999';
const DEMO_PAYMENT_METHODS = [
  { name: 'Demo Cash', code: 'DEMO_CASH', kind: 'CASH', accountType: 'CASH', supportsMoneyService: false, sortOrder: 10 },
  { name: 'Demo KPay', code: 'DEMO_KPAY', kind: 'WALLET', accountType: 'KPAY', supportsMoneyService: true, sortOrder: 20 },
  { name: 'Demo Bank', code: 'DEMO_BANK', kind: 'BANK', accountType: 'OTHER', supportsMoneyService: false, sortOrder: 30 },
  { name: 'Demo Credit', code: 'DEMO_CREDIT', kind: 'OTHER', accountType: 'OTHER', supportsMoneyService: false, sortOrder: 40 },
];

const PHONE_SHOP_DEMO_PRODUCTS = [
  ['Demo iPhone 13', 'Demo', 'iPhone 13', 'Phone', 'Demo Phones', '128GB / Midnight', 'DEMO-PHONE-IP13-128-MID', 'DEMO-PHONE-0001', '', '128GB', 'Midnight', '', null, 0, 1250000, 1380000, 1320000, 3, 1],
  ['Demo Samsung A15', 'Demo', 'Galaxy A15', 'Phone', 'Demo Phones', '8GB / 256GB / Blue', 'DEMO-PHONE-A15-256-BLU', 'DEMO-PHONE-0002', '8GB', '256GB', 'Blue', '', null, 0, 520000, 610000, 580000, 5, 2],
  ['Demo Redmi Note 13', 'Demo', 'Note 13', 'Phone', 'Demo Phones', '8GB / 128GB / Black', 'DEMO-PHONE-RN13-128-BLK', 'DEMO-PHONE-0003', '8GB', '128GB', 'Black', '', null, 0, 390000, 455000, 430000, 6, 2],
  ['Demo Oppo A58', 'Demo', 'A58', 'Phone', 'Demo Phones', '6GB / 128GB / Green', 'DEMO-PHONE-OPPO-A58-GRN', 'DEMO-PHONE-0004', '6GB', '128GB', 'Green', '', null, 0, 410000, 480000, 455000, 4, 1],
  ['Demo Vivo Y27', 'Demo', 'Y27', 'Phone', 'Demo Phones', '6GB / 128GB / Purple', 'DEMO-PHONE-VIVO-Y27-PUR', 'DEMO-PHONE-0005', '6GB', '128GB', 'Purple', '', null, 0, 420000, 490000, 465000, 4, 1],
  ['Demo Fast Charger', 'Demo', '20W USB-C', 'Accessories', 'Demo Accessories', '20W White', 'DEMO-PHONE-CHARGER-20W', 'DEMO-PHONE-0006', '', '', 'White', 'pcs', null, 16000, 12000, 18000, 15000, 10, 2],
  ['Demo Type-C Cable', 'Demo', '1M Cable', 'Accessories', 'Demo Accessories', '1M Black', 'DEMO-PHONE-CABLE-TC-1M', 'DEMO-PHONE-0007', '', '', 'Black', 'pcs', null, 6000, 3500, 7000, 5000, 20, 5],
  ['Demo Earphone', 'Demo', 'Wired Earphone', 'Accessories', 'Demo Accessories', '3.5mm White', 'DEMO-PHONE-EARPHONE-WHT', 'DEMO-PHONE-0008', '', '', 'White', 'pcs', null, 13000, 8000, 15000, 12000, 12, 3],
  ['Demo Phone Case', 'Demo', 'Clear Case', 'Accessories', 'Demo Accessories', 'Clear', 'DEMO-PHONE-CASE-CLEAR', 'DEMO-PHONE-0009', '', '', 'Clear', 'pcs', null, 5000, 2500, 6000, 4500, 25, 5],
  ['Demo Tempered Glass', 'Demo', 'Screen Protector', 'Accessories', 'Demo Accessories', 'Full Glue', 'DEMO-PHONE-GLASS-FULL', 'DEMO-PHONE-0010', '', '', 'Transparent', 'pcs', null, 4500, 1800, 5000, 3500, 30, 5],
];

const MINI_MART_DEMO_PRODUCTS = [
  ['Demo Rice Bag', 'Demo', 'Paw San 5kg', 'Grocery', 'Demo Groceries', '5kg Bag', 'DEMO-MART-RICE-5KG', 'DEMO-MART-0001', '', '', '', 'bag', null, 28500, 25000, 32000, 30000, 8, 2],
  ['Demo Cooking Oil', 'Demo', '1L Bottle', 'Grocery', 'Demo Groceries', '1L Bottle', 'DEMO-MART-OIL-1L', 'DEMO-MART-0002', '', '', '', 'bottle', '2027-01-31', 6500, 5200, 7800, 7200, 18, 4],
  ['Demo Instant Noodle', 'Demo', 'Chicken Pack', 'Grocery', 'Demo Groceries', 'Pack', 'DEMO-MART-NOODLE-PACK', 'DEMO-MART-0003', '', '', '', 'pack', '2026-11-30', 950, 650, 1200, 1000, 60, 15],
  ['Demo Milk Powder', 'Demo', '400g Tin', 'Grocery', 'Demo Groceries', '400g Tin', 'DEMO-MART-MILK-400G', 'DEMO-MART-0004', '', '', '', 'tin', '2027-04-30', 12500, 9800, 14500, 13500, 12, 3],
  ['Demo Biscuit', 'Demo', 'Family Pack', 'Grocery', 'Demo Groceries', 'Family Pack', 'DEMO-MART-BISCUIT-FAM', 'DEMO-MART-0005', '', '', '', 'pack', '2026-10-31', 1800, 1250, 2200, 2000, 35, 8],
  ['Demo Drinking Water', 'Demo', '1L Bottle', 'Drink', 'Demo Drinks', '1L Bottle', 'DEMO-MART-WATER-1L', 'DEMO-MART-0006', '', '', '', 'bottle', '2027-06-30', 500, 300, 700, 600, 48, 12],
  ['Demo Energy Drink', 'Demo', 'Can', 'Drink', 'Demo Drinks', 'Can', 'DEMO-MART-ENERGY-CAN', 'DEMO-MART-0007', '', '', '', 'can', '2027-03-31', 1300, 900, 1600, 1450, 24, 6],
  ['Demo Soft Drink', 'Demo', '500ml Bottle', 'Drink', 'Demo Drinks', '500ml Bottle', 'DEMO-MART-SOFTDRINK-500', 'DEMO-MART-0008', '', '', '', 'bottle', '2027-02-28', 900, 650, 1200, 1050, 36, 10],
  ['Demo Laundry Powder', 'Demo', '500g Pack', 'Household', 'Demo Household', '500g Pack', 'DEMO-MART-LAUNDRY-500G', 'DEMO-MART-0009', '', '', '', 'pack', '2027-05-31', 3500, 2600, 4200, 3800, 16, 4],
  ['Demo Dish Soap', 'Demo', '500ml Bottle', 'Household', 'Demo Household', '500ml Bottle', 'DEMO-MART-DISHSOAP-500', 'DEMO-MART-0010', '', '', '', 'bottle', '2027-05-31', 2200, 1600, 2800, 2500, 20, 5],
];

function demoProductsForBusinessType(value) {
  return String(value || '').toUpperCase() === 'MINI_MART' ? MINI_MART_DEMO_PRODUCTS : PHONE_SHOP_DEMO_PRODUCTS;
}


function uniq(items) {
  return [...new Set((items || []).filter(Boolean).map(String))];
}

function uuidArray(ids) {
  const safe = uniq(ids).filter((id) => UUID_RE.test(id));
  if (!safe.length) return 'ARRAY[]::uuid[]';
  return `ARRAY[${safe.map((id) => `'${id}'::uuid`).join(',')}]`;
}

function number(value) {
  return Number(value || 0);
}

async function tableExists(tx, table) {
  const rows = await tx.$queryRawUnsafe("SELECT to_regclass($1)::text AS name", `public.${table}`);
  return Boolean(rows?.[0]?.name);
}

async function optionalDelete(tx, table, sql, ...params) {
  if (!(await tableExists(tx, table))) return 0;
  try {
    return await tx.$executeRawUnsafe(sql, ...params);
  } catch (error) {
    console.warn(`Optional demo cleanup skipped for ${table}:`, error.message || error);
    return 0;
  }
}

async function cleanupDemoData(shopId) {
  if (!UUID_RE.test(String(shopId || ''))) throw new Error('Invalid shop id for demo cleanup');

  return prisma.$transaction(async (tx) => {
    const demoMethods = await tx.$queryRawUnsafe(
      `SELECT id,account_id AS "accountId"
         FROM finance_payment_methods
        WHERE shop_id=$1::uuid
          AND (code ILIKE 'DEMO_%' OR name ILIKE 'Demo %')`,
      shopId,
    ).catch(() => []);
    const demoMethodIds = uniq(demoMethods.map((item) => item.id));
    const demoAccountIds = uniq(demoMethods.map((item) => item.accountId));

    const demoVariants = await tx.productVariant.findMany({
      where: {
        shopId,
        OR: [
          { sku: { startsWith: 'DEMO-' } },
          { barcode: { startsWith: 'DEMO' } },
          { product: { name: { startsWith: 'Demo ' } } },
          { product: { brand: 'Demo' } },
        ],
      },
      select: { id: true, productId: true },
    });
    const variantIds = uniq(demoVariants.map((item) => item.id));
    const productIds = uniq(demoVariants.map((item) => item.productId));

    const demoCustomers = await tx.customer.findMany({
      where: {
        shopId,
        OR: [{ name: { startsWith: 'Demo ' } }, { phone: DEMO_CUSTOMER_PHONE }],
      },
      select: { id: true },
    });
    const customerIds = uniq(demoCustomers.map((item) => item.id));

    const saleItemRows = await tx.saleItem.findMany({
      where: {
        shopId,
        OR: [
          { productNameSnapshot: { startsWith: 'Demo ' } },
          ...(variantIds.length ? [{ productVariantId: { in: variantIds } }] : []),
        ],
      },
      select: { saleId: true },
    });

    const customerSaleRows = customerIds.length ? await tx.sale.findMany({
      where: { shopId, customerId: { in: customerIds } },
      select: { id: true },
    }) : [];

    const invoiceSaleRows = await tx.sale.findMany({
      where: {
        shopId,
        OR: [
          { invoiceNumber: { startsWith: 'DEMO' } },
          { invoiceNumber: { startsWith: 'Demo' } },
        ],
      },
      select: { id: true },
    });

    const paymentSaleRows = await tx.$queryRawUnsafe(
      `SELECT DISTINCT sale_id AS "saleId"
         FROM payments
        WHERE shop_id=$1::uuid
          AND (
            payment_method_id = ANY(${uuidArray(demoMethodIds)})
            OR payment_method_name_snapshot ILIKE 'Demo %'
            OR reference ILIKE 'DEMO%'
            OR reference ILIKE '%Demo%'
          )`,
      shopId,
    ).catch(() => []);

    const saleIds = uniq([
      ...saleItemRows.map((item) => item.saleId),
      ...customerSaleRows.map((item) => item.id),
      ...invoiceSaleRows.map((item) => item.id),
      ...paymentSaleRows.map((item) => item.saleId),
    ]);

    let accountReversed = 0;
    if (saleIds.length) {
      const adjustments = await tx.$queryRawUnsafe(
        `SELECT m.account_id AS "accountId",COALESCE(SUM(p.amount),0) AS amount
           FROM payments p
           JOIN finance_payment_methods m ON m.id=p.payment_method_id
          WHERE p.shop_id=$1::uuid
            AND p.sale_id = ANY(${uuidArray(saleIds)})
            AND p.status='PAID'
            AND m.account_id IS NOT NULL
          GROUP BY m.account_id`,
        shopId,
      ).catch(() => []);
      for (const row of adjustments) {
        await tx.moneyAccount.updateMany({
          where: { shopId, id: row.accountId },
          data: { balance: { decrement: row.amount } },
        });
        accountReversed += number(row.amount);
      }
    }

    const moneyV2Rows = await tx.$queryRawUnsafe(
      `SELECT id
         FROM money_service_transactions_v2
        WHERE shop_id=$1::uuid
          AND (
            payment_method_id = ANY(${uuidArray(demoMethodIds)})
            OR cash_account_id = ANY(${uuidArray(demoAccountIds)})
            OR wallet_account_id = ANY(${uuidArray(demoAccountIds)})
            OR transaction_number ILIKE 'DEMO%'
            OR reference ILIKE '%Demo%'
            OR note ILIKE '%Demo%'
            OR sender_name ILIKE 'Demo %'
            OR receiver_name ILIKE 'Demo %'
            OR withdrawer_name ILIKE 'Demo %'
            OR sender_phone=$2
            OR receiver_phone=$2
            OR withdrawer_phone=$2
          )`,
      shopId,
      DEMO_CUSTOMER_PHONE,
    ).catch(() => []);
    const moneyV2Ids = uniq(moneyV2Rows.map((item) => item.id));

    let moneyServiceV2Payments = 0;
    let moneyServiceV2 = 0;
    if (moneyV2Ids.length) {
      moneyServiceV2Payments = await tx.$executeRawUnsafe(
        `DELETE FROM money_service_payments_v2
          WHERE shop_id=$1::uuid
            AND transaction_id = ANY(${uuidArray(moneyV2Ids)})`,
        shopId,
      ).catch(() => 0);
      moneyServiceV2 = await tx.$executeRawUnsafe(
        `DELETE FROM money_service_transactions_v2
          WHERE shop_id=$1::uuid
            AND id = ANY(${uuidArray(moneyV2Ids)})`,
        shopId,
      ).catch(() => 0);
    }

    const legacyMoneyService = await tx.moneyServiceTransaction.deleteMany({
      where: {
        shopId,
        OR: [
          ...(demoAccountIds.length ? [{ accountId: { in: demoAccountIds } }] : []),
          { note: { contains: 'Demo' } },
          { note: { contains: 'DEMO' } },
        ],
      },
    });

    await optionalDelete(tx, 'business_incomes',
      `DELETE FROM business_incomes
        WHERE shop_id=$1::uuid
          AND (money_account_id = ANY(${uuidArray(demoAccountIds)}) OR source ILIKE '%Demo%' OR note ILIKE '%Demo%')`,
      shopId,
    );
    await optionalDelete(tx, 'business_expenses',
      `DELETE FROM business_expenses
        WHERE shop_id=$1::uuid
          AND (money_account_id = ANY(${uuidArray(demoAccountIds)}) OR category ILIKE '%Demo%' OR note ILIKE '%Demo%')`,
      shopId,
    );

    let deletedPayments = 0;
    let deletedSaleItems = 0;
    let deletedSales = 0;
    if (saleIds.length) {
      await tx.stockMovement.deleteMany({
        where: {
          shopId,
          OR: [
            { referenceId: { in: saleIds } },
            ...(variantIds.length ? [{ productVariantId: { in: variantIds } }] : []),
            { referenceType: 'DEMO_OPENING_STOCK' },
            { note: { contains: 'Demo' } },
            { note: { contains: 'DEMO' } },
          ],
        },
      });
      deletedPayments = (await tx.payment.deleteMany({ where: { shopId, saleId: { in: saleIds } } })).count;
      deletedSaleItems = (await tx.saleItem.deleteMany({ where: { shopId, saleId: { in: saleIds } } })).count;
      deletedSales = (await tx.sale.deleteMany({ where: { shopId, id: { in: saleIds } } })).count;
    } else if (variantIds.length) {
      await tx.stockMovement.deleteMany({
        where: {
          shopId,
          OR: [
            { productVariantId: { in: variantIds } },
            { referenceType: 'DEMO_OPENING_STOCK' },
            { note: { contains: 'Demo' } },
            { note: { contains: 'DEMO' } },
          ],
        },
      });
    }

    let inventoryBalances = 0;
    let variants = 0;
    if (variantIds.length) {
      inventoryBalances = (await tx.inventoryBalance.deleteMany({ where: { shopId, productVariantId: { in: variantIds } } })).count;
      variants = (await tx.productVariant.deleteMany({ where: { shopId, id: { in: variantIds } } })).count;
    }

    const products = await tx.product.deleteMany({
      where: {
        shopId,
        OR: [
          { name: { startsWith: 'Demo ' } },
          { brand: 'Demo' },
          ...(productIds.length ? [{ id: { in: productIds } }] : []),
        ],
      },
    });
    const categories = await tx.category.deleteMany({ where: { shopId, name: { in: DEMO_CATEGORY_NAMES } } });
    const customers = await tx.customer.deleteMany({
      where: {
        shopId,
        OR: [{ name: { startsWith: 'Demo ' } }, { phone: DEMO_CUSTOMER_PHONE }],
      },
    });

    const paymentMethods = await tx.$executeRawUnsafe(
      `DELETE FROM finance_payment_methods
        WHERE shop_id=$1::uuid
          AND (code ILIKE 'DEMO_%' OR name ILIKE 'Demo %')`,
      shopId,
    ).catch(() => 0);
    const moneyAccounts = await tx.$executeRawUnsafe(
      `DELETE FROM money_accounts
        WHERE shop_id=$1::uuid
          AND name ILIKE 'Demo %'`,
      shopId,
    ).catch(() => 0);

    await tx.auditLog.deleteMany({
      where: {
        shopId,
        OR: [
          { action: { startsWith: 'DEMO_' } },
          { entityType: 'onboarding_demo' },
        ],
      },
    }).catch(() => {});

    return {
      sales: deletedSales,
      saleItems: deletedSaleItems,
      payments: deletedPayments,
      products: products.count,
      variants,
      inventoryBalances,
      categories: categories.count,
      customers: customers.count,
      paymentMethods: number(paymentMethods),
      moneyAccounts: number(moneyAccounts),
      moneyServiceLegacy: legacyMoneyService.count,
      moneyServiceV2: number(moneyServiceV2),
      moneyServiceV2Payments: number(moneyServiceV2Payments),
      accountReversed,
    };
  });
}


async function seedPaymentMethodsForShop(tx, shopId, userId) {
  let count = 0;
  for (const method of DEMO_PAYMENT_METHODS) {
    const existing = await tx.$queryRawUnsafe(
      'SELECT id FROM finance_payment_methods WHERE shop_id=$1::uuid AND LOWER(code)=LOWER($2) LIMIT 1',
      shopId,
      method.code,
    ).catch(() => []);
    if (existing[0]) continue;
    const account = await tx.moneyAccount.create({
      data: { shopId, name: method.name, type: method.accountType, balance: 0, active: true },
    });
    await tx.$executeRawUnsafe(
      `INSERT INTO finance_payment_methods(id,shop_id,name,code,kind,account_id,supports_money_service,active,sort_order,created_by_id,created_at,updated_at)
       VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7,TRUE,$8,$9::uuid,NOW(),NOW())`,
      require('crypto').randomUUID(),
      shopId,
      method.name,
      method.code,
      method.kind,
      account.id,
      method.supportsMoneyService,
      method.sortOrder,
      userId,
    );
    count += 1;
  }
  return count;
}

async function seedDemoDataForShop({ shopId, userId }) {
  if (!UUID_RE.test(String(shopId || ''))) throw new Error('Invalid shop id for demo seed');
  return prisma.$transaction(async (tx) => {
    const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { businessType: true } });
    const businessType = String(shop?.businessType || 'PHONE_SHOP').toUpperCase();
    const demoProducts = demoProductsForBusinessType(businessType);
    const categorySeeds = uniq(demoProducts.map((row) => row[4])).map((name) => ({
      name,
      kind: name.replace(/^Demo\s+/, ''),
    }));

    const categories = {};
    for (const item of categorySeeds) {
      categories[item.name] = await tx.category.upsert({
        where: { shopId_name: { shopId, name: item.name } },
        update: { kind: item.kind, active: true },
        create: { shopId, name: item.name, kind: item.kind, active: true },
      });
    }

    let products = 0;
    let variants = 0;
    for (const row of demoProducts) {
      const [name, brand, model, productType, categoryName, variantName, sku, barcode, ram, storage, color, unit, expiryDate, wholesalePrice, costPrice, sellingPrice, minimumPrice, openingStock, lowStock] = row;
      let product = await tx.product.findFirst({ where: { shopId, name } });
      if (!product) {
        product = await tx.product.create({
          data: { shopId, categoryId: categories[categoryName].id, groupName: categoryName, name, brand, model, productType, active: true },
        });
        products += 1;
      }
      let variant = await tx.productVariant.findFirst({ where: { shopId, sku } });
      if (!variant) {
        variant = await tx.productVariant.create({
          data: {
            shopId,
            productId: product.id,
            categoryId: categories[categoryName].id,
            variantName,
            sku,
            barcode,
            unit: unit || null,
            expiryDate: expiryDate ? new Date(`${expiryDate}T00:00:00.000Z`) : null,
            ram: ram || null,
            storage: storage || null,
            color: color || null,
            costPrice,
            standardSellingPrice: sellingPrice,
            wholesalePrice: wholesalePrice || 0,
            minimumSellingPrice: minimumPrice,
            active: true,
          },
        });
        await tx.inventoryBalance.create({ data: { shopId, productVariantId: variant.id, quantity: openingStock, minAlertQuantity: lowStock } });
        await tx.stockMovement.create({ data: { shopId, productVariantId: variant.id, type: 'STOCK_IN', quantityChange: openingStock, beforeQuantity: 0, afterQuantity: openingStock, referenceType: 'DEMO_OPENING_STOCK', userId, note: `Demo opening stock (${businessType})` } });
        variants += 1;
      }
    }

    const customer = await tx.customer.findFirst({ where: { shopId, phone: DEMO_CUSTOMER_PHONE } });
    if (!customer) await tx.customer.create({ data: { shopId, name: 'Demo Customer', phone: DEMO_CUSTOMER_PHONE, address: 'Demo address', balance: 0 } });

    const paymentMethods = await seedPaymentMethodsForShop(tx, shopId, userId);
    return { businessType, products, variants, expectedProducts: demoProducts.length, categories: Object.keys(categories).length, customers: customer ? 0 : 1, paymentMethods };
  });
}

module.exports = { cleanupDemoData, seedDemoDataForShop };
