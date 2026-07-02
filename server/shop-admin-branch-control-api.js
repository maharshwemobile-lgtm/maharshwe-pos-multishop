const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");
const { z } = require("zod");
const { prisma } = require("./prisma");
const { requireAuth } = require("./auth-api");

function settingsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requireShopAdmin(req, res, next) {
  if (!req.auth?.shopId) {
    return res.status(403).json({ ok: false, message: "Shop account only" });
  }
  if (req.auth.role === "SHOP_ADMIN" || req.auth.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: "Shop Admin permission required" });
}

function branchView(branch) {
  return {
    id: branch.id,
    code: branch.code || "",
    name: branch.name || "",
    phone: branch.phone || "",
    address: branch.address || "",
    managerName: branch.managerName || "",
    active: branch.active !== false,
    createdAt: branch.createdAt || null,
    updatedAt: branch.updatedAt || null,
  };
}

async function getShopSettings(shopId, tx = prisma) {
  const row = await tx.shopSettings.upsert({
    where: { shopId },
    update: {},
    create: { shopId },
  });
  const settings = settingsObject(row.settings);
  const branches = Array.isArray(settings.branches) ? settings.branches.map(branchView) : [];
  return { row, settings, branches };
}

async function saveBranches(shopId, branches, tx = prisma) {
  const { settings } = await getShopSettings(shopId, tx);
  await tx.shopSettings.update({
    where: { shopId },
    data: {
      settings: {
        ...settings,
        branches: branches.map(branchView),
        branchControlUpdatedAt: new Date().toISOString(),
      },
    },
  });
}

async function audit(req, action, entityType, entityId, details = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        shopId: req.auth.shopId,
        userId: req.auth.userId,
        action,
        entityType,
        entityId: entityId || null,
        details,
        ipAddress: req.ip || null,
        userAgent: req.headers?.["user-agent"] || null,
      },
    });
  } catch (error) {
    console.warn("Shop admin branch audit failed:", error.message);
  }
}

const branchSchema = z.object({
  code: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(180),
  phone: z.string().trim().max(80).optional(),
  address: z.string().trim().max(300).optional(),
  managerName: z.string().trim().max(180).optional(),
  active: z.boolean().optional(),
});

const staffSchema = z.object({
  active: z.boolean().optional(),
  role: z.enum(["SHOP_ADMIN", "CASHIER"]).optional(),
  permissions: z.record(z.any()).optional(),
  branchId: z.string().trim().max(120).nullable().optional(),
  staffTitle: z.string().trim().max(80).nullable().optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(200),
  mustChange: z.boolean().default(true),
});

function publicStaff(user) {
  const permissions = settingsObject(user.permissions);
  return {
    id: user.id,
    username: user.username,
    email: user.email || "",
    name: user.name,
    role: user.role,
    active: user.active,
    permissions,
    branchId: permissions.branchId || "",
    staffTitle: permissions.staffTitle || (user.role === "SHOP_ADMIN" ? "Admin" : "Cashier"),
    authProvider: user.authProvider || "",
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
  };
}

async function overview(req, res) {
  const shopId = req.auth.shopId;
  const [{ branches }, users, metrics, auditLogs] = await Promise.all([
    getShopSettings(shopId),
    prisma.user.findMany({
      where: { shopId },
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        permissions: true,
        active: true,
        authProvider: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    Promise.all([
      prisma.product.count({ where: { shopId } }),
      prisma.productVariant.count({ where: { shopId } }),
      prisma.inventoryBalance.aggregate({ where: { shopId }, _sum: { quantity: true } }),
      prisma.sale.count({ where: { shopId } }),
    ]),
    prisma.auditLog.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { user: { select: { name: true, username: true, role: true } } },
    }),
  ]);

  res.json({
    ok: true,
    branches,
    users: users.map(publicStaff),
    metrics: {
      products: metrics[0],
      variants: metrics[1],
      stockUnits: Number(metrics[2]?._sum?.quantity || 0),
      sales: metrics[3],
      staff: users.length,
      activeBranches: branches.filter((item) => item.active !== false).length,
    },
    auditLogs,
  });
}

