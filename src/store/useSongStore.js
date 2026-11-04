/**
 * useSongStore.js
 * ---------------------------------------------------------------------------
 * The song draft, the input form, generation status and version history.
 *
 * Everything the user would hate to lose is persisted to localStorage, so a
 * refresh or a closed tab never costs a draft.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { makeId, normaliseSection } from '../lib/songSchema.js';
import { parseChord } from '../lib/musicTheory.js';

export const GENRES = [
  'Pop', 'Indie Folk', 'Rock', 'R&B', 'Hip-Hop', 'Country', 'Electronic',
  'Jazz', 'Soul', 'Punk', 'Metal', 'Ambient', 'Musical', 'Reggae', 'Lo-fi',
];

export const MOODS = [
  'Wistful', 'Euphoric', 'Melancholy', 'Defiant', 'Tender', 'Restless',
  'Hopeful', 'Menacing', 'Playful', 'Weary', 'Triumphant', 'Numb',
];

const MAX_HISTORY = 25;

const defaultForm = {
  idea: '',
  genre: 'Indie Folk',
  customGenre: '',
  key: 'G major',
  tempo: 96,
  mood: 'Wistful',
  structure: 'Verse-Chorus',
  notes: '',
};

const idleStatus = { state: 'idle', message: '', stage: '', streamText: '', target: null };

export const useSongStore = create(
  persist(
    (set, get) => ({
      form: { ...defaultForm },
      song: null,
      history: [],
      status: { ...idleStatus },
      /** Section ids currently being regenerated. */
      busySections: [],
      /** Read-only mode, set when the app is opened from a share link. */
      readOnly: false,

      // --- form ------------------------------------------------------------
      setForm: (patch) => set((s) => ({ form: { ...s.form, ...patch } })),
      resetForm: () => set({ form: { ...defaultForm } }),

      /** The genre actually sent to the model (custom overrides the dropdown). */
      effectiveGenre: () => {
        const { genre, customGenre } = get().form;
        return customGenre.trim() || genre;
      },

      // --- status ----------------------------------------------------------
      setStatus: (patch) => set((s) => ({ status: { ...s.status, ...patch } })),
      clearStatus: () => set({ status: { ...idleStatus } }),

      markSectionBusy: (id, busy) =>
        set((s) => ({
          busySections: busy
            ? [...new Set([...s.busySections, id])]
            : s.busySections.filter((x) => x !== id),
        })),

      // --- song ------------------------------------------------------------
      /**
       * Install a new song, pushing the outgoing one into history first.
       * Locked sections from the previous draft are carried over by label so
       * a lock survives a full regenerate.
       */
      setSong: (song, { snapshot = true, label = 'Generated' } = {}) => {
        const previous = get().song;
        if (snapshot && previous) get().pushHistory(previous, 'Previous draft');
        set({ song, readOnly: false });
        if (song) get().pushHistory(song, label);
      },

      /** Load a song without touching history (used by share links). */
      loadSong: (song, { readOnly = false } = {}) => set({ song, readOnly }),

      clearSong: () => set({ song: null, readOnly: false }),

      updateSongMeta: (patch) =>
        set((s) => (s.song ? { song: { ...s.song, ...patch } } : {})),

      /** Patch one section by id. */
      updateSection: (id, patch) =>
        set((s) => {
          if (!s.song) return {};
          return {
            song: {
              ...s.song,
              sections: s.song.sections.map((sec) => {
                if (sec.id !== id) return sec;
                const next = { ...sec, ...patch };
                if (patch.chords) {
                  next.unknownChords = patch.chords.filter((c) => !parseChord(c).valid);
                }
                return next;
              }),
            },
          };
        }),

      /** Replace a section's musical content from a fresh model response. */
      replaceSection: (id, rawSection) =>
        set((s) => {
          if (!s.song) return {};
          const index = s.song.sections.findIndex((sec) => sec.id === id);
          if (index === -1) return {};
          const existing = s.song.sections[index];
          const normalised = normaliseSection(rawSection, index, id);
          const sections = [...s.song.sections];
          sections[index] = { ...normalised, locked: existing.locked };
          return { song: { ...s.song, sections } };
        }),

      toggleLock: (id) =>
        set((s) => {
          if (!s.song) return {};
          return {
            song: {
              ...s.song,
              sections: s.song.sections.map((sec) =>
                sec.id === id ? { ...sec, locked: !sec.locked } : sec,
              ),
            },
          };
        }),

      setAllLocks: (locked) =>
        set((s) =>
          s.song
            ? { song: { ...s.song, sections: s.song.sections.map((sec) => ({ ...sec, locked })) } }
            : {},
        ),

      moveSection: (id, delta) =>
        set((s) => {
          if (!s.song) return {};
          const sections = [...s.song.sections];
          const i = sections.findIndex((sec) => sec.id === id);
          const j = i + delta;
          if (i === -1 || j < 0 || j >= sections.length) return {};
          [sections[i], sections[j]] = [sections[j], sections[i]];
          return { song: { ...s.song, sections } };
        }),

      removeSection: (id) =>
        set((s) =>
          s.song
            ? { song: { ...s.song, sections: s.song.sections.filter((sec) => sec.id !== id) } }
            : {},
        ),

      /** Add an empty section the user can fill in or regenerate. */
      addSection: (type = 'Verse') =>
        set((s) => {
          if (!s.song) return {};
          const count = s.song.sections.filter((x) => x.type === type).length;
          const section = {
            id: makeId(),
            type,
            label: count ? `${type} ${count + 1}` : type,
            lyrics: '',
            chords: [],
            melodyContour: [],
            performanceNote: '',
            locked: false,
            unknownChords: [],
          };
          return { song: { ...s.song, sections: [...s.song.sections, section] } };
        }),

      // --- history ---------------------------------------------------------
      pushHistory: (song, label = 'Draft') =>
        set((s) => {
          const entry = {
            id: makeId('ver'),
            label,
            title: song.title,
            key: song.key,
            tempo: song.tempo,
            sectionCount: song.sections.length,
            createdAt: Date.now(),
            song: JSON.parse(JSON.stringify(song)),
          };
          // Skip a snapshot identical to the newest one.
          const newest = s.history[0];
          if (newest && JSON.stringify(newest.song) === JSON.stringify(entry.song)) return {};
          return { history: [entry, ...s.history].slice(0, MAX_HISTORY) };
        }),

      restoreHistory: (versionId) =>
        set((s) => {
          const entry = s.history.find((h) => h.id === versionId);
          if (!entry) return {};
          return { song: JSON.parse(JSON.stringify(entry.song)), readOnly: false };
        }),

      removeHistory: (versionId) =>
        set((s) => ({ history: s.history.filter((h) => h.id !== versionId) })),

      clearHistory: () => set({ history: [] }),

      /** Wipe the draft, history and form — the "Clear everything" button. */
      clearAll: () =>
        set({ song: null, history: [], form: { ...defaultForm }, status: { ...idleStatus }, readOnly: false }),
    }),
    {
      name: 'earworm-song-v1',
      version: 1,
      // Transient state is not worth persisting.
      partialize: ({ status, busySections, readOnly, ...rest }) => rest,
    },
  ),
);
