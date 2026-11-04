/**
 * ui.jsx
 * ---------------------------------------------------------------------------
 * Small shared primitives. Keeping them here means every button, field and
 * modal in the app shares one set of focus rings, radii and motion.
 */

import React, { useEffect, useRef } from 'react';

const cx = (...parts) => parts.filter(Boolean).join(' ');
export { cx };

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

const VARIANTS = {
  primary:
    'bg-accent text-white hover:bg-accent-soft shadow-glow disabled:bg-ink-600 disabled:text-slate-500 disabled:shadow-none',
  secondary:
    'bg-ink-700/80 text-slate-200 hover:bg-ink-600 border border-white/10 disabled:text-slate-600',
  ghost:
    'bg-transparent text-slate-400 hover:bg-white/[0.06] hover:text-slate-100 disabled:text-slate-700',
  danger:
    'bg-rose/15 text-rose border border-rose/30 hover:bg-rose/25 disabled:opacity-40',
  outline:
    'bg-transparent border border-white/15 text-slate-300 hover:border-accent/50 hover:text-white',
};

const SIZES = {
  xs: 'px-2.5 py-1 text-[11px] gap-1 rounded-lg',
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'px-4 py-2.5 text-sm gap-2 rounded-xl',
  lg: 'px-6 py-3.5 text-[15px] gap-2.5 rounded-xl',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  loading = false,
  ...props
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center font-medium',
        'transition-all duration-150 active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="field-label">{label}</span>}
      {children}
      {hint && <span className="mt-1.5 block text-[11px] leading-relaxed text-slate-500">{hint}</span>}
    </label>
  );
}

export function TextInput({ className, ...props }) {
  return <input {...props} className={cx('input-base', className)} />;
}

export function TextArea({ className, ...props }) {
  return <textarea {...props} className={cx('input-base resize-y leading-relaxed', className)} />;
}

export function Select({ className, children, ...props }) {
  return (
    <div className="relative">
      <select
        {...props}
        className={cx(
          'input-base cursor-pointer appearance-none pr-9',
          '[&>option]:bg-ink-850 [&>option]:text-slate-100',
          className,
        )}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M5.2 7.3a1 1 0 0 1 1.4 0L10 10.6l3.4-3.3a1 1 0 1 1 1.4 1.4l-4.1 4a1 1 0 0 1-1.4 0l-4.1-4a1 1 0 0 1 0-1.4Z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}

/** Labelled range slider with a live value read-out. */
export function Slider({ label, value, display, ...props }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="field-label mb-0">{label}</span>
        <span className="font-mono text-xs text-amber-glow">{display ?? value}</span>
      </div>
      <input
        type="range"
        value={value}
        {...props}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-700
                   accent-accent
                   [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-glow
                   [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4
                   [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0
                   [&::-moz-range-thumb]:bg-accent"
      />
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-xl px-1 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
    >
      <span
        className={cx(
          'mt-0.5 flex h-5 w-9 flex-shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-accent' : 'bg-ink-600',
        )}
      >
        <span
          className={cx(
            'h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-slate-200">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{hint}</span>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({ open, onClose, title, subtitle, children, footer, width = 'max-w-2xl' }) {
  const panelRef = useRef(null);

  // Escape to close, and lock background scroll while open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/80 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('panel my-auto w-full animate-fade-up outline-none', width)}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-6 py-5">
          <div>
            <h2 className="font-display text-2xl leading-tight text-white">{title}</h2>
            {subtitle && <p className="mt-1 text-xs leading-relaxed text-slate-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1 rounded-lg p-2 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.3 5a.9.9 0 0 0-1.3 1.3L8.7 10 5 13.7A.9.9 0 1 0 6.3 15L10 11.3l3.7 3.7a.9.9 0 0 0 1.3-1.3L11.3 10 15 6.3A.9.9 0 0 0 13.7 5L10 8.7 6.3 5Z" />
            </svg>
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function Badge({ children, tone = 'neutral', className }) {
  const tones = {
    neutral: 'bg-white/[0.06] text-slate-400 border-white/10',
    accent: 'bg-accent/15 text-accent-soft border-accent/30',
    amber: 'bg-amber-glow/10 text-amber-glow border-amber-glow/25',
    mint: 'bg-mint/10 text-mint border-mint/25',
    rose: 'bg-rose/10 text-rose border-rose/25',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Divider({ className }) {
  return <div className={cx('h-px w-full bg-white/[0.07]', className)} />;
}
