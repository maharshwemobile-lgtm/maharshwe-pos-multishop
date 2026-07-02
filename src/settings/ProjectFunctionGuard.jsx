import React, { useEffect } from 'react';
import { subscribeSession } from '../phase2Api';
import { currentUser, hasPermission, isProjectSuperAdmin } from './projectAccess';

const RULES = [
  { permission: 'reprint', pattern: /\b(reprint|print receipt|print voucher|voucher print)\b/i, fallback: false },
  { permission: 'export', pattern: /\b(export|download csv|export csv)\b/i, fallback: false },
  { permission: 'deleteSale', pattern: /\b(void sale|confirm void|delete sale)\b/i, fallback: false },
  { permission: 'repairCreate', pattern: /\b(new repair|create repair|repair intake)\b/i, fallback: false },
  { permission: 'repairEdit', pattern: /\b(save status|save finance|sync now|link provider|device identity linked|link\b)\b/i, fallback: false },
  { permission: 'repairPrint', pattern: /\b(print repair|repair voucher)\b/i, fallback: false },
  { permission: 'repairImport', pattern: /\b(import existing repair|import repair|\bimport\b)\b/i, fallback: false },
  { permission: 'stockAdjust', pattern: /\b(stock in|stock out|adjustment|damage|repair usage|save stock)\b/i, fallback: false },
  { permission: 'productEdit', pattern: /\b(new product|add product|create product|edit product|save product|delete product)\b/i, fallback: false },
  { permission: 'purchaseApprove', pattern: /\b(approve purchase|approve po|confirm approve)\b/i, fallback: false },
  { permission: 'purchaseReceive', pattern: /\b(receive goods|goods receiving|confirm receive|save receiving)\b/i, fallback: false },
  { permission: 'purchasePayment', pattern: /\b(pay supplier|supplier payment|record payment)\b/i, fallback: false },
  { permission: 'purchaseReturn', pattern: /\b(supplier return|purchase return|confirm return)\b/i, fallback: false },
  { permission: 'settings', pattern: /\b(save business profile|save slip information|save appearance|save api|save postgresql settings|create user|save user access|reset password)\b/i, fallback: false },
];

function ruleFor(element) {
  const explicit = element.getAttribute('data-permission');
  if (explicit) return { permission: explicit, fallback: false };
  const text = String(element.textContent || element.getAttribute('aria-label') || element.title || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return RULES.find((rule) => rule.pattern.test(text)) || null;
}

function applyGuard(root) {
  const user = currentUser();
  if (!root || !user) return;
  const superAdmin = isProjectSuperAdmin(user);
  root.querySelectorAll('button,a,[role="button"],[data-permission]').forEach((element) => {
    const rule = ruleFor(element);
    if (!rule) return;
    const allowed = superAdmin || hasPermission(rule.permission, rule.fallback, user);
    element.hidden = !allowed;
    element.setAttribute('aria-hidden', allowed ? 'false' : 'true');
    if (!allowed) element.setAttribute('data-permission-hidden', rule.permission);
    else element.removeAttribute('data-permission-hidden');
  });
}

export default function ProjectFunctionGuard({ children }) {
  useEffect(() => {
    const root = document.getElementById('mahar-project-root') || document.body;
    const run = () => applyGuard(root);
    run();
    const observer = new MutationObserver(run);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    const unsubscribe = subscribeSession(run);
    window.addEventListener('focus', run);
    return () => {
      observer.disconnect();
      unsubscribe();
      window.removeEventListener('focus', run);
    };
  }, []);

  return <div id="mahar-project-root">{children}</div>;
}
