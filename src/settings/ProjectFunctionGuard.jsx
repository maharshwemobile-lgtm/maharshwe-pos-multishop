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

const CONTROLS = 'button,a,[role="button"],[data-permission]';

// Reading textContent and running 15 regexes over every control in the app is
// the expensive half of this guard. An element's rule only changes when its
// text does, so remember the answer against the text it came from.
const ruleCache = new WeakMap();

function ruleFor(element) {
  const explicit = element.getAttribute('data-permission');
  if (explicit) return { permission: explicit, fallback: false };
  const text = String(element.textContent || element.getAttribute('aria-label') || element.title || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const cached = ruleCache.get(element);
  if (cached && cached.text === text) return cached.rule;
  const rule = RULES.find((item) => item.pattern.test(text)) || null;
  ruleCache.set(element, { text, rule });
  return rule;
}

function guardElement(element, superAdmin, user) {
  const rule = ruleFor(element);
  if (!rule) return;
  const allowed = superAdmin || hasPermission(rule.permission, rule.fallback, user);
  // Only write when the answer changed: every write feeds the observer.
  if (element.hidden !== !allowed) element.hidden = !allowed;
  const ariaHidden = allowed ? 'false' : 'true';
  if (element.getAttribute('aria-hidden') !== ariaHidden) element.setAttribute('aria-hidden', ariaHidden);
  if (!allowed) {
    if (element.getAttribute('data-permission-hidden') !== rule.permission) {
      element.setAttribute('data-permission-hidden', rule.permission);
    }
  } else if (element.hasAttribute('data-permission-hidden')) {
    element.removeAttribute('data-permission-hidden');
  }
}

function applyGuard(root) {
  const user = currentUser();
  if (!root || !user) return;
  const superAdmin = isProjectSuperAdmin(user);
  if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(CONTROLS)) guardElement(root, superAdmin, user);
  root.querySelectorAll?.(CONTROLS).forEach((element) => guardElement(element, superAdmin, user));
}

export default function ProjectFunctionGuard({ children }) {
  useEffect(() => {
    const root = document.getElementById('mahar-project-root') || document.body;
    const run = () => applyGuard(root);
    run();

    // React commits, and the language runtime rewriting text after them, fire
    // hundreds of mutations while a page mounts. Rescanning the whole app on
    // each one — and writing attributes back, which fires the observer again —
    // is what made the heavier pages settle visibly. Collect the changed
    // subtrees and sweep them once per frame instead.
    let pending = null;
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const batch = pending;
      pending = null;
      if (!batch) return;
      batch.forEach((node) => {
        if (node.isConnected) applyGuard(node);
      });
    };
    const queue = (node) => {
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (!element) return;
      if (!pending) pending = new Set();
      pending.add(element);
      if (!scheduled) {
        scheduled = true;
        window.requestAnimationFrame(flush);
      }
    };
    const observer = new MutationObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.type === 'characterData') queue(entry.target);
        entry.addedNodes.forEach(queue);
      });
    });
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
