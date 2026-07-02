CREATE TABLE "purchase_order_items" (
  "id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,
  "product_name_snapshot" VARCHAR(180) NOT NULL,
  "variant_name_snapshot" VARCHAR(180),
  "sku_snapshot" VARCHAR(100),
  "ordered_quantity" INTEGER NOT NULL,
  "received_quantity" INTEGER NOT NULL DEFAULT 0,
  "unit_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "line_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_items_quantities_check" CHECK ("ordered_quantity" > 0 AND "received_quantity" >= 0 AND "received_quantity" <= "ordered_quantity"),
  CONSTRAINT "purchase_order_items_amounts_check" CHECK ("unit_cost" >= 0 AND "line_total" >= 0),
  CONSTRAINT "purchase_order_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE,
  CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  CONSTRAINT "purchase_order_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT
);

CREATE INDEX "purchase_order_items_shop_id_purchase_order_id_idx" ON "purchase_order_items"("shop_id", "purchase_order_id");
CREATE INDEX "purchase_order_items_shop_id_product_variant_id_idx" ON "purchase_order_items"("shop_id", "product_variant_id");
