import React, { useEffect } from 'react';

const STORAGE_KEY = 'mahar-pos-language-v2';
const MYANMAR = {
  Dashboard: 'ဒက်ရှ်ဘုတ်',
  'Sale POS': 'အရောင်း POS',
  'Sales History': 'အရောင်းမှတ်တမ်း',
  'Repair Platform': 'ဖုန်းပြင်စနစ်',
  'Advanced Repair Platform': 'အဆင့်မြင့်ဖုန်းပြင်စနစ်',
  'Partner & Settlement': 'မိတ်ဖက်နှင့် စာရင်းရှင်း',
  Products: 'ကုန်ပစ္စည်းများ',
  Stock: 'စတော့',
  Purchases: 'အဝယ်စာရင်း',
  'Customers & Credit': 'ဖောက်သည်နှင့် အကြွေး',
  'Finance & Accounts': 'ငွေစာရင်း',
  'Reports & Performance': 'အစီရင်ခံစာ',
  'Audit Trail': 'လုပ်ဆောင်မှုမှတ်တမ်း',
  'Backup & Recovery': 'Backup နှင့် Recovery',
  'Project Settings': 'Project Settings',
  'Money Service': 'ငွေလွှဲဝန်ဆောင်မှု',
  'Other Records': 'အခြား ဝင်ငွေနှင့်ထွက်ငွေ',
  'About Us': 'အကြောင်းအရာ',
  'Day Closed': 'နေ့ပိတ်ပြီး',
  'Daily Transfer / Cash Out Ledger': 'နေ့စဉ် ငွေလွှဲ / ငွေထုတ် စာရင်း',
  'Menu': 'မီနူး',
  Logout: 'ထွက်မည်',
  Refresh: 'ပြန်ဖတ်မည်',
  Save: 'သိမ်းမည်',
  Search: 'ရှာမည်',
  Print: 'ပရင့်ထုတ်မည်',
  'My Preference': 'ကျွန်ုပ်၏ Preference',
  'My Own Preference': 'ကျွန်ုပ်၏ Preference',
  'Slip Information': 'Slip အချက်အလက်',
  'Business Profile': 'ဆိုင်အချက်အလက်',
  'Appearance & Language': 'အပြင်အဆင်နှင့် ဘာသာစကား',
  'API Configure': 'API ချိတ်ဆက်မှု',
  'Users & Access': 'User နှင့် အသုံးပြုခွင့်',
  'PostgreSQL Settings': 'System Settings',
  'Save My Preference': 'Preference သိမ်းမည်',
  'Save Slip Information': 'Slip အချက်အလက် သိမ်းမည်',
  'Save Business Profile': 'ဆိုင်အချက်အလက် သိမ်းမည်',
  'Save Appearance': 'အပြင်အဆင် သိမ်းမည်',
  Language: 'ဘာသာစကား',
  Theme: 'အပြင်အဆင်',
  'Default Language': 'ပုံသေ ဘာသာစကား',
  'Default Theme': 'ပုံသေ အပြင်အဆင်',
  'Default Opening Page': 'စဖွင့်မည့် စာမျက်နှာ',
  Sidebar: 'ဘေးဘား',
  'Table Density': 'ဇယားအကွာအဝေး',
  'Page Size': 'စာမျက်နှာအရေအတွက်',
  'Date Format': 'ရက်စွဲပုံစံ',
  'Time Format': 'အချိန်ပုံစံ',
  Light: 'အလင်း',
  Dark: 'အမှောင်',
  System: 'စက်၏ပုံစံ',
  English: 'အင်္ဂလိပ်',
  'Business Name': 'လုပ်ငန်းအမည်',
  Subtitle: 'စာတန်းခွဲ',
  'Primary Phone': 'အဓိကဖုန်း',
  'Secondary Phone': 'ဒုတိယဖုန်း',
  Address: 'လိပ်စာ',
  'Township / Region': 'မြို့နယ် / ဒေသ',
  Website: 'Website',
  'Google Map URL': 'Google Map လင့်ခ်',
  'KBZ Pay Number': 'KBZ Pay နံပါတ်',
  'Wave Pay Number': 'Wave Pay နံပါတ်',
  'License Status': 'License အခြေအနေ',
  'Repair Voucher Print': 'Repair Voucher ထုတ်မည်',
  'New Repair': 'Repair အသစ်',
  'Access Denied': 'အသုံးပြုခွင့် မရှိပါ',
  'Back to Dashboard': 'Dashboard သို့ ပြန်မည်',
};

const ENGLISH = Object.fromEntries(Object.entries(MYANMAR).map(([en, my]) => [my, en]));
const textState = new WeakMap();

function normalizedLanguage(value) {
  return value === 'en' ? 'en' : 'my';
}

function canonicalText(value) {
  const trimmed = value.trim();
  return ENGLISH[trimmed] ? value.replace(trimmed, ENGLISH[trimmed]) : value;
}

function translatedText(value, language) {
  if (language === 'en') return value;
  const trimmed = value.trim();
  return MYANMAR[trimmed] ? value.replace(trimmed, MYANMAR[trimmed]) : value;
}

function translateNode(node, language) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const parent = node.parentElement;
  if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE'].includes(parent.tagName)) return;
  const current = node.nodeValue || '';
  if (/^\s*PHASE\s*\d+/i.test(current.trim())) {
    node.nodeValue = '';
    return;
  }
  if (!current.trim()) return;

  const previous = textState.get(node);
  const canonical = previous && current === previous.lastApplied
    ? previous.canonical
    : canonicalText(current);
  const next = translatedText(canonical, language);
  textState.set(node, { canonical, lastApplied: next });
  if (current !== next) node.nodeValue = next;
}

function translateTree(root, language) {
  if (!root || typeof document === 'undefined') return;
  if (root.nodeType === Node.TEXT_NODE) {
    translateNode(root, language);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root !== document.body) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    translateNode(node, language);
    node = walker.nextNode();
  }
}

export function applyProjectLanguage(language) {
  if (typeof document === 'undefined') return;
  const selected = normalizedLanguage(language);
  document.documentElement.lang = selected;
  document.documentElement.dataset.language = selected;
  try {
    window.localStorage.setItem(STORAGE_KEY, selected);
  } catch {
    // Storage can be unavailable in privacy mode.
  }
  translateTree(document.body, selected);
  window.dispatchEvent(new CustomEvent('mahar-project-language', { detail: selected }));
}

export default function ProjectLanguageRuntime({ children }) {
  useEffect(() => {
    let language = normalizedLanguage(
      window.localStorage.getItem(STORAGE_KEY)
      || document.documentElement.dataset.language
      || 'my',
    );
    applyProjectLanguage(language);

    const observer = new MutationObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.type === 'characterData') translateNode(entry.target, language);
        entry.addedNodes.forEach((node) => translateTree(node, language));
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    const handleLanguage = (event) => {
      language = normalizedLanguage(event.detail);
      translateTree(document.body, language);
    };
    window.addEventListener('mahar-project-language', handleLanguage);

    return () => {
      observer.disconnect();
      window.removeEventListener('mahar-project-language', handleLanguage);
    };
  }, []);

  return children;
}
