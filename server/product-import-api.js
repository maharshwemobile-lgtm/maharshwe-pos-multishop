const crypto = require('crypto');
const { getDb, addActivityLog } = require('./db');

const numberValue = (value) => {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const textValue = (value) => String(value ?? '').trim();

const buildId = (row, index) => {
  const provided = textValue(row.id);
  if (provided) return provided;
  const barcode = textValue(row.barcode);
  if (barcode) return `barcode_${barcode.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const seed = `${textValue(row.brand)}|${textValue(row.model)}|${textValue(row.color)}|${index}`;
  return `import_${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 18)}`;
};

async function ensureProductTable() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS pos_products (
      id TEXT PRIMARY KEY,
      brand TEXT,
      model TEXT,
      category TEXT,
      cost_price REAL DEFAULT 0,
      selling_price REAL DEFAULT 0,
      stock_qty REAL DEFAULT 0,
      raw_json TEXT NOT NULL
    )
  `);
  return db;
}

function attachProductImportApi(app, { protect }) {
  app.post('/api/products/import', protect, async (req, res) => {
    const rows = Array.isArray(req.body.products) ? req.body.products : [];
    const replace = req.body.mode === 'replace';
    if (!rows.length) return res.status(400).json({ ok: false, message: 'No product rows found' });

    const db = await ensureProductTable();
    await db.exec('BEGIN IMMEDIATE');
    try {
      if (replace) await db.exec('DELETE FROM pos_products');
      let imported = 0;
      let skipped = 0;

      for (const [index, source] of rows.entries()) {
        const brand = textValue(source.brand);
        const model = textValue(source.model || source.name);
        if (!brand && !model) {
          skipped += 1;
          continue;
        }

        const product = {
          ...source,
          id: buildId(source, index),
          barcode: textValue(source.barcode),
          brand,
          model,
          specs: textValue(source.specs),
          color: textValue(source.color),
          category: textValue(source.category) || 'Accessories',
          costPrice: numberValue(source.costPrice ?? source.cost_price),
          sellingPrice: numberValue(source.sellingPrice ?? source.selling_price ?? source.price),
          stockQty: numberValue(source.stockQty ?? source.stock ?? source.qty),
          reorderLevel: numberValue(source.reorderLevel ?? source.reorder_level),
        };

        await db.run(
          `INSERT INTO pos_products (id, brand, model, category, cost_price, selling_price, stock_qty, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             brand = excluded.brand,
             model = excluded.model,
             category = excluded.category,
             cost_price = excluded.cost_price,
             selling_price = excluded.selling_price,
             stock_qty = excluded.stock_qty,
             raw_json = excluded.raw_json`,
          product.id,
          product.brand,
          product.model,
          product.category,
          product.costPrice,
          product.sellingPrice,
          product.stockQty,
          JSON.stringify(product)
        );
        imported += 1;
      }

      await db.exec('COMMIT');
      await addActivityLog({
        userName: req.user?.name || 'System',
        action: 'Import Products',
        details: `${imported} products imported; ${skipped} skipped; mode=${replace ? 'replace' : 'merge'}`,
        ip: req.ip,
      });
      const total = (await db.get('SELECT COUNT(*) AS total FROM pos_products')).total;
      res.json({ ok: true, message: 'Product import completed', imported, skipped, total });
    } catch (error) {
      await db.exec('ROLLBACK');
      res.status(500).json({ ok: false, message: error.message || 'Product import failed' });
    }
  });
}

module.exports = attachProductImportApi;
