/* Shared UI kit.
 *
 * Every page composes these primitives instead of styling itself, which is what keeps the
 * app visually consistent. Ported from the Wallet Note kit, with one deliberate change:
 * colours come from the app's runtime tokens (--project-*) via the Tailwind bridge in
 * tailwind.css, not from hardcoded grays. That means light/dark and the Appearance accent
 * setting work automatically here, with no `dark:` variant on every element.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { X } from 'lucide-react';

export function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

/* Status pills keep explicit colours — these carry meaning, not theme. */
export const STATUS_COLORS = {
  OPEN: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  DRAFT: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  CLOSED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  SETTLED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  DONE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  PAID: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  APPROVED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  IN_STOCK: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  PARTIAL: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  LOW_STOCK: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  IN_PROGRESS: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  UNPAID: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  OVERDUE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  OUT_OF_STOCK: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  VOIDED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  REVERSED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  CANCELLED: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  WRITTEN_OFF: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

export function Card({ children, className }) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface p-3 shadow-sm sm:p-4', className)}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, onClick, tone = 'default' }) {
  const tones = {
    green: 'text-green-600 dark:text-green-400',
    red: 'text-red-600 dark:text-red-400',
    blue: 'text-blue-600 dark:text-blue-400',
    amber: 'text-amber-600 dark:text-amber-400',
    default: 'text-ink',
  };
  // Renders as a button only when it actually does something, so screen readers and
  // keyboard users are not offered a dead control.
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={cn(
        'w-full rounded-xl border border-line bg-surface p-3 text-left shadow-sm sm:p-4',
        onClick && 'transition hover:shadow-md'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
          <div className={cn('mt-1 text-lg font-bold tabular-nums sm:text-xl', tones[tone])}>{value}</div>
          {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
        </div>
        {Icon ? <Icon size={20} className="shrink-0 text-muted" /> : null}
      </div>
    </Tag>
  );
}

export function Button({
  children, onClick, type = 'button', variant = 'primary',
  disabled, className, size = 'md', title, ...rest
}) {
  const variants = {
    primary: 'bg-accent text-white hover:brightness-95',
    secondary: 'border border-line bg-surface text-ink hover:bg-surface-2',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    // bg-transparent is explicit because preflight is not loaded, so a bare <button>
    // would otherwise keep the browser's default grey button face.
    ghost: 'bg-transparent text-muted hover:bg-surface-2',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        size === 'sm' ? 'min-h-9 px-2.5 py-1.5 text-xs' : 'min-h-10 px-4 py-2 text-sm',
        variants[variant],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Input({ label, error, hint, className, ...props }) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-sm font-medium text-ink">{label}</span> : null}
      <input
        {...props}
        className={cn(
          'min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink outline-none',
          'focus:border-accent focus:ring-2 focus:ring-accent/20',
          'disabled:opacity-60 sm:min-h-10 sm:text-sm',
          error && 'border-red-500',
          className
        )}
      />
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
      {!error && hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Textarea({ label, error, hint, className, ...props }) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-sm font-medium text-ink">{label}</span> : null}
      <textarea
        {...props}
        className={cn(
          'w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink outline-none',
          'focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-sm',
          error && 'border-red-500',
          className
        )}
      />
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
      {!error && hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Select({ label, children, hint, className, ...props }) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-sm font-medium text-ink">{label}</span> : null}
      <select
        {...props}
        className={cn(
          'min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink outline-none',
          'focus:border-accent focus:ring-2 focus:ring-accent/20',
          'disabled:opacity-60 sm:min-h-10 sm:text-sm',
          className
        )}
      >
        {children}
      </select>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Badge({ status, children, className }) {
  const key = String(status ?? '').toUpperCase().replace(/[\s-]/g, '_');
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-semibold',
        STATUS_COLORS[key] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
        className
      )}
    >
      {children ?? String(status ?? '').replace(/_/g, ' ')}
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // Stop the page behind the sheet from scrolling while it is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          'max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-2xl bg-surface p-4 shadow-xl',
          'pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-h-[92vh] sm:rounded-xl sm:p-5',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="min-w-0 text-base font-semibold text-ink sm:text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-10 min-w-10 shrink-0 rounded-lg bg-transparent p-2 text-muted hover:bg-surface-2"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Table({ headers, children, rightAlign }) {
  return (
    <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-line">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            {headers.map((h, i) => (
              <th key={`${h}-${i}`} className={cn('px-3 py-2.5 font-semibold', rightAlign?.includes(i) && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-surface">{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ message, icon: Icon }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted">
      {Icon ? <Icon size={34} className="opacity-60" /> : null}
      <span>{message}</span>
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label ? <span className="text-sm text-muted">{label}</span> : null}
    </div>
  );
}

/* ---- toast ---- */
const ToastCtx = createContext({ push: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg',
              t.kind === 'success' ? 'bg-green-600' : 'bg-red-600'
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, danger }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-sm text-muted">{message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>
          {confirmLabel ?? 'Confirm'}
        </Button>
      </div>
    </Modal>
  );
}
