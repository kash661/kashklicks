/**
 * marquee-bulbs.mjs
 * -----------------
 * Draws a word the way a marquee letter is built: a thick letter body with
 * bulbs set along the centre line of every stroke. Pure geometry, no fonts,
 * so the same drawing renders inline on the page (MarqueePlate.astro) and in
 * Node for the social preview (scripts/generate-og-marquee.mjs).
 *
 * It stands in for the photographs of our letters until they arrive. It is an
 * illustration of the idea of a marquee letter, not a drawing of our letters,
 * so it makes no claim about bulb count, spacing or build.
 *
 * Coordinates: cap height is 100 units, y runs down, every glyph starts at
 * x = 0. A glyph is a list of strokes, and a stroke is a dense polyline along
 * its centre line, open or closed. Bulbs are spaced evenly along each stroke
 * and de-duplicated where two strokes meet.
 *
 * Plain ES module with JSDoc rather than TypeScript, so the Node script can
 * import it without a build step.
 */

const DEG = Math.PI / 180;

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ pts: Point[], closed: boolean }} Stroke */

/** Points on an elliptical arc from a0 to a1 degrees (y down, so clockwise). */
function arcPts(cx, cy, rx, ry, a0, a1, step = 6) {
  const out = [];
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step));
  for (let i = 0; i <= n; i++) {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

/** Open straight polyline. */
const poly = (...pts) => ({ pts: pts.map(([x, y]) => ({ x, y })), closed: false });

/** Closed ellipse. */
const ring = (cx, cy, rx, ry) => {
  const pts = arcPts(cx, cy, rx, ry, -90, 270);
  pts.pop(); // the last point repeats the first
  return { pts, closed: true };
};

/** Open stroke joined from straight runs ([[x, y], ...]) and arcs (arcPts output). */
const path = (...parts) => {
  const pts = [];
  for (const part of parts) {
    const run = Array.isArray(part[0]) ? part.map(([x, y]) => ({ x, y })) : part;
    for (const p of run) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.01) pts.push(p);
    }
  }
  return { pts, closed: false };
};

/**
 * The glyphs the inventory needs: LOVE, OH BABY and the numbers 0 to 9.
 * @type {Record<string, { w: number, s: Stroke[] }>}
 */
export const GLYPHS = {
  L: { w: 54, s: [poly([0, 0], [0, 100], [54, 100])] },
  O: { w: 72, s: [ring(36, 50, 36, 50)] },
  V: { w: 64, s: [poly([0, 0], [32, 100], [64, 0])] },
  E: { w: 54, s: [poly([54, 0], [0, 0], [0, 100], [54, 100]), poly([0, 50], [44, 50])] },
  H: { w: 60, s: [poly([0, 0], [0, 100]), poly([60, 0], [60, 100]), poly([0, 50], [60, 50])] },
  B: {
    w: 58,
    s: [
      poly([0, 0], [0, 100]),
      path([[0, 0], [30, 0]], arcPts(30, 25, 25, 25, -90, 90), [[30, 50], [0, 50]]),
      path([[0, 50], [33, 50]], arcPts(33, 75, 25, 25, -90, 90), [[33, 100], [0, 100]]),
    ],
  },
  A: { w: 64, s: [poly([0, 100], [32, 0], [64, 100]), poly([12.5, 61], [51.5, 61])] },
  Y: { w: 64, s: [poly([0, 0], [32, 48], [32, 100]), poly([64, 0], [32, 48])] },

  0: { w: 56, s: [ring(28, 50, 28, 50)] },
  1: { w: 20, s: [poly([0, 18], [20, 0], [20, 100])] },
  2: { w: 56, s: [path(arcPts(27, 26, 26, 26, 200, 380), [[0, 100], [56, 100]])] },
  3: {
    w: 53,
    s: [
      path(arcPts(26, 25, 25, 25, 215, 450)),
      path(arcPts(28, 75, 25, 25, 270, 505)),
      poly([12, 50], [27, 50]),
    ],
  },
  4: { w: 56, s: [poly([40, 100], [40, 0], [0, 68], [56, 68])] },
  5: { w: 56, s: [path([[52, 0], [10, 0], [12.75, 46.5]], arcPts(28, 70, 28, 28, 237, 505))] },
  6: { w: 56, s: [path(arcPts(56, 72, 56, 72, 255, 180)), ring(28, 72, 28, 28)] },
  7: { w: 56, s: [poly([0, 0], [56, 0], [18, 100])] },
  8: { w: 52, s: [ring(26, 24, 24, 24), ring(26, 74, 26, 26)] },
  9: { w: 56, s: [ring(28, 28, 28, 28), path(arcPts(0, 28, 56, 72, 0, 75))] },
};

/** @param {Stroke} stroke */
function strokeLength({ pts, closed }) {
  let len = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/**
 * Evenly spaced points along a stroke. Open strokes include both ends.
 * @param {Stroke} stroke
 * @param {number} spacing
 */
function sample(stroke, spacing) {
  const { pts, closed } = stroke;
  const total = strokeLength(stroke);
  const segments = Math.max(1, Math.round(total / spacing));
  const count = closed ? segments : segments + 1;
  const step = total / segments;
  const out = [];
  let target = 0;
  let walked = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n && out.length < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (out.length < count && target <= walked + seg + 1e-6) {
      const t = seg === 0 ? 0 : (target - walked) / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      target += step;
    }
    walked += seg;
  }
  if (!closed && out.length < count) out.push({ ...pts[pts.length - 1] });
  return out;
}

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Lay out a word. Characters without a glyph are skipped; a space opens a gap.
 *
 * @param {string} word
 * @param {{ spacing?: number, gap?: number, space?: number, body?: number }} [opts]
 *   spacing: bulb centre to centre, in cap height units
 *   gap:     space between glyphs
 *   space:   extra room for a word break
 *   body:    letter body (stroke) width, used for the padding
 * @returns {{ viewBox: string, width: number, height: number, bodyPath: string, bulbPath: string, bulbCount: number }}
 */
export function bulbLayout(word, opts = {}) {
  const spacing = opts.spacing ?? 14;
  const gap = opts.gap ?? 34;
  const space = opts.space ?? 44;
  const body = opts.body ?? 22;

  const bodyParts = [];
  const bulbs = [];
  let x = 0;
  let first = true;

  for (const ch of String(word).toUpperCase()) {
    if (ch === ' ') {
      x += space;
      continue;
    }
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    if (!first) x += gap;
    first = false;

    const mine = [];
    for (const stroke of glyph.s) {
      bodyParts.push(
        stroke.pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p.x + x)} ${r1(p.y)}`).join('') +
          (stroke.closed ? 'Z' : '')
      );
      for (const p of sample(stroke, spacing)) {
        const q = { x: p.x + x, y: p.y };
        if (mine.some((m) => Math.hypot(m.x - q.x, m.y - q.y) < spacing * 0.7)) continue;
        mine.push(q);
      }
    }
    bulbs.push(...mine);
    x += glyph.w;
  }

  const pad = body / 2 + 4;
  const width = r1(x + pad * 2);
  const height = r1(100 + pad * 2);
  return {
    viewBox: `${r1(-pad)} ${r1(-pad)} ${width} ${height}`,
    width,
    height,
    bodyPath: bodyParts.join(''),
    // Every bulb is a zero length subpath. With a round line cap each one
    // renders as a dot the size of the stroke width, so a whole word of bulbs
    // is a single <path> instead of a hundred <circle> elements.
    bulbPath: bulbs.map((b) => `M${r1(b.x)} ${r1(b.y)}h0`).join(''),
    bulbCount: bulbs.length,
  };
}
