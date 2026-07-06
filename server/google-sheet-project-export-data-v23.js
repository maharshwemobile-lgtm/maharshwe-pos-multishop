const { prisma } = require('./prisma');

const SERVICE_PREFIX = '__SERVICE_INCOME__:';

async function exportRemittances(shopId, since, take) {
  return prisma.$queryRawUnsafe(
    `SELECT * FROM (
       SELECT t.id::text AS id,t.transaction_number AS "transactionNumber",t.created_at AS "createdAt",'LEGACY' AS "recordVersion",
              CASE WHEN t.type::text LIKE '%CASH_OUT' THEN 'CASH_OUT' ELSE 'TRANSFER' END AS mode,
              COALESCE(t.service_channel,t.type::text) AS wallet,t.sender_name AS "senderName",t.sender_phone AS "senderPhone",
              t.receiver_name AS "receiverName",t.receiver_phone AS "receiverPhone",t.counterparty_name AS "withdrawerName",t.counterparty_phone AS "withdrawerPhone",
              t.customer_amount AS amount,t.fee_rate AS "feeRate",t.fee_amount AS fee,t.customer_pays_amount AS "customerPays",
              t.customer_receives_amount AS "customerReceives",'PAID' AS "paymentStatus",t.customer_pays_amount AS "paidAmount",0::numeric AS "dueAmount",
              NULL::date AS "dueDate",t.reference,t.note,u.name AS "staffName",u.username AS "staffUsername"
         FROM money_service_transactions t LEFT JOIN users u ON u.id=t.user_id
        WHERE t.shop_id=$1::uuid AND t.type IN ('KPAY_TRANSFER','KPAY_CASH_OUT','WAVE_PAY_TRANSFER','WAVE_PAY_CASH_OUT') AND t.created_at >= $2
       UNION ALL
       SELECT t.id::text AS id,t.transaction_number AS "transactionNumber",t.created_at AS "createdAt",'V2' AS "recordVersion",
              t.mode,m.name AS wallet,t.sender_name AS "senderName",t.sender_phone AS "senderPhone",t.receiver_name AS "receiverName",t.receiver_phone AS "receiverPhone",
              t.withdrawer_name AS "withdrawerName",t.withdrawer_phone AS "withdrawerPhone",t.amount,t.fee_rate AS "feeRate",t.fee_amount AS fee,
              t.customer_pays AS "customerPays",t.customer_receives AS "customerReceives",t.payment_status AS "paymentStatus",t.paid_amount AS "paidAmount",
              t.due_amount AS "dueAmount",t.due_date AS "dueDate",t.reference,t.note,u.name AS "staffName",u.username AS "staffUsername"
         FROM money_service_transactions_v2 t LEFT JOIN finance_payment_methods m ON m.id=t.payment_method_id LEFT JOIN users u ON u.id=t.created_by_id
        WHERE t.shop_id=$1::uuid AND t.updated_at >= $2
     ) records ORDER BY "createdAt" ASC LIMIT $3`,
    shopId, since, take,
  );
}

async function exportSales(shopId, since, take) {
  return prisma.$queryRawUnsafe(
    `SELECT s.id,s.invoice_number AS "invoiceNumber",s.sold_at AS "soldAt",s.status,
            COALESCE(c.name,'Walk-in Customer') AS "customerName",c.phone AS "customerPhone",
            s.subtotal,s.discount,s.total,s.cost_total AS "costTotal",s.profit_total AS "profitTotal",
            s.payment_status AS "paymentStatus",COALESCE(MAX(p.payment_method_name_snapshot),MAX(pm.name),MAX(p.method::text)) AS "paymentMethod",
            u.name AS "staffName",u.username AS "staffUsername",
            COALESCE(STRING_AGG(si.product_name_snapshot || COALESCE(' · '||si.variant_name_snapshot,'') || ' x' || si.quantity, '; ' ORDER BY si.created_at),'') AS items
       FROM sales s
       LEFT JOIN customers c ON c.id=s.customer_id
       LEFT JOIN users u ON u.id=s.user_id
       LEFT JOIN sale_items si ON si.sale_id=s.id
       LEFT JOIN payments p ON p.sale_id=s.id AND p.status='PAID'
       LEFT JOIN finance_payment_methods pm ON pm.id=p.payment_method_id
      WHERE s.shop_id=$1::uuid AND s.updated_at >= $2
      GROUP BY s.id,c.name,c.phone,u.name,u.username
      ORDER BY s.sold_at ASC LIMIT $3`,
    shopId, since, take,
  );
}

