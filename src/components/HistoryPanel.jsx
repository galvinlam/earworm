/**
 * HistoryPanel.jsx — version history. Every generation and section rewrite
 * leaves a snapshot, so experimenting is never destructive.
 */

import React from 'react';
import { useSongStore } from '../store/useSongStore.js';
import { toast } from '../store/useToastStore.js';
import { Modal, Button, Badge, cx } from './ui.jsx';
import * as Icon from './icons.jsx';

function timeAgo(ts) {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function HistoryPanel({ open, onClose }) {
  const { history, restoreHistory, removeHistory, clearHistory, song } = useSongStore();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Version history"
      subtitle={`${history.length} snapshot${history.length === 1 ? '' : 's'} kept in this browser. Restoring does not delete anything.`}
      width="max-w-xl"
      footer={
        <>
          <Button
            variant="danger"
            size="sm"
            disabled={!history.length}
            onClick={() => {
              clearHistory();
              toast.info('History cleared.');
            }}
          >
            Clear all
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        </>
      }
    >
      {history.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No snapshots yet. Generating a song or rewriting a section saves one automatically.
        </p>
      ) : (
        <ul className="space-y-2">
          {history.map((entry) => {
            const isCurrent = song && JSON.stringify(song) === JSON.stringify(entry.song);
            return (
              <li
                key={entry.id}
                className={cx(
                  'flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors',
                  isCurrent
                    ? 'border-accent/35 bg-accent/[0.07]'
                    : 'border-white/[0.07] bg-ink-850/50 hover:border-white/15',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-display text-base text-white">{entry.title}</p>
                    {isCurrent && <Badge tone="accent">Current</Badge>}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                    {entry.label} · {entry.key} · {entry.tempo} BPM · {entry.sectionCount} sections · {timeAgo(entry.createdAt)}
                  </p>
                </div>

                <Button
                  size="xs"
                  variant={isCurrent ? 'ghost' : 'secondary'}
                  disabled={isCurrent}
                  onClick={() => {
                    restoreHistory(entry.id);
                    toast.success(`Restored "${entry.title}".`);
                    onClose?.();
                  }}
                >
                  Restore
                </Button>
                <button
                  type="button"
                  onClick={() => removeHistory(entry.id)}
                  title="Delete this snapshot"
                  className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-white/[0.06] hover:text-rose"
                >
                  <Icon.Trash className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
