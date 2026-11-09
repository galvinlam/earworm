/**
 * App.jsx — layout, routing of panels, and the share-link entry path.
 *
 * Two columns on desktop: the brief on the left, the song on the right.
 * One column on mobile, with the brief collapsing once a song exists so the
 * song is what you see.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useSongStore } from './store/useSongStore.js';
import { useSettingsStore } from './store/useSettingsStore.js';
import { useSongGeneration } from './hooks/useSongGeneration.js';
import { useOnlineStatus } from './hooks/useOnlineStatus.js';
import { readShareFromUrl, clearShareFromUrl } from './lib/share.js';
import { validSharedSound } from './lib/sharedSound.js';
import { setVolume, setDrumLevel, stopPlayback } from './lib/audioEngine.js';
import { toast } from './store/useToastStore.js';

import SongForm from './components/SongForm.jsx';
import SongView from './components/SongView.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import Toasts from './components/Toasts.jsx';
import { GenerationOverlay, ErrorPanel, EmptyState } from './components/GenerationStatus.jsx';
import { Button, Badge, cx } from './components/ui.jsx';
import * as Icon from './components/icons.jsx';
import Logo from './components/Logo.jsx';

export default function App() {
  const { song, status, clearStatus, history, loadSong, readOnly, clearSong } = useSongStore();
  const settings = useSettingsStore();
  const { generateSong, regenerateAll, regenerateSection, cancel } = useSongGeneration();

  const online = useOnlineStatus();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(true);

  const generating = status.state === 'generating';
  const configured = settings.isConfigured();

  // --- share links ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    readShareFromUrl()
      .then((shared) => {
        if (cancelled || !shared) return;
        loadSong(shared.song, { readOnly: true });
        // Play it the way it was made. Unknown names (an older or newer
        // version of the app) are dropped rather than trusted.
        const sound = validSharedSound(shared.sound);
        if (sound) useSettingsStore.getState().set(sound);
        clearShareFromUrl();
        toast.info(
          `Opened a shared draft: "${shared.song.title}". It is read-only until you make it yours`
          + (sound ? ', and it plays with the sound it was shared with.' : '.'),
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [loadSong]);

  // Apply stored levels on mount (and whenever they change elsewhere).
  useEffect(() => { setVolume(settings.volumeDb); }, [settings.volumeDb]);
  useEffect(() => { setDrumLevel(settings.drumLevelDb); }, [settings.drumLevelDb]);

  // Stop any audio on unload so a closed tab doesn't leave a note ringing.
  useEffect(() => () => stopPlayback(), []);

  // Collapse the brief on small screens once there is a song to look at.
  useEffect(() => {
    if (song && window.innerWidth < 1024) setBriefOpen(false);
  }, [song?.id]);

  const handleGenerate = useCallback(async () => {
    stopPlayback();
    const result = await generateSong();
    if (result && window.innerWidth < 1024) setBriefOpen(false);
  }, [generateSong]);

  const handleRegenerateAll = useCallback(async () => {
    stopPlayback();
    await regenerateAll();
  }, [regenerateAll]);

  const handleRegenerateSection = useCallback(
    async (sectionId, instruction) => {
      stopPlayback();
      await regenerateSection(sectionId, instruction);
    },
    [regenerateSection],
  );

  return (
    <div className="min-h-full">
      {/* ------------------------- top bar ------------------------- */}
      <header className="safe-top safe-x sticky top-0 z-30 border-b border-white/[0.07] bg-ink-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-ink-850">
              <Logo size={24} />
            </span>
            <div className="leading-none">
              <h1 className="text-[17px] font-semibold tracking-[0.16em] text-white">EARWORM</h1>
              <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-600">
                Song drafts, fast
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {!online ? (
              <Badge tone="amber" title="Drafts, playback and export still work">
                Offline
              </Badge>
            ) : configured ? (
              <span className="hidden items-center gap-1.5 font-mono text-[11px] text-slate-600 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                {settings.model}
              </span>
            ) : (
              <Badge tone="amber" className="hidden sm:inline-flex">No API key</Badge>
            )}

            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="relative rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
              title="Version history"
            >
              <Icon.History className="h-4 w-4" />
              {history.length > 0 && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
              title="Settings"
            >
              <Icon.Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ------------------------- body ------------------------- */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
        <div className="safe-x grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)]">
          {/* ---- brief ---- */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="panel overflow-hidden">
              <button
                type="button"
                onClick={() => setBriefOpen((v) => !v)}
                className="flex w-full items-center gap-2 border-b border-white/[0.07] px-5 py-3.5 text-left lg:cursor-default"
              >
                <Icon.Sparkles className="h-4 w-4 text-accent-soft" />
                <span className="font-display text-lg text-white">The brief</span>
                <Icon.ChevronDown
                  className={cx(
                    'ml-auto h-4 w-4 text-slate-500 transition-transform lg:hidden',
                    briefOpen && 'rotate-180',
                  )}
                />
              </button>

              <div className={cx('px-5 py-5', !briefOpen && 'hidden lg:block')}>
                <SongForm
                  onGenerate={handleGenerate}
                  onCancel={cancel}
                  generating={generating}
                  configured={configured}
                  online={online}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              </div>
            </div>

            {readOnly && (
              <div className="panel mt-4 border-amber-glow/25 px-5 py-4">
                <p className="text-[12px] leading-relaxed text-slate-400">
                  You are viewing a shared draft. Generate or edit anything and it becomes your own
                  copy in this browser.
                </p>
                <Button size="xs" variant="ghost" className="mt-2" onClick={clearSong}>
                  Close shared draft
                </Button>
              </div>
            )}
          </aside>

          {/* ---- song ---- */}
          <section className="min-w-0 space-y-4">
            {status.state === 'error' && (
              <ErrorPanel
                status={status}
                onDismiss={clearStatus}
                onOpenSettings={() => { clearStatus(); setSettingsOpen(true); }}
                onRetry={song ? handleRegenerateAll : handleGenerate}
              />
            )}

            {generating && <GenerationOverlay status={status} onCancel={cancel} />}

            {song ? (
              <SongView
                onRegenerateSection={handleRegenerateSection}
                onRegenerateAll={handleRegenerateAll}
                generating={generating}
              />
            ) : (
              !generating && (
                <EmptyState configured={configured} onOpenSettings={() => setSettingsOpen(true)} />
              )
            )}
          </section>
        </div>
      </main>

      <footer className="safe-bottom safe-x border-t border-white/[0.07] px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
          <span>Earworm by Galvin Lam — everything runs in your browser.</span>
          <span className="hidden sm:inline">Your API key and drafts never leave this device.</span>
          <span className="ml-auto">Lyrics are drafts, not finished work — edit everything.</span>
        </div>
      </footer>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <Toasts />
    </div>
  );
}
