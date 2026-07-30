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
    badge: 'FIRST LOGIN',
    title: 'ပစ္စည်းတွေ အရင်ထည့်ပါ',
    text: 'ရောင်းဖို့အတွက် Items / Products မှာ ပစ္စည်းနာမည်၊ ဈေးနှုန်းနဲ့ လက်ကျန် အရင်ထည့်ပါ။',
    actions: [{ key: 'go-products', label: 'Items / Products ဖွင့်မယ်', page: 'Products', icon: Box }],
  },
  Products: {
    badge: 'PRODUCT SETUP',
    title: 'Add Product တစ်ခါတည်းနဲ့ ပြီးပါပြီ',
    text: 'ပစ္စည်းနာမည်၊ ဈေးနှုန်း၊ လက်ကျန်ကို Add Product form တစ်ခုတည်းမှာ ထည့်လိုက်ပါ။ Category မထည့်လည်း ရပါတယ်။',
    actions: [
      { key: 'add-product', label: 'Add Product form ဖွင့်မယ်', action: 'add-product', icon: Box },
      { key: 'go-sale', label: 'Sale POS မှာရောင်းမယ်', page: 'Sale POS', icon: ShoppingCart },
    ],
  },
  Stock: {
    badge: 'STOCK GUIDE',
    title: 'လက်ကျန်နဲ့ သက်တမ်း စစ်ပါ',
    text: 'ပစ္စည်းတစ်ခုချင်းစီရဲ့ လက်ကျန်၊ Low Stock သတိပေးချက်နဲ့ သက်တမ်းကုန်ရက်ကို ဒီမှာ ပြင်နိုင်ပါတယ်။',
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
