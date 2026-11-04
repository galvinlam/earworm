/**
 * migrate.js
 * ---------------------------------------------------------------------------
 * One-time rescue of drafts saved under the old name.
 *
 * The app was called LyricForge before it was called Earworm, and the
 * persisted stores are keyed by name. Without this, anyone who had written a
 * song would open the new build to an empty page — which is a rotten way to
 * find out a project got renamed.
 *
 * Imported for its side effect in main.jsx, before any store is created.
 */

const MIGRATIONS = [
  ['lyricforge-song-v1', 'earworm-song-v1'],
  ['lyricforge-settings-v1', 'earworm-settings-v1'],
];

export function migrateLegacyStorage() {
  // Private mode and blocked site data both make localStorage throw on access,
  // so nothing here is allowed to be load-bearing.
  try {
    if (typeof localStorage === 'undefined') return;
  } catch {
    return;
  }

  for (const [from, to] of MIGRATIONS) {
    try {
      // Never overwrite work done under the new name.
      if (localStorage.getItem(to) !== null) continue;
      const legacy = localStorage.getItem(from);
      if (legacy === null) continue;
      localStorage.setItem(to, legacy);
      localStorage.removeItem(from);
    } catch {
      // A single failed key should not stop the others, or the app.
    }
  }
}

migrateLegacyStorage();
