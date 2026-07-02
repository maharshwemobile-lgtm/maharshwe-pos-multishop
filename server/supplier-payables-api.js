const crypto = require('crypto');
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
