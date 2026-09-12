/*
 * The shop's spare-part stock is kept by hand on the workbook's STOCK tab: a
 * wall chart with a pair of columns per brand (part name, then QTY) sitting
 * side by side, so one spreadsheet row holds a Redmi part, an Oppo part and a
 * Vivo part that have nothing to do with each other.
 *
 * Until now the sheet only ever received from the POS. Repairs were the one
 * thing that travelled the other way, which is why editing a QTY here and
 * expecting the POS to follow did nothing at all. This is the missing half.
 *
 * Two rules keep it from doing damage:
 *
 *   - Only the Spare Parts category is ever written. A part on the sheet is
 *     named after the phone it fits, so "Redmi 9A" is both a screen the shop
 *     stocks and a handset it sells; a name that already belongs to a product
 *     outside Spare Parts is reported back and left alone rather than being
 *     quietly merged into the handset.
 *   - Quantity is set, never added. The sheet is the record of what is on the
 *     shelf, so a repeated push of the same row is not a repeated stock-in.
 */
const { prisma } = require('./prisma');

const CATEGORY_NAME = 'Spare Parts';

const clean = (value, max = 200) => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : '';
};

function parseQuantity(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

async function sparePartCategory(tx, shopId) {
  const found = await tx.category.findFirst({
    where: { shopId, name: { equals: CATEGORY_NAME, mode: 'insensitive' } },
  });
  if (found) return found;
  return tx.category.create({ data: { shopId, name: CATEGORY_NAME, active: true } });
}

async function applyStockRow(shopId, row) {
  const name = clean(row?.name, 180);
  const brand = clean(row?.brand, 120);
  const quantity = parseQuantity(row?.qty);

  if (!name) return { name: '', applied: false, reason: 'no part name' };
  if (quantity === null) return { name, applied: false, reason: 'no usable QTY' };

  return prisma.$transaction(async (tx) => {
    const category = await sparePartCategory(tx, shopId);

    // A name the shop already uses for something it sells is left where it is.
    const elsewhere = await tx.product.findFirst({
      where: { shopId, name: { equals: name, mode: 'insensitive' }, categoryId: { not: category.id } },
      include: { category: true },
    });
    if (elsewhere) {
      return { name, applied: false, reason: 'name already used by a product in ' + (elsewhere.category?.name || 'another category') };
    }

    let product = await tx.product.findFirst({
      where: { shopId, categoryId: category.id, name: { equals: name, mode: 'insensitive' } },
    });
    let created = false;
    if (!product) {
      product = await tx.product.create({
        data: { shopId, categoryId: category.id, name, brand: brand || null, active: true },
      });
      created = true;
    } else if (brand && !product.brand) {
      product = await tx.product.update({ where: { id: product.id }, data: { brand } });
    }

    let variant = await tx.productVariant.findFirst({
      where: { shopId, productId: product.id, variantName: { equals: 'Default', mode: 'insensitive' } },
    });
    if (!variant) {
      variant = await tx.productVariant.create({
        data: {
          shopId,
          productId: product.id,
          categoryId: category.id,
          variantName: 'Default',
          costPrice: 0,
          standardSellingPrice: 0,
          minimumSellingPrice: 0,
          active: true,
        },
      });
    }

    const balance = await tx.inventoryBalance.findUnique({ where: { productVariantId: variant.id } });
    const before = Number(balance?.quantity || 0);
    const delta = quantity - before;

    await tx.inventoryBalance.upsert({
      where: { productVariantId: variant.id },
      update: { quantity },
      create: { shopId, productVariantId: variant.id, quantity, minAlertQuantity: 0 },
    });

    if (delta !== 0) {
      await tx.stockMovement.create({
        data: {
          shopId,
          productVariantId: variant.id,
          type: delta > 0 ? 'STOCK_IN' : 'ADJUSTMENT',
          quantityChange: delta,
          beforeQuantity: before,
          afterQuantity: quantity,
          referenceType: 'SHEET_STOCK_SYNC',
          note: '[STOCK SHEET] ' + (brand || 'Other') + ' — ' + name,
        },
      });
    }

    return { name, brand, applied: true, created, before, after: quantity, changed: delta !== 0 };
  });
}

module.exports = { applyStockRow, CATEGORY_NAME };
