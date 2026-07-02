import React from 'react';
import {
  BatteryCharging,
  Cable,
  Camera,
  Gamepad2,
  HardDrive,
  Headphones,
  Laptop,
  Mouse,
  Package,
  PlugZap,
  Shield,
  Smartphone,
  Speaker,
  Tablet,
  Watch,
  Wrench,
} from 'lucide-react';
import './product-category-icon.css';

function searchableText(item = {}) {
  return [
    item.productType,
    item.type,
    item.category,
    item.categoryName,
    item.category?.name,
    item.groupName,
    item.productName,
    item.name,
    item.brand,
    item.model,
    item.product?.productType,
    item.product?.groupName,
    item.product?.name,
    item.product?.brand,
    item.product?.model,
  ].filter(Boolean).join(' ').toLowerCase();
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function info(kind, Icon, label, tone) {
  return { kind, Icon, label, tone };
}

export function productIconInfo(item) {
  const text = searchableText(item);

  if (includesAny(text, ['earphone', 'earbuds', 'headphone', 'headset', 'airpod', 'နားကြပ်'])) return info('earphone', Headphones, 'Earphone', 'purple');
  if (includesAny(text, ['charger', 'adapter', 'charging head', 'power adapter', 'အားသွင်းခေါင်း'])) return info('charger', PlugZap, 'Charger', 'orange');
  if (includesAny(text, ['cable', 'usb cable', 'type-c', 'type c', 'lightning cable', 'ကြိုး'])) return info('cable', Cable, 'Cable', 'blue');
  if (includesAny(text, ['battery', 'ဘက်ထရီ'])) return info('battery', BatteryCharging, 'Battery', 'green');
  if (includesAny(text, ['cover', 'case', 'casing', 'bumper', 'screen protector', 'tempered', 'glass', 'မှန်', 'ကာဗာ'])) return info('cover', Shield, 'Cover / Glass', 'pink');
  if (includesAny(text, ['speaker', 'bluetooth speaker', 'စပီကာ'])) return info('speaker', Speaker, 'Speaker', 'amber');
  if (includesAny(text, ['smart watch', 'smartwatch', 'watch', 'နာရီ'])) return info('watch', Watch, 'Watch', 'cyan');
  if (includesAny(text, ['tablet', 'ipad', 'galaxy tab'])) return info('tablet', Tablet, 'Tablet', 'indigo');
  if (includesAny(text, ['laptop', 'notebook', 'computer', 'desktop', 'ကွန်ပျူတာ'])) return info('computer', Laptop, 'Computer', 'slate');
  if (includesAny(text, ['memory', 'sd card', 'flash drive', 'usb drive', 'storage', 'hard disk', 'ssd'])) return info('storage', HardDrive, 'Storage', 'teal');
  if (includesAny(text, ['mouse', 'မောက်စ်'])) return info('mouse', Mouse, 'Mouse', 'slate');
  if (includesAny(text, ['camera', 'ကင်မရာ'])) return info('camera', Camera, 'Camera', 'blue');
  if (includesAny(text, ['gamepad', 'controller', 'gaming'])) return info('gaming', Gamepad2, 'Gaming', 'red');
  if (includesAny(text, ['spare part', 'repair part', 'service part', 'lcd', 'display', 'flex', 'အပိုပစ္စည်း'])) return info('repair', Wrench, 'Repair Part', 'red');
  if (includesAny(text, [
    'phone', 'mobile', 'smartphone', 'handset', 'iphone', 'redmi', 'xiaomi', 'poco',
    'samsung', 'oppo', 'vivo', 'realme', 'honor', 'huawei', 'tecno', 'infinix',
    'nokia', 'itel', 'oneplus', 'ဖုန်း',
  ])) return info('phone', Smartphone, 'Phone', 'green');
  if (includesAny(text, ['accessories', 'accessory', 'အက်ဆက်စရီ'])) return info('accessories', Package, 'Accessories', 'violet');

  return info('product', Package, 'Product', 'gray');
}

export default function ProductCategoryIcon({ item, size = 20, className = '' }) {
  const { Icon, label, tone } = productIconInfo(item);
  return (
    <span className={`product-kind-icon product-kind-${tone} ${className}`.trim()} title={label} aria-label={label}>
      <Icon size={size} strokeWidth={2.2} />
    </span>
  );
}
