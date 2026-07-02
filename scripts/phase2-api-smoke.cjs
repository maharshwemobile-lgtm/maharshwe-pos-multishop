require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { prisma } = require('../server/prisma');

const BASE_URL = (process.env.PHASE2_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const MAIN_SHOP_SLUG = process.env.PHASE2_MAIN_SHOP_SLUG || 'maharshwe-mobile';
const MAIN_USERNAME = process.env.PHASE2_MAIN_USERNAME || 'admin';
const MAIN_PASSWORD = process.env.PHASE2_MAIN_PASSWORD || process.env.SEED_SHOP_ADMIN_PASSWORD;
const runId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const secondShopSlug = `phase2-test-${runId}`;
const secondPassword = crypto.randomBytes(16).toString('hex');

const created = {
  secondShopId: null,
  categoryId: null,
  productId: null,
  variantId: null,
  movementIds: [],
};

function pass(message) {
  console.log(`PASS  ${message}`);
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function request(path, { method = 'GET', token, body, expected = [200] } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!expected.includes(response.status)) {
    const error = new Error(`${method} ${path} expected ${expected.join('/')} but received ${response.status}`);
    error.details = data;
    throw error;
  }

  return { status: response.status, data };
}

async function login({ username, password, shopSlug }) {
  const { data } = await request('/api/auth/login', {
    method: 'POST',
    body: { username, password, shopSlug },
    expected: [200],
  });
  assert(data?.token, `Login failed for ${shopSlug}`, data);
  return data.token;
}

async function createSecondShop() {
  const passwordHash = await bcrypt.hash(secondPassword, 12);
  const startsAt = new Date();
  const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const shop = await prisma.shop.create({
    data: {
      slug: secondShopSlug,
      code: `T${Date.now().toString().slice(-8)}`,
      name: `Phase 2 Isolation Shop ${runId}`,
      active: true,
      settings: {
        create: {
          currency: 'MMK',
          language: 'my',
          allowNegativeStock: false,
          minimumPriceApprovalRequired: true,
        },
      },
      subscriptions: {
        create: {
          status: 'ACTIVE',
          setupFee: 0,
          monthlyFee: 50000,
          startsAt,
          endsAt,
          notes: 'Temporary Phase 2 isolation smoke test',
        },
      },
      users: {
        create: {
          username: 'admin',
          normalizedUsername: 'admin',
          passwordHash,
          name: 'Phase 2 Test Admin',
          role: 'SHOP_ADMIN',
          permissions: {
            inventory: true,
            viewCost: true,
            viewProfit: true,
          },
          active: true,
        },
      },
    },
  });

  created.secondShopId = shop.id;
  return shop;
}

async function cleanup() {
  try {
    if (created.movementIds.length) {
      await prisma.stockMovement.deleteMany({ where: { id: { in: created.movementIds } } });
    }
    if (created.variantId) {
      await prisma.stockMovement.deleteMany({ where: { productVariantId: created.variantId } });
      await prisma.inventoryBalance.deleteMany({ where: { productVariantId: created.variantId } });
      await prisma.productVariant.deleteMany({ where: { id: created.variantId } });
    }
    if (created.productId) {
      await prisma.product.deleteMany({ where: { id: created.productId } });
    }
    if (created.categoryId) {
      await prisma.category.deleteMany({ where: { id: created.categoryId } });
    }
    if (created.secondShopId) {
      await prisma.shop.deleteMany({ where: { id: created.secondShopId } });
    }
  } catch (error) {
    console.warn('Cleanup warning:', error.message);
  }
}

async function main() {
  if (!MAIN_PASSWORD) {
    throw new Error('SEED_SHOP_ADMIN_PASSWORD or PHASE2_MAIN_PASSWORD is required');
  }

  const health = await request('/health');
  assert(health.data?.ok === true, 'API health check failed', health.data);
  pass('API health');

  const mainToken = await login({
    username: MAIN_USERNAME,
    password: MAIN_PASSWORD,
    shopSlug: MAIN_SHOP_SLUG,
  });
  pass('Main shop login');

  await createSecondShop();
  const secondToken = await login({
    username: 'admin',
    password: secondPassword,
    shopSlug: secondShopSlug,
  });
  pass('Second shop login');

  const categoryName = `Phase2 Test Category ${runId}`;
  const categoryCreate = await request('/api/categories', {
    method: 'POST',
    token: mainToken,
    body: { name: categoryName, kind: 'TEST' },
    expected: [201],
  });
  created.categoryId = categoryCreate.data.category.id;
  pass('Category create');

  const categoryUpdate = await request(`/api/categories/${created.categoryId}`, {
    method: 'PATCH',
    token: mainToken,
    body: { name: `${categoryName} Updated`, kind: 'TEST_UPDATED' },
  });
  assert(categoryUpdate.data.category.name.endsWith('Updated'), 'Category update did not persist', categoryUpdate.data);
  pass('Category update');

  const sku = `PH2-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const productCreate = await request('/api/products', {
    method: 'POST',
    token: mainToken,
    body: {
      categoryId: created.categoryId,
      groupName: 'Phase 2 Test',
      name: `Isolation Product ${runId}`,
      brand: 'MaharShwe Test',
      model: 'P2',
      productType: 'Accessories',
      requiresSerial: false,
      variants: [
        {
          variantName: 'Black',
          sku,
          barcode: `${Date.now()}`,
          color: 'Black',
          costPrice: 1000,
          standardSellingPrice: 2000,
          minimumSellingPrice: 1500,
          initialQuantity: 3,
          minAlertQuantity: 2,
        },
      ],
    },
    expected: [201],
  });
  created.productId = productCreate.data.product.id;
  created.variantId = productCreate.data.product.variants[0].id;
  assert(productCreate.data.product.variants[0].inventory.quantity === 3, 'Initial stock should be 3', productCreate.data);
  pass('Product + variant + opening stock create');

  const productUpdate = await request(`/api/products/${created.productId}`, {
    method: 'PATCH',
    token: mainToken,
    body: { brand: 'MaharShwe Updated', model: 'P2-U' },
  });
  assert(productUpdate.data.product.brand === 'MaharShwe Updated', 'Product update did not persist', productUpdate.data);
  pass('Product update');

  const variantUpdate = await request(`/api/variants/${created.variantId}`, {
    method: 'PATCH',
    token: mainToken,
    body: {
      variantName: 'Black Updated',
      standardSellingPrice: 2200,
      minimumSellingPrice: 1600,
      minAlertQuantity: 4,
    },
  });
  assert(variantUpdate.data.variant.standardSellingPrice === 2200, 'Variant update did not persist', variantUpdate.data);
  assert(variantUpdate.data.variant.inventory.minAlertQuantity === 4, 'Low-stock threshold update did not persist', variantUpdate.data);
  pass('Variant update');

  const stockIn = await request('/api/stock/movements', {
    method: 'POST',
    token: mainToken,
    body: {
      productVariantId: created.variantId,
      type: 'STOCK_IN',
      quantityChange: 5,
      note: 'Phase 2 smoke stock in',
    },
    expected: [201],
  });
  created.movementIds.push(stockIn.data.movement.id);
  assert(stockIn.data.balance.quantity === 8, 'Stock In expected quantity 8', stockIn.data);
  pass('Stock In: 3 + 5 = 8');

  const adjustment = await request('/api/stock/movements', {
    method: 'POST',
    token: mainToken,
    body: {
      productVariantId: created.variantId,
      type: 'ADJUSTMENT',
      quantityChange: -2,
      note: 'Phase 2 smoke adjustment',
    },
    expected: [201],
  });
  created.movementIds.push(adjustment.data.movement.id);
  assert(adjustment.data.balance.quantity === 6, 'Adjustment expected quantity 6', adjustment.data);
  pass('Stock Adjustment: 8 - 2 = 6');

  const stockList = await request(`/api/stock?q=${encodeURIComponent(sku)}`, { token: mainToken });
  const mainStock = stockList.data.items.find((item) => item.id === created.variantId);
  assert(mainStock?.inventory?.quantity === 6, 'Stock readback expected quantity 6', stockList.data);
  pass('Stock readback');

  const secondList = await request(`/api/products?q=${encodeURIComponent(sku)}`, { token: secondToken });
  assert(secondList.data.total === 0, 'Second shop can see first shop product', secondList.data);
  pass('Tenant isolation: second shop product list is empty');

  await request(`/api/products/${created.productId}`, { token: secondToken, expected: [404] });
  await request(`/api/products/${created.productId}`, {
    method: 'PATCH',
    token: secondToken,
    body: { name: 'Forbidden Cross-Shop Update' },
    expected: [404],
  });
  await request(`/api/variants/${created.variantId}`, {
    method: 'PATCH',
    token: secondToken,
    body: { variantName: 'Forbidden Cross-Shop Update' },
    expected: [404],
  });
  await request('/api/stock/movements', {
    method: 'POST',
    token: secondToken,
    body: {
      productVariantId: created.variantId,
      type: 'STOCK_IN',
      quantityChange: 1,
      note: 'Forbidden cross-shop stock movement',
    },
    expected: [404],
  });
  pass('Tenant isolation: cross-shop read/update/stock blocked');

  const variantDelete = await request(`/api/variants/${created.variantId}`, {
    method: 'DELETE',
    token: mainToken,
  });
  assert(variantDelete.data.active === false, 'Variant delete should deactivate it', variantDelete.data);
  pass('Variant delete/deactivate');

  const productDelete = await request(`/api/products/${created.productId}`, {
    method: 'DELETE',
    token: mainToken,
  });
  assert(productDelete.data.active === false, 'Product delete should deactivate it', productDelete.data);
  pass('Product delete/deactivate');

  const categoryDelete = await request(`/api/categories/${created.categoryId}`, {
    method: 'DELETE',
    token: mainToken,
  });
  assert(categoryDelete.data.active === false, 'Category delete should deactivate it', categoryDelete.data);
  pass('Category delete/deactivate');

  console.log('\nPHASE 2 API SMOKE TEST PASSED');
}

main()
  .catch((error) => {
    console.error('\nPHASE 2 API SMOKE TEST FAILED');
    console.error(error.message);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
