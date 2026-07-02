const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');
const { ensureRepairPlatformSchema } = require('./repair-platform-schema');

function requireTenantAdmin(req, res, next) {
  if (req.auth?.role === 'SHOP_ADMIN' || req.auth?.role === 'SUPER_ADMIN') return next();
  if (req.auth?.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: 'Insufficient tenant integrity permission' });
}

async function count(sql, shopId) {
  const rows = await prisma.$queryRawUnsafe(sql, shopId);
  return Number(rows?.[0]?.count || 0);
}

function attachTenantIntegrityApi(app) {
  app.get('/api/tenant/integrity', requireAuth, requireShopUser, requireTenantAdmin, async (req, res) => {
    try {
      await ensureRepairPlatformSchema();
      const shopId = req.auth.shopId;
      const checks = {
        salesWithWrongUserTenant: await count(
          `SELECT COUNT(*)::int AS count FROM sales s JOIN users u ON u.id=s.user_id
            WHERE s.shop_id=$1::uuid AND u.shop_id IS DISTINCT FROM s.shop_id`, shopId,
        ),
        salesWithWrongCustomerTenant: await count(
          `SELECT COUNT(*)::int AS count FROM sales s JOIN customers c ON c.id=s.customer_id
            WHERE s.shop_id=$1::uuid AND c.shop_id IS DISTINCT FROM s.shop_id`, shopId,
        ),
        saleItemsWithWrongSaleTenant: await count(
          `SELECT COUNT(*)::int AS count FROM sale_items si JOIN sales s ON s.id=si.sale_id
            WHERE si.shop_id=$1::uuid AND s.shop_id IS DISTINCT FROM si.shop_id`, shopId,
        ),
        saleItemsWithWrongProductTenant: await count(
          `SELECT COUNT(*)::int AS count FROM sale_items si JOIN product_variants pv ON pv.id=si.product_variant_id
            WHERE si.shop_id=$1::uuid AND pv.shop_id IS DISTINCT FROM si.shop_id`, shopId,
        ),
        paymentsWithWrongSaleTenant: await count(
          `SELECT COUNT(*)::int AS count FROM payments p JOIN sales s ON s.id=p.sale_id
            WHERE p.shop_id=$1::uuid AND s.shop_id IS DISTINCT FROM p.shop_id`, shopId,
        ),
        stockMovementsWithWrongProductTenant: await count(
          `SELECT COUNT(*)::int AS count FROM stock_movements sm JOIN product_variants pv ON pv.id=sm.product_variant_id
            WHERE sm.shop_id=$1::uuid AND pv.shop_id IS DISTINCT FROM sm.shop_id`, shopId,
        ),
        repairsWithWrongCustomerTenant: await count(
          `SELECT COUNT(*)::int AS count FROM repairs r JOIN customers c ON c.id=r.customer_id
            WHERE r.shop_id=$1::uuid AND c.shop_id IS DISTINCT FROM r.shop_id`, shopId,
        ),
        repairsWithWrongTechnicianTenant: await count(
          `SELECT COUNT(*)::int AS count FROM repairs r JOIN users u ON u.id=r.technician_id
            WHERE r.shop_id=$1::uuid AND u.shop_id IS DISTINCT FROM r.shop_id`, shopId,
        ),
        repairsWithWrongDeviceTenant: await count(
          `SELECT COUNT(*)::int AS count FROM repairs r JOIN repair_devices d ON d.id=r.device_id
            WHERE r.shop_id=$1::uuid AND d.shop_id IS DISTINCT FROM r.shop_id`, shopId,
        ),
        repairPaymentsWithWrongRepairTenant: await count(
          `SELECT COUNT(*)::int AS count FROM repair_payments p JOIN repairs r ON r.id=p.repair_id
            WHERE p.shop_id=$1::uuid AND r.shop_id IS DISTINCT FROM p.shop_id`, shopId,
        ),
        repairStatusWithWrongRepairTenant: await count(
          `SELECT COUNT(*)::int AS count FROM repair_status_history h JOIN repairs r ON r.id=h.repair_id
            WHERE h.shop_id=$1::uuid AND r.shop_id IS DISTINCT FROM h.shop_id`, shopId,
        ),
        repairEventsWithWrongRepairTenant: await count(
          `SELECT COUNT(*)::int AS count FROM repair_events e JOIN repairs r ON r.id=e.repair_id
            WHERE e.shop_id=$1::uuid AND r.shop_id IS DISTINCT FROM e.shop_id`, shopId,
        ),
        referralSourceTenantMismatch: await count(
          `SELECT COUNT(*)::int AS count FROM repair_referrals rr JOIN repairs r ON r.id=rr.source_repair_id
            WHERE rr.source_shop_id=$1::uuid AND r.shop_id IS DISTINCT FROM rr.source_shop_id`, shopId,
        ),
        referralProviderTenantMismatch: await count(
          `SELECT COUNT(*)::int AS count FROM repair_referrals rr JOIN repairs r ON r.id=rr.provider_repair_id
            WHERE rr.provider_shop_id=$1::uuid AND r.shop_id IS DISTINCT FROM rr.provider_shop_id`, shopId,
        ),
        publicAccessWithWrongRepairTenant: await count(
          `SELECT COUNT(*)::int AS count FROM repair_public_access a JOIN repairs r ON r.id=a.repair_id
            WHERE a.shop_id=$1::uuid AND r.shop_id IS DISTINCT FROM a.shop_id`, shopId,
        ),
        notificationQueueWithWrongRepairTenant: await count(
          `SELECT COUNT(*)::int AS count FROM repair_notification_queue n JOIN repairs r ON r.id=n.repair_id
            WHERE n.shop_id=$1::uuid AND r.shop_id IS DISTINCT FROM n.shop_id`, shopId,
        ),
        warrantyClaimsWithWrongRepairTenant: await count(
          `SELECT COUNT(*)::int AS count FROM repair_warranty_claims w JOIN repairs r ON r.id=w.repair_id
            WHERE w.shop_id=$1::uuid AND r.shop_id IS DISTINCT FROM w.shop_id`, shopId,
        ),
        warrantyParentTenantMismatch: await count(
          `SELECT COUNT(*)::int AS count FROM repairs child JOIN repairs parent ON parent.id=child.warranty_parent_repair_id
            WHERE child.shop_id=$1::uuid AND parent.shop_id IS DISTINCT FROM child.shop_id`, shopId,
        ),
        pickupVerifierTenantMismatch: await count(
          `SELECT COUNT(*)::int AS count FROM repairs r JOIN users u ON u.id=r.pickup_verified_by_id
            WHERE r.shop_id=$1::uuid AND u.shop_id IS NOT NULL AND u.shop_id IS DISTINCT FROM r.shop_id`, shopId,
        ),
        auditLogsWithWrongUserTenant: await count(
          `SELECT COUNT(*)::int AS count FROM audit_logs a JOIN users u ON u.id=a.user_id
            WHERE a.shop_id=$1::uuid AND u.shop_id IS DISTINCT FROM a.shop_id`, shopId,
        ),
      };

      const violations = Object.values(checks).reduce((sum, value) => sum + Number(value || 0), 0);
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { id: true, slug: true, name: true, active: true },
      });

      res.json({
        ok: true,
        tenantSafe: violations === 0,
        checkedAt: new Date().toISOString(),
        tenant: shop,
        violations,
        checks,
      });
    } catch (error) {
      console.error('Tenant integrity verification failed:', error);
      res.status(500).json({ ok: false, message: error.message || 'Tenant integrity verification failed' });
    }
  });
}

module.exports = attachTenantIntegrityApi;