async function createBranch(req, res) {
  const parsed = branchSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid branch", errors: parsed.error.flatten().fieldErrors });

  const shopId = req.auth.shopId;
  const { branches } = await getShopSettings(shopId);
  const now = new Date().toISOString();
  const branch = branchView({
    id: randomUUID(),
    ...parsed.data,
    code: String(parsed.data.code || `BR-${branches.length + 1}`).trim().toUpperCase(),
    active: parsed.data.active !== false,
    createdAt: now,
    updatedAt: now,
  });

  await saveBranches(shopId, [branch, ...branches]);
  await audit(req, "SHOP_BRANCH_CREATED", "branch", branch.id, branch);
  res.status(201).json({ ok: true, branch });
}

async function updateBranch(req, res) {
  const parsed = branchSchema.partial().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid branch update", errors: parsed.error.flatten().fieldErrors });

  const shopId = req.auth.shopId;
  const { branches } = await getShopSettings(shopId);
  const found = branches.find((item) => item.id === req.params.branchId);
  if (!found) return res.status(404).json({ ok: false, message: "Branch not found" });

  const updated = branchView({
    ...found,
    ...parsed.data,
    code: parsed.data.code !== undefined ? String(parsed.data.code || "").trim().toUpperCase() : found.code,
    updatedAt: new Date().toISOString(),
  });

  await saveBranches(shopId, branches.map((item) => item.id === updated.id ? updated : item));
  await audit(req, "SHOP_BRANCH_UPDATED", "branch", updated.id, parsed.data);
  res.json({ ok: true, branch: updated });
}

async function updateStaff(req, res) {
  const parsed = staffSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid staff update", errors: parsed.error.flatten().fieldErrors });

  const shopId = req.auth.shopId;
  const current = await prisma.user.findFirst({
    where: { id: req.params.userId, shopId },
    select: { id: true, role: true, permissions: true },
  });
  if (!current || current.role === "SUPER_ADMIN") return res.status(404).json({ ok: false, message: "Staff not found in your shop" });

  const currentPermissions = settingsObject(current.permissions);
  const nextPermissions = {
    ...currentPermissions,
    ...(parsed.data.permissions || {}),
  };

  if (parsed.data.branchId !== undefined) nextPermissions.branchId = parsed.data.branchId || "";
  if (parsed.data.staffTitle !== undefined) nextPermissions.staffTitle = parsed.data.staffTitle || "";

  const data = { permissions: nextPermissions };
  if (parsed.data.active !== undefined) data.active = parsed.data.active;
  if (parsed.data.role !== undefined) data.role = parsed.data.role;

  const user = await prisma.user.update({
    where: { id: current.id },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      permissions: true,
      active: true,
      authProvider: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  await audit(req, "SHOP_STAFF_UPDATED", "user", user.id, { ...parsed.data, permissions: nextPermissions });
  res.json({ ok: true, user: publicStaff(user) });
}

async function resetStaffPassword(req, res) {
  const parsed = resetPasswordSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid password reset", errors: parsed.error.flatten().fieldErrors });

  const staff = await prisma.user.findFirst({
    where: { id: req.params.userId, shopId: req.auth.shopId },
    select: { id: true, role: true },
  });
  if (!staff || staff.role === "SUPER_ADMIN") return res.status(404).json({ ok: false, message: "Staff not found in your shop" });

  await prisma.user.update({
    where: { id: staff.id },
    data: {
      passwordHash: await bcrypt.hash(parsed.data.password, 12),
      passwordMustChange: parsed.data.mustChange,
    },
  });

  await audit(req, "SHOP_STAFF_PASSWORD_RESET", "user", staff.id, { mustChange: parsed.data.mustChange });
  res.json({ ok: true, message: "Staff password reset completed" });
}

function attachShopAdminBranchControlApi(app) {
  app.get("/api/shop-admin/branches/overview", requireAuth, requireShopAdmin, overview);
  app.post("/api/shop-admin/branches", requireAuth, requireShopAdmin, createBranch);
  app.patch("/api/shop-admin/branches/:branchId", requireAuth, requireShopAdmin, updateBranch);
  app.patch("/api/shop-admin/staff/:userId", requireAuth, requireShopAdmin, updateStaff);
  app.patch("/api/shop-admin/staff/:userId/password", requireAuth, requireShopAdmin, resetStaffPassword);
}

module.exports = attachShopAdminBranchControlApi;
