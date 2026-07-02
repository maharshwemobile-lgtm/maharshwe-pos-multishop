-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'OVERDUE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'SHOP_ADMIN', 'CASHIER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'REFUNDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'KPAY', 'WAVE_PAY', 'MIXED', 'OTHER');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'VOIDED', 'RETURNED', 'PARTIAL_RETURN');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('STOCK_IN', 'SALE', 'SALE_RETURN', 'DAMAGE', 'ADJUSTMENT', 'REPAIR_USAGE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "RepairStatus" AS ENUM ('RECEIVED', 'CHECKING', 'IN_PROGRESS', 'WAITING_PART', 'COMPLETED', 'CANNOT_REPAIR', 'DELIVERED');

-- CreateEnum
CREATE TYPE "MoneyAccountType" AS ENUM ('CASH', 'KPAY', 'WAVE_PAY', 'OTHER');

-- CreateEnum
CREATE TYPE "MoneyServiceType" AS ENUM ('KPAY_TRANSFER', 'KPAY_CASH_OUT', 'WAVE_PAY_TRANSFER', 'WAVE_PAY_CASH_OUT', 'ACCOUNT_ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "MoneyFeeMode" AS ENUM ('PROPORTIONAL', 'ROUND_UP_PER_100000', 'MANUAL');

-- CreateTable
CREATE TABLE "shops" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "logo_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "setup_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "monthly_fee" DECIMAL(14,2) NOT NULL DEFAULT 50000,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "renewed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "shop_id" UUID,
    "username" TEXT NOT NULL,
    "normalized_username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_settings" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "receipt_header" TEXT,
    "receipt_footer" TEXT,
    "invoice_prefix" TEXT NOT NULL DEFAULT 'MS',
    "repair_prefix" TEXT NOT NULL DEFAULT 'RP',
    "currency" TEXT NOT NULL DEFAULT 'MMK',
    "language" TEXT NOT NULL DEFAULT 'my',
    "theme" TEXT NOT NULL DEFAULT 'light',
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "minimum_price_approval_required" BOOLEAN NOT NULL DEFAULT true,
    "money_service_rates" JSONB NOT NULL DEFAULT '{}',
    "repair_statuses" JSONB NOT NULL DEFAULT '[]',
    "warranty_text" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "category_id" UUID,
    "group_name" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "product_type" TEXT,
    "requires_serial" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "category_id" UUID,
    "variant_name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "ram" TEXT,
    "storage" TEXT,
    "color" TEXT,
    "cost_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "standard_selling_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "minimum_selling_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "min_alert_quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity_change" INTEGER NOT NULL,
    "before_quantity" INTEGER NOT NULL,
    "after_quantity" INTEGER NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "customer_id" UUID,
    "user_id" UUID NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cost_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "profit_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "sold_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "product_name_snapshot" TEXT NOT NULL,
    "variant_name_snapshot" TEXT,
    "category_name_snapshot" TEXT,
    "imei_serial" TEXT,
    "cost_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "standard_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "minimum_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "actual_sold_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "profit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PAID',
    "reference" TEXT,
    "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repairs" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "repair_number" TEXT NOT NULL,
    "customer_id" UUID,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "device_brand" TEXT,
    "device_model" TEXT,
    "imei_serial" TEXT,
    "problem" TEXT NOT NULL,
    "technician_id" UUID,
    "estimated_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "final_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deposit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "status" "RepairStatus" NOT NULL DEFAULT 'RECEIVED',
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "repairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_payments" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "repair_id" UUID NOT NULL,
    "received_by_id" UUID,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PAID',
    "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_status_history" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "repair_id" UUID NOT NULL,
    "status" "RepairStatus" NOT NULL,
    "changed_by_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_accounts" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "type" "MoneyAccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "money_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_service_transactions" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "account_id" UUID,
    "type" "MoneyServiceType" NOT NULL,
    "fee_mode" "MoneyFeeMode" NOT NULL DEFAULT 'PROPORTIONAL',
    "customer_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fee_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "customer_pays_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "customer_receives_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_change" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wallet_change" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "service_profit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "before_cash_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "after_cash_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "before_wallet_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "after_wallet_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reversal_of_id" UUID,
    "user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_service_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_closings" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "closing_date" DATE NOT NULL,
    "sales_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "product_profit_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "service_income_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "money_profit_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "kpay_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wave_pay_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "daily_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "shop_id" UUID,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "details" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "shops_code_key" ON "shops"("code");

-- CreateIndex
CREATE INDEX "subscriptions_shop_id_status_ends_at_idx" ON "subscriptions"("shop_id", "status", "ends_at");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_shop_id_active_idx" ON "users"("shop_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "users_shop_id_normalized_username_key" ON "users"("shop_id", "normalized_username");

-- CreateIndex
CREATE UNIQUE INDEX "shop_settings_shop_id_key" ON "shop_settings"("shop_id");

-- CreateIndex
CREATE INDEX "categories_shop_id_active_idx" ON "categories"("shop_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "categories_shop_id_name_key" ON "categories"("shop_id", "name");

-- CreateIndex
CREATE INDEX "products_shop_id_name_idx" ON "products"("shop_id", "name");

-- CreateIndex
CREATE INDEX "products_shop_id_active_idx" ON "products"("shop_id", "active");

-- CreateIndex
CREATE INDEX "product_variants_shop_id_active_idx" ON "product_variants"("shop_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_shop_id_sku_key" ON "product_variants"("shop_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_shop_id_barcode_key" ON "product_variants"("shop_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_product_variant_id_key" ON "inventory_balances"("product_variant_id");

-- CreateIndex
CREATE INDEX "inventory_balances_shop_id_quantity_idx" ON "inventory_balances"("shop_id", "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_shop_id_product_variant_id_key" ON "inventory_balances"("shop_id", "product_variant_id");

-- CreateIndex
CREATE INDEX "stock_movements_shop_id_product_variant_id_created_at_idx" ON "stock_movements"("shop_id", "product_variant_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_shop_id_type_created_at_idx" ON "stock_movements"("shop_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "customers_shop_id_phone_idx" ON "customers"("shop_id", "phone");

-- CreateIndex
CREATE INDEX "customers_shop_id_name_idx" ON "customers"("shop_id", "name");

-- CreateIndex
CREATE INDEX "sales_shop_id_sold_at_idx" ON "sales"("shop_id", "sold_at");

-- CreateIndex
CREATE INDEX "sales_shop_id_payment_status_idx" ON "sales"("shop_id", "payment_status");

-- CreateIndex
CREATE INDEX "sales_shop_id_user_id_sold_at_idx" ON "sales"("shop_id", "user_id", "sold_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_shop_id_invoice_number_key" ON "sales"("shop_id", "invoice_number");

-- CreateIndex
CREATE INDEX "sale_items_shop_id_imei_serial_idx" ON "sale_items"("shop_id", "imei_serial");

-- CreateIndex
CREATE INDEX "sale_items_shop_id_product_name_snapshot_idx" ON "sale_items"("shop_id", "product_name_snapshot");

-- CreateIndex
CREATE INDEX "payments_shop_id_method_paid_at_idx" ON "payments"("shop_id", "method", "paid_at");

-- CreateIndex
CREATE INDEX "repairs_shop_id_status_received_at_idx" ON "repairs"("shop_id", "status", "received_at");

-- CreateIndex
CREATE INDEX "repairs_shop_id_imei_serial_idx" ON "repairs"("shop_id", "imei_serial");

-- CreateIndex
CREATE UNIQUE INDEX "repairs_shop_id_repair_number_key" ON "repairs"("shop_id", "repair_number");

-- CreateIndex
CREATE INDEX "repair_payments_shop_id_paid_at_idx" ON "repair_payments"("shop_id", "paid_at");

-- CreateIndex
CREATE INDEX "repair_status_history_shop_id_repair_id_created_at_idx" ON "repair_status_history"("shop_id", "repair_id", "created_at");

-- CreateIndex
CREATE INDEX "money_accounts_shop_id_type_active_idx" ON "money_accounts"("shop_id", "type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "money_accounts_shop_id_name_key" ON "money_accounts"("shop_id", "name");

-- CreateIndex
CREATE INDEX "money_service_transactions_shop_id_type_created_at_idx" ON "money_service_transactions"("shop_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "money_service_transactions_shop_id_user_id_created_at_idx" ON "money_service_transactions"("shop_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closings_shop_id_closing_date_key" ON "daily_closings"("shop_id", "closing_date");

-- CreateIndex
CREATE INDEX "audit_logs_shop_id_action_created_at_idx" ON "audit_logs"("shop_id", "action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repairs" ADD CONSTRAINT "repairs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repairs" ADD CONSTRAINT "repairs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repairs" ADD CONSTRAINT "repairs_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_payments" ADD CONSTRAINT "repair_payments_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_payments" ADD CONSTRAINT "repair_payments_repair_id_fkey" FOREIGN KEY ("repair_id") REFERENCES "repairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_payments" ADD CONSTRAINT "repair_payments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_status_history" ADD CONSTRAINT "repair_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_status_history" ADD CONSTRAINT "repair_status_history_repair_id_fkey" FOREIGN KEY ("repair_id") REFERENCES "repairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_status_history" ADD CONSTRAINT "repair_status_history_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_accounts" ADD CONSTRAINT "money_accounts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_service_transactions" ADD CONSTRAINT "money_service_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_service_transactions" ADD CONSTRAINT "money_service_transactions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "money_service_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_service_transactions" ADD CONSTRAINT "money_service_transactions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_service_transactions" ADD CONSTRAINT "money_service_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Extra tenant and money integrity constraints not expressible in Prisma schema.
CREATE UNIQUE INDEX "users_super_admin_username_key" ON "users"("normalized_username") WHERE "shop_id" IS NULL;

ALTER TABLE "users" ADD CONSTRAINT "users_role_shop_scope_check"
  CHECK (
    ("role" = 'SUPER_ADMIN' AND "shop_id" IS NULL)
    OR ("role" <> 'SUPER_ADMIN' AND "shop_id" IS NOT NULL)
  );

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_date_range_check"
  CHECK ("ends_at" >= "starts_at");

ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_money_nonnegative_check"
  CHECK ("cost_price" >= 0 AND "standard_selling_price" >= 0 AND "minimum_selling_price" >= 0);

ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_quantity_nonnegative_check"
  CHECK ("quantity" >= 0 AND "min_alert_quantity" >= 0);

ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_amounts_valid_check"
  CHECK ("quantity" > 0 AND "cost_price" >= 0 AND "standard_price" >= 0 AND "minimum_price" >= 0 AND "actual_sold_price" >= 0 AND "discount" >= 0);

ALTER TABLE "sales" ADD CONSTRAINT "sales_amounts_nonnegative_check"
  CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "total" >= 0 AND "cost_total" >= 0);

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_nonnegative_check"
  CHECK ("amount" >= 0);

ALTER TABLE "repairs" ADD CONSTRAINT "repairs_amounts_nonnegative_check"
  CHECK ("estimated_cost" >= 0 AND "final_cost" >= 0 AND "deposit" >= 0);

ALTER TABLE "repair_payments" ADD CONSTRAINT "repair_payments_amount_nonnegative_check"
  CHECK ("amount" >= 0);

ALTER TABLE "money_service_transactions" ADD CONSTRAINT "money_service_transactions_amounts_nonnegative_check"
  CHECK ("customer_amount" >= 0 AND "fee_amount" >= 0 AND "customer_pays_amount" >= 0 AND "customer_receives_amount" >= 0 AND "service_profit" >= 0);

ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_amounts_nonnegative_check"
  CHECK ("sales_total" >= 0 AND "product_profit_total" >= 0 AND "service_income_total" >= 0 AND "money_profit_total" >= 0);
