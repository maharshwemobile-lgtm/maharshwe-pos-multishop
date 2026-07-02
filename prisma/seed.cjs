const bcrypt = require("bcryptjs");
const { prisma } = require("../server/prisma");

const adminPermissions = {
  sale: true,
  history: true,
  discount: true,
  editSale: true,
  deleteSale: false,
  inventory: true,
  accounting: true,
  settings: true,
  users: true,
  reports: true,
  repairs: true,
  moneyService: true,
  viewCost: true,
  viewProfit: true,
};

const cashierPermissions = {
  sale: true,
  history: true,
  discount: false,
  editSale: false,
  deleteSale: false,
  inventory: false,
  accounting: false,
  settings: false,
  users: false,
  reports: false,
  repairs: true,
  moneyService: true,
  viewCost: false,
  viewProfit: false,
};

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

async function hash(password) {
  return bcrypt.hash(password, 12);
}

async function upsertUser({ shopId, username, password, name, role, permissions }) {
  const normalizedUsername = normalizeUsername(username);
  return prisma.user.upsert({
    where: {
      shopId_normalizedUsername: {
        shopId,
        normalizedUsername,
      },
    },
    update: {
      name,
      role,
      permissions,
      active: true,
      passwordHash: await hash(password),
    },
    create: {
      shopId,
      username,
      normalizedUsername,
      passwordHash: await hash(password),
      name,
      role,
      permissions,
      active: true,
    },
  });
}

async function upsertSuperAdmin({ username, password, name }) {
  const normalizedUsername = normalizeUsername(username);
  const existing = await prisma.user.findFirst({
    where: { shopId: null, normalizedUsername },
  });
  const data = {
    shopId: null,
    username,
    normalizedUsername,
    passwordHash: await hash(password),
    name,
    role: "SUPER_ADMIN",
    permissions: {},
    active: true,
  };

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.user.create({ data });
}

async function upsertProductWithVariant({ shopId, categoryId, product, variant }) {
  const existingProduct = await prisma.product.findFirst({
    where: { shopId, name: product.name },
  });

  const savedProduct = existingProduct
    ? await prisma.product.update({
        where: { id: existingProduct.id },
        data: { ...product, categoryId, shopId, active: true },
      })
    : await prisma.product.create({
        data: { ...product, categoryId, shopId, active: true },
      });

  const savedVariant = await prisma.productVariant.upsert({
    where: { shopId_sku: { shopId, sku: variant.sku } },
    update: { ...variant, productId: savedProduct.id, categoryId, active: true },
    create: { ...variant, shopId, productId: savedProduct.id, categoryId, active: true },
  });

  return { product: savedProduct, variants: [savedVariant] };
}

