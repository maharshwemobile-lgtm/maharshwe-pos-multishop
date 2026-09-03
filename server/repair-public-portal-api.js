const { prisma } = require('./prisma');
const { ensureRepairPlatformSchema } = require('./repair-platform-schema');
const {
  hmac,
  stableShareKey,
  findPublicRepair,
  publicRepairPayload,
} = require('./repair-customer-portal-utils');

function attachRepairPublicPortalApi(app) {
  app.get('/api/public/repair', async (req, res) => {
    try {
      await ensureRepairPlatformSchema();
      const repair = await findPublicRepair(req.query.shop, req.query.id);
      if (!repair || !repair.publicStatusEnabled) {
        return res.status(404).json({ ok: false, message: 'Repair status not found' });
      }

      const shareKey = String(req.query.key || '');
      if (!shareKey) {
        return res.status(401).json({ ok: false, message: 'Repair share key is required' });
      }

      const shareHash = hmac(shareKey, 'public-repair');
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id,active FROM repair_public_access
          WHERE shop_id=$1::uuid AND repair_id=$2::uuid AND access_token_hash=$3
          LIMIT 1`,
        repair.shopId,
        repair.id,
        shareHash,
      );

      // The key printed on the voucher is derived from the repair, so it is
      // accepted on its own strength. Falling back to it means a voucher still
      // opens when the access row is missing or still holds a key from before
      // printing stopped rotating them -- the paper in the customer's hand is
      // the thing that has to keep working.
      const derived = shareKey === stableShareKey(repair.shopId, repair.id);
      if (!rows[0] && !derived) {
        return res.status(403).json({ ok: false, message: 'Repair status link is invalid or expired' });
      }
      // A row switched off by the shop is a deliberate "stop showing this".
      if (rows[0] && rows[0].active === false) {
        return res.status(403).json({ ok: false, message: 'Repair status link is turned off' });
      }

      if (rows[0]) {
        await prisma.$executeRawUnsafe(
          `UPDATE repair_public_access SET last_viewed_at=NOW(),updated_at=NOW() WHERE id=$1::uuid`,
          rows[0].id,
        );
      }
      return res.json({ ok: true, ...(await publicRepairPayload(repair)) });
    } catch (error) {
      console.error('Public repair status:', error);
      return res.status(500).json({ ok: false, message: 'Repair status request failed' });
    }
  });
}

module.exports = attachRepairPublicPortalApi;
