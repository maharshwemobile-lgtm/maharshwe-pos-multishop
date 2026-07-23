CREATE TABLE IF NOT EXISTS ecommerce_store_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), shop_id UUID NOT NULL UNIQUE REFERENCES shops(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE, store_name TEXT, description TEXT, contact_phone TEXT,
  delivery_enabled BOOLEAN NOT NULL DEFAULT TRUE, pickup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ecommerce_product_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE, visible BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT, featured BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ecommerce_product_details_shop_visible_idx ON ecommerce_product_details(shop_id, visible);
CREATE TABLE IF NOT EXISTS ecommerce_product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE, url TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'UPLOAD',
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ecommerce_product_images_shop_product_idx ON ecommerce_product_images(shop_id, product_id, sort_order);
CREATE TABLE IF NOT EXISTS ecommerce_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, delivery_address TEXT,
  fulfillment_method TEXT NOT NULL CHECK (fulfillment_method IN ('COD','PICKUP')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','READY','COMPLETED','CANCELLED')),
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, order_number)
);
CREATE INDEX IF NOT EXISTS ecommerce_orders_shop_status_created_idx ON ecommerce_orders(shop_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS ecommerce_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES ecommerce_orders(id) ON DELETE CASCADE,
  product_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_name_snapshot TEXT NOT NULL, variant_name_snapshot TEXT, unit_price NUMERIC(14,2) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0), line_total NUMERIC(14,2) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ecommerce_order_items_order_idx ON ecommerce_order_items(order_id);
CREATE INDEX IF NOT EXISTS ecommerce_order_items_variant_idx ON ecommerce_order_items(product_variant_id);