async function main() {
  const superAdminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD || "superadmin123";
  const shopAdminPassword = process.env.SEED_SHOP_ADMIN_PASSWORD || "admin1234";
  const cashierPassword = process.env.SEED_CASHIER_PASSWORD || "cashier1234";

  const shop = await prisma.shop.upsert({
    where: { slug: "maharshwe-mobile" },
    update: {
      name: "MaharShwe Mobile",
      active: true,
    },
    create: {
      slug: "maharshwe-mobile",
      code: "MSM",
      name: "MaharShwe Mobile",
      phone: "09-000-000-000",
      address: "Development address",
      active: true,
    },
  });

  const existingSubscription = await prisma.subscription.findFirst({
    where: { shopId: shop.id, status: "ACTIVE" },
    orderBy: { endsAt: "desc" },
  });
  const subscriptionData = {
      shopId: shop.id,
      status: "ACTIVE",
      setupFee: "0",
      monthlyFee: "50000",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      notes: "Safe development subscription seed",
  };
  if (existingSubscription) {
    await prisma.subscription.update({
      where: { id: existingSubscription.id },
      data: subscriptionData,
    });
  } else {
    await prisma.subscription.create({ data: subscriptionData });
  }

  await prisma.shopSettings.upsert({
    where: { shopId: shop.id },
    update: {},
    create: {
      shopId: shop.id,
      receiptHeader: "MaharShwe Mobile",
      receiptFooter: "Thank you",
      invoicePrefix: "MS",
      repairPrefix: "RP",
      currency: "MMK",
      language: "my",
      moneyServiceRates: {
        kpayTransferPer100000: 300,
        kpayCashOutPer100000: 500,
        waveTransferPer100000: 300,
        waveCashOutPer100000: 500,
      },
      repairStatuses: [
        "RECEIVED",
        "CHECKING",
        "IN_PROGRESS",
        "WAITING_PART",
        "COMPLETED",
        "CANNOT_REPAIR",
        "DELIVERED",
      ],
    },
  });

  await upsertSuperAdmin({
    username: "superadmin",
    password: superAdminPassword,
    name: "Development Super Admin",
  });

  const shopAdmin = await upsertUser({
    shopId: shop.id,
    username: "admin",
    password: shopAdminPassword,
    name: "MaharShwe Shop Admin",
    role: "SHOP_ADMIN",
    permissions: adminPermissions,
  });

  await upsertUser({
    shopId: shop.id,
    username: "cashier",
    password: cashierPassword,
    name: "Development Cashier",
    role: "CASHIER",
    permissions: cashierPermissions,
  });

  const categories = ["Brand New", "Second Hand", "Phone", "Cover", "Tempered Glass", "Accessories", "Spare Parts", "Service", "Combo"];
  for (const name of categories) {
    await prisma.category.upsert({
      where: { shopId_name: { shopId: shop.id, name } },
      update: {},
      create: { shopId: shop.id, name, active: true },
    });
  }

  const phoneCategory = await prisma.category.findUnique({
    where: { shopId_name: { shopId: shop.id, name: "Phone" } },
  });
  const coverCategory = await prisma.category.findUnique({
    where: { shopId_name: { shopId: shop.id, name: "Cover" } },
  });

  const redmi = await upsertProductWithVariant({
      shopId: shop.id,
      categoryId: phoneCategory.id,
      product: {
        groupName: "Redmi",
        name: "Redmi 14C",
        brand: "Redmi",
        model: "14C",
        productType: "Phone",
        requiresSerial: true,
      },
      variant: {
        variantName: "8GB / 256GB / Black",
        sku: "MS-REDMI14C-BLK",
        barcode: "MS000001",
        ram: "8GB",
        storage: "256GB",
        color: "Black",
        costPrice: "320000",
        standardSellingPrice: "360000",
        minimumSellingPrice: "345000",
      },
  });

  const cover = await upsertProductWithVariant({
      shopId: shop.id,
      categoryId: coverCategory.id,
      product: {
        groupName: "Redmi 14C",
        name: "Redmi 14C Silicone Cover",
        brand: "Redmi",
        model: "14C",
        productType: "Cover",
        requiresSerial: false,
      },
      variant: {
        variantName: "Black",
        sku: "MS-COVER14C-BLK",
        barcode: "MS000002",
        color: "Black",
        costPrice: "2500",
        standardSellingPrice: "5000",
        minimumSellingPrice: "4000",
      },
  });

  for (const variant of [...redmi.variants, ...cover.variants]) {
    await prisma.inventoryBalance.upsert({
      where: { productVariantId: variant.id },
      update: { quantity: 10, minAlertQuantity: 2 },
      create: {
        shopId: shop.id,
        productVariantId: variant.id,
        quantity: 10,
        minAlertQuantity: 2,
      },
    });

    await prisma.stockMovement.create({
      data: {
        shopId: shop.id,
        productVariantId: variant.id,
        type: "STOCK_IN",
        quantityChange: 10,
        beforeQuantity: 0,
        afterQuantity: 10,
        userId: shopAdmin.id,
        note: "Development seed stock",
      },
    });
  }

  for (const account of [
    { type: "CASH", name: "Cash", balance: "0" },
    { type: "KPAY", name: "KPay", balance: "0" },
    { type: "WAVE_PAY", name: "Wave Pay", balance: "0" },
  ]) {
    await prisma.moneyAccount.upsert({
      where: { shopId_name: { shopId: shop.id, name: account.name } },
      update: { type: account.type, balance: account.balance, active: true },
      create: { shopId: shop.id, ...account },
    });
  }

  console.log("Seed complete");
  console.log("Super admin: superadmin / " + superAdminPassword);
  console.log("Shop slug: maharshwe-mobile");
  console.log("Shop admin: admin / " + shopAdminPassword);
  console.log("Cashier: cashier / " + cashierPassword);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
