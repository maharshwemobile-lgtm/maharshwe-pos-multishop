const {
  prisma,
  access,
  wrap,
  assertCompletionTablesReady,
  dateStart,
  dateEnd,
  csvCell,
} = require('./purchasing-completion-core');

const number = (value) => Number(value || 0);

function dateFilters(req, alias, column) {
  const from = dateStart(req.query.from);
  const to = dateEnd(req.query.to);
  const params = [req.auth.shopId];
  const filters = [`${alias}.shop_id=$1::uuid`];
  if (from) {
    params.push(from);
    filters.push(`${alias}.${column}>=$${params.length}`);
  }
  if (to) {
    params.push(to);
    filters.push(`${alias}.${column}<=$${params.length}`);
  }
  return { params, filters };
}

async function summary(shopId, from, to) {
  const params = [shopId];
  const receiptFilters = ['pr.shop_id=$1::uuid'];
  const paymentFilters = ['sp.shop_id=$1::uuid'];
  const returnFilters = ['pr.shop_id=$1::uuid'];
  if (from) {
    params.push(from);
    const n = params.length;
    receiptFilters.push(`pr.received_date>=$${n}::date`);
    paymentFilters.push(`sp.payment_date>=$${n}::date`);
    returnFilters.push(`pr.return_date>=$${n}::date`);
  }
  if (to) {
    params.push(to);
    const n = params.length;
    receiptFilters.push(`pr.received_date<=$${n}::date`);
    paymentFilters.push(`sp.payment_date<=$${n}::date`);
    returnFilters.push(`pr.return_date<=$${n}::date`);
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT
       (SELECT COUNT(*)::int FROM purchase_receipts pr WHERE ${receiptFilters.join(' AND ')}) AS "receiptCount",
       (SELECT COALESCE(SUM(pr.total_amount),0) FROM purchase_receipts pr WHERE ${receiptFilters.join(' AND ')}) AS "receivedAmount",
       (SELECT COUNT(*)::int FROM supplier_payments sp WHERE ${paymentFilters.join(' AND ')}) AS "paymentCount",
       (SELECT COALESCE(SUM(sp.amount),0) FROM supplier_payments sp WHERE ${paymentFilters.join(' AND ')}) AS "paidAmount",
       (SELECT COUNT(*)::int FROM purchase_returns pr WHERE ${returnFilters.join(' AND ')}) AS "returnCount",
       (SELECT COALESCE(SUM(pr.total_amount),0) FROM purchase_returns pr WHERE ${returnFilters.join(' AND ')}) AS "returnedAmount",
       (SELECT COUNT(*)::int FROM suppliers s WHERE s.shop_id=$1::uuid AND s.active=TRUE) AS "activeSuppliers",
       (SELECT COUNT(*)::int FROM purchase_orders po WHERE po.shop_id=$1::uuid AND po.status='APPROVED') AS "approvedOrders",
       (SELECT COUNT(*)::int FROM purchase_orders po WHERE po.shop_id=$1::uuid AND po.status='PARTIALLY_RECEIVED') AS "partiallyReceivedOrders",
       (SELECT COUNT(*)::int FROM purchase_orders po WHERE po.shop_id=$1::uuid AND po.status='RECEIVED') AS "receivedOrders",
       (SELECT COALESCE(SUM(GREATEST(x.received-x.returned-x.paid,0)),0)
          FROM (
            SELECT po.id,
              COALESCE((SELECT SUM(pri.line_total) FROM purchase_receipts pr JOIN purchase_receipt_items pri ON pri.purchase_receipt_id=pr.id AND pri.shop_id=pr.shop_id WHERE pr.purchase_order_id=po.id AND pr.shop_id=po.shop_id),0) AS received,
              COALESCE((SELECT SUM(pri.line_total) FROM purchase_returns pr JOIN purchase_return_items pri ON pri.purchase_return_id=pr.id AND pri.shop_id=pr.shop_id WHERE pr.purchase_order_id=po.id AND pr.shop_id=po.shop_id),0) AS returned,
              COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_order_id=po.id AND sp.shop_id=po.shop_id),0) AS paid
            FROM purchase_orders po WHERE po.shop_id=$1::uuid
          ) x) AS outstanding`,
    ...params,
  );
  const row = rows[0] || {};
  return {
    receiptCount: Number(row.receiptCount || 0),
    receivedAmount: number(row.receivedAmount),
    paymentCount: Number(row.paymentCount || 0),
    paidAmount: number(row.paidAmount),
    returnCount: Number(row.returnCount || 0),
    returnedAmount: number(row.returnedAmount),
    activeSuppliers: Number(row.activeSuppliers || 0),
    approvedOrders: Number(row.approvedOrders || 0),
    partiallyReceivedOrders: Number(row.partiallyReceivedOrders || 0),
    receivedOrders: Number(row.receivedOrders || 0),
    outstanding: number(row.outstanding),
    netPurchases: number(row.receivedAmount) - number(row.returnedAmount),
  };
}

function attachPurchasingReportsApi(app) {
  app.get('/api/purchasing/reports/summary', ...access.read, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    res.json({ ok: true, summary: await summary(req.auth.shopId, req.query.from || null, req.query.to || null) });
  }));

  app.get('/api/purchasing/reports/export.csv', ...access.read, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const supplierId = String(req.query.supplierId || '').trim();
    const params = [req.auth.shopId];
    const receiptFilters = ['pr.shop_id=$1::uuid'];
    const paymentFilters = ['sp.shop_id=$1::uuid'];
    const returnFilters = ['pr.shop_id=$1::uuid'];
    if (from) {
      params.push(from);
      const n = params.length;
      receiptFilters.push(`pr.received_date>=$${n}::date`);
      paymentFilters.push(`sp.payment_date>=$${n}::date`);
      returnFilters.push(`pr.return_date>=$${n}::date`);
    }
    if (to) {
      params.push(to);
      const n = params.length;
      receiptFilters.push(`pr.received_date<=$${n}::date`);
      paymentFilters.push(`sp.payment_date<=$${n}::date`);
      returnFilters.push(`pr.return_date<=$${n}::date`);
    }
    if (supplierId) {
      params.push(supplierId);
      const n = params.length;
      receiptFilters.push(`po.supplier_id=$${n}::uuid`);
      paymentFilters.push(`sp.supplier_id=$${n}::uuid`);
      returnFilters.push(`pr.supplier_id=$${n}::uuid`);
    }

    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM (
         SELECT pr.received_date AS date,
                'GOODS_RECEIPT'::text AS type,
                pr.receipt_number AS reference,
                po.order_number AS "orderNumber",
                s.supplier_code AS "supplierCode",
                s.name AS "supplierName",
                pr.total_amount AS amount,
                pr.note AS note,
                pr.created_at AS "createdAt"
           FROM purchase_receipts pr
           JOIN purchase_orders po ON po.id=pr.purchase_order_id AND po.shop_id=pr.shop_id
           JOIN suppliers s ON s.id=po.supplier_id AND s.shop_id=po.shop_id
          WHERE ${receiptFilters.join(' AND ')}
         UNION ALL
         SELECT sp.payment_date AS date,
                'SUPPLIER_PAYMENT'::text AS type,
                sp.payment_number AS reference,
                po.order_number AS "orderNumber",
                s.supplier_code AS "supplierCode",
                s.name AS "supplierName",
                sp.amount AS amount,
                CONCAT_WS(' · ',sp.method,sp.reference,sp.note) AS note,
                sp.created_at AS "createdAt"
           FROM supplier_payments sp
           JOIN suppliers s ON s.id=sp.supplier_id AND s.shop_id=sp.shop_id
           LEFT JOIN purchase_orders po ON po.id=sp.purchase_order_id AND po.shop_id=sp.shop_id
          WHERE ${paymentFilters.join(' AND ')}
         UNION ALL
         SELECT pr.return_date AS date,
                'PURCHASE_RETURN'::text AS type,
                pr.return_number AS reference,
                po.order_number AS "orderNumber",
                s.supplier_code AS "supplierCode",
                s.name AS "supplierName",
                pr.total_amount AS amount,
                pr.reason AS note,
                pr.created_at AS "createdAt"
           FROM purchase_returns pr
           JOIN purchase_orders po ON po.id=pr.purchase_order_id AND po.shop_id=pr.shop_id
           JOIN suppliers s ON s.id=pr.supplier_id AND s.shop_id=pr.shop_id
          WHERE ${returnFilters.join(' AND ')}
       ) x
       ORDER BY date DESC,"createdAt" DESC`,
      ...params,
    );

    const columns = ['Date', 'Type', 'Reference', 'Purchase Order', 'Supplier Code', 'Supplier', 'Amount', 'Note'];
    const lines = [columns.map(csvCell).join(',')];
    for (const row of rows) {
      lines.push([
        row.date ? String(row.date).slice(0, 10) : '',
        row.type,
        row.reference,
        row.orderNumber || '',
        row.supplierCode,
        row.supplierName,
        number(row.amount),
        row.note || '',
      ].map(csvCell).join(','));
    }
    const filename = `mahar-pos-purchasing-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${lines.join('\r\n')}`);
  }));
}

module.exports = attachPurchasingReportsApi;