async function exportIncome(shopId, since, take, service) {
  return prisma.$queryRawUnsafe(
    `SELECT i.id,i.income_date AS "businessDate",CASE WHEN i.source LIKE $3 THEN SUBSTRING(i.source FROM $4) ELSE i.source END AS source,
            i.amount,i.method,i.note,i.created_at AS "createdAt",a.name AS "accountName",u.name AS "createdBy"
       FROM business_other_income i
       LEFT JOIN money_accounts a ON a.id=i.money_account_id
       LEFT JOIN users u ON u.id=i.created_by_id
      WHERE i.shop_id=$1::uuid AND i.created_at >= $2
        AND ${service ? 'i.source LIKE $3' : 'i.source NOT LIKE $3'}
      ORDER BY i.created_at ASC LIMIT $5`,
    shopId, since, `${SERVICE_PREFIX}%`, SERVICE_PREFIX.length + 1, take,
  );
}


async function exportRepairRecords(shopId, since, take) {
  return prisma.$queryRawUnsafe(
    `SELECT r.id::text AS id,
            r.repair_number AS "repairNumber",
            r.customer_name AS "customerName",
            r.customer_phone AS "customerPhone",
            TRIM(COALESCE(r.device_brand,'') || ' ' || COALESCE(r.device_model,'')) AS device,
            r.problem,
            r.status::text AS status,
            CASE
              WHEN r.status::text='COMPLETED' THEN 'ပြင်ပြီး'
              WHEN r.status::text='DELIVERED' THEN 'ယူပြီး'
              WHEN r.status::text='CANNOT_REPAIR' THEN 'ပြင်မရ'
              WHEN r.status::text='WAITING_PART' THEN 'ပစ္စည်းစောင့်'
              WHEN r.status::text='IN_PROGRESS' THEN 'ပြင်နေ'
              WHEN r.status::text='CHECKING' THEN 'စစ်ဆေးနေ'
              ELSE 'လက်ခံပြီး'
            END AS "statusMyanmar",
            r.received_at AS "receivedAt",
            r.completed_at AS "completedAt",
            r.delivered_at AS "deliveredAt",
            r.estimated_cost AS "estimatedCost",
            r.final_cost AS "finalCost",
            r.deposit,
            r.payment_status::text AS "paymentStatus",
            r.updated_at AS "updatedAt"
       FROM repairs r
      WHERE r.shop_id=$1::uuid AND r.updated_at >= $2
      ORDER BY r.updated_at ASC
      LIMIT $3`,
    shopId, since, take,
  );
}

async function exportDataset(shopId, dataset, since, limit) {
  const take = Math.min(10000, Math.max(1, Number(limit || 5000)));
  if (dataset === 'remittances') return exportRemittances(shopId, since, take);
  if (dataset === 'sale-history') return exportSales(shopId, since, take);
  if (dataset === 'other-income') return exportIncome(shopId, since, take, false);
  if (dataset === 'service-income') return exportIncome(shopId, since, take, true);
  if (dataset === 'expense') {
    return prisma.$queryRawUnsafe(
      `SELECT e.id,e.expense_date AS "businessDate",e.category,e.amount,e.method,e.note,e.created_at AS "createdAt",
              a.name AS "accountName",u.name AS "createdBy"
         FROM business_expenses e LEFT JOIN money_accounts a ON a.id=e.money_account_id LEFT JOIN users u ON u.id=e.created_by_id
        WHERE e.shop_id=$1::uuid AND e.created_at >= $2 ORDER BY e.created_at ASC LIMIT $3`,
      shopId, since, take,
    );
  }
  if (dataset === 'repair-records') return exportRepairRecords(shopId, since, take);
  if (dataset === 'stock') {
    return prisma.$queryRawUnsafe(
      `SELECT pv.id,p.name AS "productName",pv.variant_name AS "variantName",pv.sku,pv.barcode,c.name AS category,
              ib.quantity,ib.min_alert_quantity AS "minAlertQuantity",pv.cost_price AS "costPrice",pv.standard_selling_price AS "sellingPrice",ib.updated_at AS "updatedAt"
         FROM product_variants pv JOIN products p ON p.id=pv.product_id LEFT JOIN categories c ON c.id=COALESCE(pv.category_id,p.category_id)
         LEFT JOIN inventory_balances ib ON ib.product_variant_id=pv.id
        WHERE pv.shop_id=$1::uuid AND GREATEST(pv.updated_at,COALESCE(ib.updated_at,pv.updated_at)) >= $2
        ORDER BY GREATEST(pv.updated_at,COALESCE(ib.updated_at,pv.updated_at)) ASC LIMIT $3`,
      shopId, since, take,
    );
  }
  return prisma.$queryRawUnsafe(
    `SELECT a.id,a.created_at AS "createdAt",a.action,a.entity_type AS "entityType",a.entity_id AS "entityId",a.details,
            a.ip_address AS "ipAddress",u.name AS "userName",u.username
       FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.shop_id=$1::uuid AND a.created_at >= $2 ORDER BY a.created_at ASC LIMIT $3`,
    shopId, since, take,
  );
}

module.exports = { exportDataset };
