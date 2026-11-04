/**
 * marks.mjs
 * ---------------------------------------------------------------------------
 * The Earworm mark and palette, as the single source for every brand asset.
 *
 * brand/build.mjs turns this into the favicon, the logo files, the social
 * card and src/components/Logo.jsx — so the mark in the app header can never
 * drift from the one in the README.
 *
 * The mark is a spiral: the hook coming round again, which is what an earworm
 * is. It is computed rather than hand-drawn, because hand-drawn arcs read as a
 * letter C, and it is held to two turns because that is the most it can carry
 * and still hold its shape at 16px — a favicon is what decides a mark.
 */

export const PALETTE = {
  ink: '#0b0d14',
  inkSoft: '#151824',
  violet: '#7c6cff',
  violetSoft: '#9b8fff',
  amber: '#f4b860',
  mint: '#4ad6a8',
  text: '#f4f4f7',
  muted: '#8b90a5',
};

/**
 * The spiral path, on a 64x64 grid.
 * Shared so the SVG assets and the React component draw the same curve.
 */
export function spiralPath({
  cx = 32, cy = 32, turns = 2.0, rMin = 3.5, rMax = 23, steps = 180,
} = {}) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const theta = t * turns * Math.PI * 2 - Math.PI / 2;
    const r = rMin + (rMax - rMin) * t;
    pts.push(`${(cx + r * Math.cos(theta)).toFixed(2)} ${(cy + r * Math.sin(theta)).toFixed(2)}`);
  }
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p}`).join(' ');
}

/**
 * The mark as SVG innards (no <svg> wrapper).
 *
 * `id` must be unique per instance: several marks on one page would otherwise
 * all inherit the first one's gradient.
 */
export function earwormMark({ a = PALETTE.amber, b = PALETTE.violet, id = 'ew' } = {}) {
  return `<defs>
      <linearGradient id="${id}" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stop-color="${a}"/>
        <stop offset="1" stop-color="${b}"/>
      </linearGradient>
    </defs>
    <path d="${spiralPath()}" fill="none" stroke="url(#${id})" stroke-width="5.5" stroke-linecap="round"/>`;
}
