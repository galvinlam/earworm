/**
 * useToastStore.js — ephemeral notifications ("Copied", "MIDI downloaded").
 */

import { create } from 'zustand';

let nextId = 0;

export const useToastStore = create((set, get) => ({
  toasts: [],

  /** @param {'success'|'error'|'info'} tone */
  push: (message, tone = 'success', ttl = 2800) => {
    const id = ++nextId;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => get().dismiss(id), ttl);
    return id;
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience helpers so components don't need the hook just to fire one. */
export const toast = {
  success: (m) => useToastStore.getState().push(m, 'success'),
  error: (m) => useToastStore.getState().push(m, 'error', 4500),
  info: (m) => useToastStore.getState().push(m, 'info'),
};
