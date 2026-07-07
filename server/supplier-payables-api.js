const crypto = require('crypto');
const { z } = require('zod');
const {
  prisma,
  access,
  ApiError,
  parse,
  wrap,
  serializable,
  audit,
  nextNumber,
  assertCompletionTablesReady,
  supplierPaymentSchema,
} = require('./purchasing-completion-core');

const number = (value) => Number(value || 0);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max = 1000) => z.union([z.string().trim().max(max), z.literal(''), z.null()]).optional();
const manualPayableSchema = z.object({
  supplierId: z.string().uuid(),
  payableDate: dateSchema,
  amount: z.coerce.number().finite().min(0),
  note: text(1000),
});

async function ensureManualPayablesTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS supplier_manual_payables (
      id UUID PRIMARY KEY,
      shop_id UUID NOT NULL,
      supplier_id UUID NOT NULL,
      payable_date DATE NOT NULL,
      amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      note TEXT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_id UUID NULL,
      updated_by_id UUID NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS supplier_manual_payables_shop_supplier_idx
      ON supplier_manual_payables(shop_id, supplier_id, active, payable_date DESC)
  `);
}

async function orderPayable(db, shopId, orderId, lock = false) {
  const rows = await db.$queryRawUnsafe(
    `SELECT po.id,
            po.order_number AS "orderNumber",
            po.status,
            po.supplier_id AS "supplierId",
            s.supplier_code AS "supplierCode",
            s.name AS "supplierName",
            COALESCE((SELECT SUM(pri.line_total)
                        FROM purchase_receipts pr
                        JOIN purchase_receipt_items pri ON pri.purchase_receipt_id=pr.id AND pri.shop_id=pr.shop_id
                       WHERE pr.purchase_order_id=po.id AND pr.shop_id=po.shop_id),0) AS "receivedAmount",
            COALESCE((SELECT SUM(pri.line_total)
                        FROM purchase_returns pr
                        JOIN purchase_return_items pri ON pri.purchase_return_id=pr.id AND pri.shop_id=pr.shop_id
                       WHERE pr.purchase_order_id=po.id AND pr.shop_id=po.shop_id),0) AS "returnedAmount",
            COALESCE((SELECT SUM(sp.amount)
                        FROM supplier_payments sp
                       WHERE sp.purchase_order_id=po.id AND sp.shop_id=po.shop_id),0) AS "paidAmount"
       FROM purchase_orders po
       JOIN suppliers s ON s.id=po.supplier_id AND s.shop_id=po.shop_id
      WHERE po.id=$1::uuid AND po.shop_id=$2::uuid
      LIMIT 1${lock ? ' FOR UPDATE OF po' : ''}`,
    orderId,
    shopId,
  );
  if (!rows[0]) throw new ApiError(404, 'Purchase order was not found');
  const row = rows[0];
  const netReceived = number(row.receivedAmount) - number(row.returnedAmount);
  return {
    ...row,
    netReceived,
    outstanding: Math.max(0, netReceived - number(row.paidAmount)),
    supplierCredit: Math.max(0, number(row.paidAmount) - netReceived),
  };
}

function attachSupplierPayablesApi(app) {
  app.get('/api/purchasing/manual-payables', ...access.read, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    await ensureManualPayablesTable();
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const search = String(req.query.q || '').trim();
    const params = [req.auth.shopId];
    const filters = ['mp.shop_id=$1::uuid', 'mp.active=TRUE'];
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(s.name ILIKE $${params.length} OR s.supplier_code ILIKE $${params.length} OR mp.note ILIKE $${params.length})`);
    }
    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total
         FROM supplier_manual_payables mp
         JOIN suppliers s ON s.id=mp.supplier_id AND s.shop_id=mp.shop_id
        WHERE ${filters.join(' AND ')}`,
      ...params,
    );
    const summaryRows = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(mp.amount),0) AS outstanding
         FROM supplier_manual_payables mp
         JOIN suppliers s ON s.id=mp.supplier_id AND s.shop_id=mp.shop_id
        WHERE ${filters.join(' AND ')}`,
      ...params,
    );
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT mp.id,
              mp.supplier_id AS "supplierId",
              s.supplier_code AS "supplierCode",
              s.name AS "supplierName",
              mp.payable_date AS "payableDate",
              mp.amount,
              mp.note,
              mp.created_at AS "createdAt",
              mp.updated_at AS "updatedAt"
         FROM supplier_manual_payables mp
         JOIN suppliers s ON s.id=mp.supplier_id AND s.shop_id=mp.shop_id
        WHERE ${filters.join(' AND ')}
        ORDER BY mp.payable_date DESC, mp.updated_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      ...params,
    );
    const total = Number(countRows[0]?.total || 0);
    res.json({
      ok: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: { outstanding: number(summaryRows[0]?.outstanding) },
      manualPayables: rows,
    });
  }));

  app.post('/api/purchasing/manual-payables', ...access.write, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    await ensureManualPayablesTable();
    const input = parse(manualPayableSchema, req.body || {}, 'Invalid supplier payable request');
    const result = await serializable(async (tx) => {
      const supplierRows = await tx.$queryRawUnsafe(
        `SELECT id,supplier_code AS "supplierCode",name
           FROM suppliers
          WHERE id=$1::uuid AND shop_id=$2::uuid AND active=TRUE
          LIMIT 1`,
        input.supplierId,
        req.auth.shopId,
      );
      if (!supplierRows[0]) throw new ApiError(404, 'Supplier was not found');
      const id = crypto.randomUUID();
      const rows = await tx.$queryRawUnsafe(
        `INSERT INTO supplier_manual_payables (
           id,shop_id,supplier_id,payable_date,amount,note,active,created_by_id,updated_by_id,created_at,updated_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::date,$5,$6,TRUE,$7::uuid,$7::uuid,NOW(),NOW())
         RETURNING id,supplier_id AS "supplierId",payable_date AS "payableDate",amount,note,created_at AS "createdAt",updated_at AS "updatedAt"`,
        id,
        req.auth.shopId,
        input.supplierId,
        input.payableDate,
        input.amount,
        input.note || null,
        req.auth.userId,
      );
      await audit(tx, req, 'SUPPLIER_MANUAL_PAYABLE_CREATED', 'supplier_manual_payable', id, {
        supplier: supplierRows[0],
        amount: input.amount,
        payableDate: input.payableDate,
        note: input.note || null,
      });
      return { ...rows[0], supplierCode: supplierRows[0].supplierCode, supplierName: supplierRows[0].name };
    });
    res.status(201).json({ ok: true, manualPayable: result });
  }));

  app.patch('/api/purchasing/manual-payables/:id', ...access.write, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    await ensureManualPayablesTable();
    const input = parse(manualPayableSchema, req.body || {}, 'Invalid supplier payable request');
    const result = await serializable(async (tx) => {
      const currentRows = await tx.$queryRawUnsafe(
        `SELECT mp.id,mp.supplier_id AS "supplierId",mp.payable_date AS "payableDate",mp.amount,mp.note,
                s.supplier_code AS "supplierCode",s.name AS "supplierName"
           FROM supplier_manual_payables mp
           JOIN suppliers s ON s.id=mp.supplier_id AND s.shop_id=mp.shop_id
          WHERE mp.id=$1::uuid AND mp.shop_id=$2::uuid AND mp.active=TRUE
          LIMIT 1`,
        req.params.id,
        req.auth.shopId,
      );
      if (!currentRows[0]) throw new ApiError(404, 'Manual supplier payable was not found');
      const supplierRows = await tx.$queryRawUnsafe(
        `SELECT id,supplier_code AS "supplierCode",name
           FROM suppliers
          WHERE id=$1::uuid AND shop_id=$2::uuid AND active=TRUE
          LIMIT 1`,
        input.supplierId,
        req.auth.shopId,
      );
      if (!supplierRows[0]) throw new ApiError(404, 'Supplier was not found');
      const rows = await tx.$queryRawUnsafe(
        `UPDATE supplier_manual_payables
            SET supplier_id=$3::uuid,payable_date=$4::date,amount=$5,note=$6,updated_by_id=$7::uuid,updated_at=NOW()
          WHERE id=$1::uuid AND shop_id=$2::uuid AND active=TRUE
          RETURNING id,supplier_id AS "supplierId",payable_date AS "payableDate",amount,note,created_at AS "createdAt",updated_at AS "updatedAt"`,
        req.params.id,
        req.auth.shopId,
        input.supplierId,
        input.payableDate,
        input.amount,
        input.note || null,
        req.auth.userId,
      );
      await audit(tx, req, 'SUPPLIER_MANUAL_PAYABLE_UPDATED', 'supplier_manual_payable', req.params.id, {
        before: currentRows[0],
        after: { ...rows[0], supplierCode: supplierRows[0].supplierCode, supplierName: supplierRows[0].name },
      });
      return { ...rows[0], supplierCode: supplierRows[0].supplierCode, supplierName: supplierRows[0].name };
    });
    res.json({ ok: true, manualPayable: result });
  }));

  app.delete('/api/purchasing/manual-payables/:id', ...access.write, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    await ensureManualPayablesTable();
    const result = await serializable(async (tx) => {
      const currentRows = await tx.$queryRawUnsafe(
        `SELECT id,supplier_id AS "supplierId",amount,note
           FROM supplier_manual_payables
          WHERE id=$1::uuid AND shop_id=$2::uuid AND active=TRUE
          LIMIT 1`,
        req.params.id,
        req.auth.shopId,
      );
      if (!currentRows[0]) throw new ApiError(404, 'Manual supplier payable was not found');
      await tx.$executeRawUnsafe(
        `UPDATE supplier_manual_payables
            SET active=FALSE,updated_by_id=$3::uuid,updated_at=NOW()
          WHERE id=$1::uuid AND shop_id=$2::uuid`,
        req.params.id,
        req.auth.shopId,
        req.auth.userId,
      );
      await audit(tx, req, 'SUPPLIER_MANUAL_PAYABLE_DELETED', 'supplier_manual_payable', req.params.id, {
        before: currentRows[0],
      });
      return currentRows[0];
    });
    res.json({ ok: true, deleted: result });
  }));

  app.get('/api/purchasing/payables', ...access.read, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const search = String(req.query.q || '').trim();
    const supplierId = String(req.query.supplierId || '').trim();
    const outstandingOnly = String(req.query.outstandingOnly || 'true').toLowerCase() !== 'false';
    const params = [req.auth.shopId];
    const filters = ["po.shop_id=$1::uuid", "po.status IN ('PARTIALLY_RECEIVED','RECEIVED')"];
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(po.order_number ILIKE $${params.length} OR s.name ILIKE $${params.length} OR s.supplier_code ILIKE $${params.length})`);
    }
    if (supplierId) {
      params.push(supplierId);
      filters.push(`po.supplier_id=$${params.length}::uuid`);
    }

    const base = `WITH payable_rows AS (
      SELECT po.id,
             po.order_number AS "orderNumber",
             po.order_date AS "orderDate",
             po.status,
             po.supplier_id AS "supplierId",
             s.supplier_code AS "supplierCode",
             s.name AS "supplierName",
             COALESCE((SELECT SUM(pri.line_total) FROM purchase_receipts pr JOIN purchase_receipt_items pri ON pri.purchase_receipt_id=pr.id AND pri.shop_id=pr.shop_id WHERE pr.purchase_order_id=po.id AND pr.shop_id=po.shop_id),0) AS "receivedAmount",
             COALESCE((SELECT SUM(pri.line_total) FROM purchase_returns pr JOIN purchase_return_items pri ON pri.purchase_return_id=pr.id AND pri.shop_id=pr.shop_id WHERE pr.purchase_order_id=po.id AND pr.shop_id=po.shop_id),0) AS "returnedAmount",
             COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_order_id=po.id AND sp.shop_id=po.shop_id),0) AS "paidAmount"
        FROM purchase_orders po
        JOIN suppliers s ON s.id=po.supplier_id AND s.shop_id=po.shop_id
       WHERE ${filters.join(' AND ')}
    )`;
    const outstandingFilter = outstandingOnly
      ? 'WHERE ("receivedAmount"-"returnedAmount"-"paidAmount") > 0.005'
      : '';
    const countRows = await prisma.$queryRawUnsafe(
      `${base} SELECT COUNT(*)::int AS total FROM payable_rows ${outstandingFilter}`,
      ...params,
    );
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const rows = await prisma.$queryRawUnsafe(
      `${base}
       SELECT *,
              ("receivedAmount"-"returnedAmount") AS "netReceived",
              GREATEST(("receivedAmount"-"returnedAmount"-"paidAmount"),0) AS outstanding,
              GREATEST(("paidAmount"-("receivedAmount"-"returnedAmount")),0) AS "supplierCredit"
         FROM payable_rows
         ${outstandingFilter}
        ORDER BY "orderDate" DESC,"orderNumber" DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      ...params,
    );
    const summaryRows = await prisma.$queryRawUnsafe(
      `${base}
       SELECT COALESCE(SUM("receivedAmount"),0) AS "receivedAmount",
              COALESCE(SUM("returnedAmount"),0) AS "returnedAmount",
              COALESCE(SUM("paidAmount"),0) AS "paidAmount",
              COALESCE(SUM(GREATEST(("receivedAmount"-"returnedAmount"-"paidAmount"),0)),0) AS outstanding,
              COALESCE(SUM(GREATEST(("paidAmount"-("receivedAmount"-"returnedAmount")),0)),0) AS "supplierCredit"
         FROM payable_rows`,
      ...params.slice(0, params.length - 2),
    );
    const total = Number(countRows[0]?.total || 0);
    res.json({
      ok: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: summaryRows[0] || {},
      payables: rows,
    });
  }));

  app.get('/api/purchasing/payments', ...access.read, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const search = String(req.query.q || '').trim();
    const params = [req.auth.shopId];
    const filters = ['sp.shop_id=$1::uuid'];
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(sp.payment_number ILIKE $${params.length} OR po.order_number ILIKE $${params.length} OR s.name ILIKE $${params.length} OR sp.reference ILIKE $${params.length})`);
    }
    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total
         FROM supplier_payments sp
         JOIN suppliers s ON s.id=sp.supplier_id AND s.shop_id=sp.shop_id
         LEFT JOIN purchase_orders po ON po.id=sp.purchase_order_id AND po.shop_id=sp.shop_id
        WHERE ${filters.join(' AND ')}`,
      ...params,
    );
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT sp.id,
              sp.payment_number AS "paymentNumber",
              sp.payment_date AS "paymentDate",
              sp.amount,
              sp.method,
              sp.reference,
              sp.note,
              sp.created_at AS "createdAt",
              s.id AS "supplierId",
              s.supplier_code AS "supplierCode",
              s.name AS "supplierName",
              po.id AS "purchaseOrderId",
              po.order_number AS "orderNumber",
              ma.id AS "moneyAccountId",
              ma.name AS "moneyAccountName"
         FROM supplier_payments sp
         JOIN suppliers s ON s.id=sp.supplier_id AND s.shop_id=sp.shop_id
         LEFT JOIN purchase_orders po ON po.id=sp.purchase_order_id AND po.shop_id=sp.shop_id
         LEFT JOIN money_accounts ma ON ma.id=sp.money_account_id AND ma.shop_id=sp.shop_id
        WHERE ${filters.join(' AND ')}
        ORDER BY sp.payment_date DESC,sp.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      ...params,
    );
    const total = Number(countRows[0]?.total || 0);
    res.json({ ok: true, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), payments: rows });
  }));

  app.post('/api/purchasing/payments', ...access.write, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    const input = parse(supplierPaymentSchema, req.body || {}, 'Invalid supplier payment request');
    if (!input.purchaseOrderId) throw new ApiError(400, 'Purchase Order is required for supplier payment');
    const shopId = req.auth.shopId;

    const result = await serializable(async (tx) => {
      const payable = await orderPayable(tx, shopId, input.purchaseOrderId, true);
      if (payable.supplierId !== input.supplierId) throw new ApiError(409, 'Supplier does not match the Purchase Order');
      if (payable.outstanding <= 0.005) throw new ApiError(409, 'This Purchase Order has no outstanding payable');
      if (input.amount > payable.outstanding + 0.005) {
        throw new ApiError(409, `Payment exceeds outstanding payable of ${payable.outstanding}`);
      }

      let account = null;
      if (input.moneyAccountId) {
        account = await tx.moneyAccount.findFirst({
          where: { id: input.moneyAccountId, shopId, active: true },
        });
        if (!account) throw new ApiError(404, 'Money account was not found');
        const before = number(account.balance);
        const after = before - input.amount;
        if (after < -0.005) throw new ApiError(409, `Insufficient ${account.name} balance`);
        await tx.moneyAccount.update({ where: { id: account.id }, data: { balance: after } });
        await tx.moneyServiceTransaction.create({
          data: {
            shopId,
            accountId: account.id,
            type: 'ACCOUNT_ADJUSTMENT',
            feeMode: 'MANUAL',
            cashChange: account.type === 'CASH' ? -input.amount : 0,
            walletChange: account.type === 'CASH' ? 0 : -input.amount,
            beforeCashBalance: account.type === 'CASH' ? before : 0,
            afterCashBalance: account.type === 'CASH' ? after : 0,
            beforeWalletBalance: account.type === 'CASH' ? 0 : before,
            afterWalletBalance: account.type === 'CASH' ? 0 : after,
            userId: req.auth.userId,
            note: `[SUPPLIER_PAYMENT:${payable.orderNumber}] ${input.note || payable.supplierName}`,
          },
        });
      }

      const id = crypto.randomUUID();
      const paymentNumber = await nextNumber(tx, shopId, 'supplier_payments', 'payment_number', 'SP', 6);
      const rows = await tx.$queryRawUnsafe(
        `INSERT INTO supplier_payments (
           id,shop_id,supplier_id,purchase_order_id,payment_number,payment_date,amount,method,
           money_account_id,reference,note,created_by_id,created_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::date,$7,$8,$9::uuid,$10,$11,$12::uuid,NOW())
         RETURNING id,payment_number AS "paymentNumber",payment_date AS "paymentDate",amount,method,reference,note,created_at AS "createdAt"`,
        id,
        shopId,
        input.supplierId,
        input.purchaseOrderId,
        paymentNumber,
        input.paymentDate,
        input.amount,
        input.method,
        input.moneyAccountId || null,
        input.reference || null,
        input.note || null,
        req.auth.userId,
      );
      await audit(tx, req, 'SUPPLIER_PAYMENT_RECORDED', 'supplier_payment', id, {
        paymentNumber,
        orderId: payable.id,
        orderNumber: payable.orderNumber,
        supplierId: payable.supplierId,
        supplierName: payable.supplierName,
        amount: input.amount,
        outstandingBefore: payable.outstanding,
        outstandingAfter: payable.outstanding - input.amount,
        method: input.method,
        moneyAccountId: account?.id || null,
        moneyAccountName: account?.name || null,
      });
      return { ...rows[0], orderNumber: payable.orderNumber, supplierName: payable.supplierName, outstandingAfter: payable.outstanding - input.amount };
    });

    res.status(201).json({ ok: true, message: 'Supplier payment recorded', payment: result });
  }));
}

module.exports = attachSupplierPayablesApi;
