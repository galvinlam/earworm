import React from 'react';
import { useToastStore } from '../store/useToastStore.js';
import { cx } from './ui.jsx';

const TONES = {
  success: 'border-mint/30 bg-mint/10 text-mint',
  error: 'border-rose/30 bg-rose/10 text-rose',
  info: 'border-accent/30 bg-accent/10 text-accent-soft',
};

export default function Toasts() {
  const { toasts, dismiss } = useToastStore();
  if (!toasts.length) return null;

  return (
    <div
      className="safe-bottom pointer-events-none fixed bottom-5 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={cx(
            'pointer-events-auto animate-fade-up rounded-xl border px-4 py-2.5 text-left text-sm',
            'bg-ink-850/95 shadow-panel backdrop-blur',
            TONES[t.tone] || TONES.info,
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
