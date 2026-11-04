/**
 * icons.jsx — inline SVG icons.
 * Inlined rather than pulled from an icon package: a dozen small paths are not
 * worth a dependency, and these inherit currentColor cleanly.
 */

import React from 'react';

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
};

export const Play = (p) => (
  <svg {...base} {...p}><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" stroke="none" /></svg>
);
export const Stop = (p) => (
  <svg {...base} {...p}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></svg>
);
export const Lock = (p) => (
  <svg {...base} {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 1 1 8 0v4" /></svg>
);
export const Unlock = (p) => (
  <svg {...base} {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></svg>
);
export const Refresh = (p) => (
  <svg {...base} {...p}><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" /><path d="M3 21v-5h5" /></svg>
);
export const Settings = (p) => (
  <svg {...base} {...p}><path d="M5 6h14M5 12h14M5 18h14" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="8" cy="18" r="2" fill="currentColor" stroke="none" /></svg>
);
export const Download = (p) => (
  <svg {...base} {...p}><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></svg>
);
export const History = (p) => (
  <svg {...base} {...p}><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5" /><path d="M12 8v4.5l3 1.8" /></svg>
);
export const Plus = (p) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const Trash = (p) => (
  <svg {...base} {...p}><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></svg>
);
export const ChevronUp = (p) => (
  <svg {...base} {...p}><path d="m6 15 6-6 6 6" /></svg>
);
export const ChevronDown = (p) => (
  <svg {...base} {...p}><path d="m6 9 6 6 6-6" /></svg>
);
export const Sparkles = (p) => (
  <svg {...base} {...p}><path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5Z" /><path d="M19 3.5v3M20.5 5h-3M5.5 17v2.5M6.75 18.25h-2.5" /></svg>
);
export const Warning = (p) => (
  <svg {...base} {...p}><path d="M12 4.5 2.8 20h18.4L12 4.5Z" /><path d="M12 10v4.5" /><path d="M12 17.5h.01" /></svg>
);
export const Check = (p) => (
  <svg {...base} {...p}><path d="m5 12.5 4.5 4.5L19 7" /></svg>
);
export const Pencil = (p) => (
  <svg {...base} {...p}><path d="M4 20h4L19 9a2.1 2.1 0 1 0-3-3L5 17v3Z" /><path d="m14.5 6.5 3 3" /></svg>
);
export const Grid = (p) => (
  <svg {...base} {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" /></svg>
);
export const Metronome = (p) => (
  <svg {...base} {...p}><path d="M9 4h6l3.5 16h-13L9 4Z" /><path d="M6.5 15h11" /><path d="m12 13 6-7" /></svg>
);
