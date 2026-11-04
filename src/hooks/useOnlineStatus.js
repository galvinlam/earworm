/**
 * useOnlineStatus.js
 * ---------------------------------------------------------------------------
 * Tracks whether the browser thinks it has a connection.
 *
 * Matters once the app is installed on a phone: drafts, playback, editing and
 * export all work offline, but generating needs the model API. Saying so up
 * front is better than letting someone tap Generate on a train and get a
 * network error.
 *
 * navigator.onLine only reports whether there is *a* network, not whether it
 * reaches anything — false is reliable, true is optimistic. That is fine here,
 * because it is used to warn rather than to block.
 */

import { useEffect, useState } from 'react';

export function useOnlineStatus() {
  const [online, setOnline] = useState(() => {
    try {
      return navigator.onLine !== false;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
