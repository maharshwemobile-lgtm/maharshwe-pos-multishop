import React from 'react';
import { ArrowRight, Box, PackagePlus, ShoppingCart, X } from 'lucide-react';
import './first-login-guide.css';

const PHONE_SHOP_CONTENT = {
  'Sale POS': {
    badge: 'PHONE SHOP FIRST LOGIN',
    title: 'အရင်ဆုံး Product / Variant / Stock ထည့်ပြီးမှ ရောင်းပါ',
    text: 'Phone Shop အတွက် Products page မှာ Product, Variant, Price, Stock နဲ့ IMEI လို/မလို အရင်သတ်မှတ်ပါ။',
    actions: [{ key: 'go-products', label: 'Products page ဖွင့်မယ်', page: 'Products', icon: Box }],
  },
  Products: {
    badge: 'PHONE SHOP PRODUCT SETUP',
    title: 'Product → Variant → Price → Stock အဆင့်ဆင့်ထည့်ပါ',
    text: 'Add Product ကိုနှိပ်ပြီး Product သိမ်းပါ။ ပြီးရင် Add Variant မှာ Selling Price, Minimum Price, Opening Stock ထည့်ပါ။',
    actions: [
      { key: 'add-product', label: 'Add Product form ဖွင့်မယ်', action: 'add-product', icon: Box },
      { key: 'add-variant', label: 'Add Variant / Stock ထည့်မယ်', action: 'add-variant', icon: PackagePlus },
      { key: 'go-sale', label: 'Sale POS သွားမယ်', page: 'Sale POS', icon: ShoppingCart },
    ],
  },
  Stock: {
    badge: 'STOCK GUIDE',
    title: 'Stock ကို Product Variant မှတစ်ဆင့်စစ်ပါ',
    text: 'Opening Stock ကို Variant ထဲမှာထည့်ပြီး Sale POS မှာ ရောင်းချပါ။',
    actions: [{ key: 'go-sale', label: 'Sale POS သွားမယ်', page: 'Sale POS', icon: ShoppingCart }],
  },
};

const MINI_MART_CONTENT = {
  'Sale POS': {
    badge: 'MINI MART FIRST LOGIN',
    title: 'Mini Mart မှာ Product / Unit / Expiry / Stock အရင်ထည့်ပါ',
    text: 'Mini Mart ရောင်းချမှုအတွက် Products page မှာ Barcode, Unit, Expiry Date, Price, Opening Stock အရင်သတ်မှတ်ပါ။',
    actions: [{ key: 'go-products', label: 'Products page ဖွင့်မယ်', page: 'Products', icon: Box }],
  },
  Products: {
    badge: 'MINI MART PRODUCT SETUP',
    title: 'Product → Unit → Expiry → Opening Stock ထည့်ပါ',
    text: 'Add Product ပြီးရင် Add Variant မှာ Barcode, Unit, Expiry Date, Selling Price, Opening Stock ထည့်ပါ။ ပြီးမှ Sale POS မှာရောင်းပါ။',
    actions: [
      { key: 'add-product', label: 'Add Product form ဖွင့်မယ်', action: 'add-product', icon: Box },
      { key: 'add-variant', label: 'Variant / Unit / Expiry ထည့်မယ်', action: 'add-variant', icon: PackagePlus },
      { key: 'go-sale', label: 'Sale POS မှာရောင်းမယ်', page: 'Sale POS', icon: ShoppingCart },
    ],
  },
  Stock: {
    badge: 'MINI MART STOCK GUIDE',
    title: 'Stock / Expiry ကို Variant မှတစ်ဆင့်စစ်ပါ',
    text: 'Opening Stock, Low Stock Alert, Expiry Date ကို Variant ထဲမှာထည့်ပြီး Sale POS မှာရောင်းပါ။',
    actions: [{ key: 'go-sale', label: 'Sale POS သွားမယ်', page: 'Sale POS', icon: ShoppingCart }],
  },
};

const CONTENT_BY_TYPE = {
  PHONE_SHOP: PHONE_SHOP_CONTENT,
  MINI_MART: MINI_MART_CONTENT,
};

function normalizeBusinessType(value) {
  return String(value || '').toUpperCase() === 'MINI_MART' ? 'MINI_MART' : 'PHONE_SHOP';
}

export default function FirstLoginGuide({ currentPage, businessType = 'PHONE_SHOP', onNavigate, onAction, onDismiss }) {
  const type = normalizeBusinessType(businessType);
  const content = CONTENT_BY_TYPE[type]?.[currentPage] || CONTENT_BY_TYPE[type]?.['Sale POS'] || PHONE_SHOP_CONTENT['Sale POS'];

  return (
    <section className="first-login-guide">
      <button type="button" className="first-login-guide-close" onClick={onDismiss} aria-label="Cancel guide"><X size={15}/></button>
      <div>
        <span>{content.badge}</span>
        <h3>{content.title}</h3>
        <p>{content.text}</p>
      </div>
      <div className="first-login-guide-actions">
        {content.actions.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} type="button" onClick={() => item.page ? onNavigate?.(item.page) : onAction?.(item.action)}>
              <Icon size={17}/>
              {item.label}
              <ArrowRight size={14}/>
            </button>
          );
        })}
        <button type="button" className="first-login-guide-skip" onClick={onDismiss}>
          <X size={15}/>
          Skip Guide
        </button>
      </div>
    </section>
  );
}
