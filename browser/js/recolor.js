/** Recolor Artwork, matching `recolor.colors`, `recolor.reduce` and `recolor.apply`.

Colours stay in their own model. A row of current colours takes its new colour by Exact,
Preserve Tints, Scale Tints, Tints and Shades or Hue Shift. Similar colours can be reduced
with the same Lab k-means the desktop editor uses. */

import { walk } from "./model.js";

const RGB_Q = 25500;
const INK_Q = 10000;
const LAB_Q = 100;
const NEUTRAL_E = 0.005;

export const METHODS = [
  ["exact", "Exact"],
  ["preserveTints", "Preserve Tints"],
  ["scaleTints", "Scale Tints"],
  ["tintsShades", "Tints and Shades"],
  ["hueShift", "Hue Shift"],
];

const D50 = [0.96422, 1, 0.82521];
const LAB_EPS = 216 / 24389;
const KAPPA = 24389 / 27;
const SRGB_TO_XYZ = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
];
const XYZ_TO_SRGB = [
  [3.1338561, -1.6168667, -0.4906146],
  [-0.9787684, 1.9161415, 0.033454],
  [0.0719453, -0.2289914, 1.4052427],
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function remEuclid(a, m) { return ((a % m) + m) % m; }
function mul3(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}
function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
}
function srgbToLab(rgb) {
  const xyz = mul3(SRGB_TO_XYZ, rgb.map(srgbToLinear));
  const f = (t) => (t > LAB_EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
  const fx = f(xyz[0] / D50[0]);
  const fy = f(xyz[1] / D50[1]);
  const fz = f(xyz[2] / D50[2]);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
function labToSrgb(lab) {
  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const inv = (f) => {
    const f3 = f * f * f;
    return f3 > LAB_EPS ? f3 : (116 * f - 16) / KAPPA;
  };
  const y = lab.l > KAPPA * LAB_EPS ? fy * fy * fy : lab.l / KAPPA;
  const xyz = [inv(fx) * D50[0], y * D50[1], inv(fz) * D50[2]];
  return mul3(XYZ_TO_SRGB, xyz).map((v) => {
    const e = linearToSrgb(clamp(v, 0, 1));
    if (e > 0.99999) return 1;
    if (e < 1e-6) return 0;
    return e;
  });
}

export function displayRgb(c) {
  if (!c) return { r: 0, g: 0, b: 0 };
  if (c.model === "cmyk") {
    const k = c.k ?? 0;
    return { r: (1 - (c.c ?? 0)) * (1 - k), g: (1 - (c.m ?? 0)) * (1 - k), b: (1 - (c.y ?? 0)) * (1 - k) };
  }
  if (c.model === "gray") {
    const v = 1 - (c.k ?? 0);
    return { r: v, g: v, b: v };
  }
  if (c.model === "lab") {
    const [r, g, b] = labToSrgb(c);
    return { r, g, b };
  }
  return { r: c.r ?? 0, g: c.g ?? 0, b: c.b ?? 0 };
}

export function toLab(c) {
  if (!c) return { l: 0, a: 0, b: 0 };
  if (c.model === "lab") return { l: c.l ?? 0, a: c.a ?? 0, b: c.b ?? 0 };
  const { r, g, b } = displayRgb(c);
  return srgbToLab([r, g, b]);
}

function chroma(lab) { return Math.hypot(lab.a, lab.b); }

export function toHsb(c) {
  const { r, g, b } = displayRgb(c);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * remEuclid((g - b) / d, 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [h, max <= 0 ? 0 : d / max, max];
}

export function fromHsb(h, s, v) {
  const hh = remEuclid(h, 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  const sector = Math.floor(hh) % 6;
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
  return { model: "rgb", r: rgb[0] + m, g: rgb[1] + m, b: rgb[2] + m };
}

function toCmyk(c) {
  if (c.model === "cmyk") return [c.c ?? 0, c.m ?? 0, c.y ?? 0, c.k ?? 0];
  const { r, g, b } = displayRgb(c);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

export function inModel(c, model) {
  if (!c || c.model === model) return c;
  if (model === "rgb") return { model: "rgb", ...displayRgb(c) };
  if (model === "cmyk") {
    const [cc, m, y, k] = toCmyk(c);
    return { model: "cmyk", c: cc, m, y, k };
  }
  if (model === "gray") {
    const { r, g, b } = displayRgb(c);
    return { model: "gray", k: clamp(1 - (0.299 * r + 0.587 * g + 0.114 * b), 0, 1) };
  }
  const lab = toLab(c);
  return { model: "lab", ...lab };
}

export function keepModel(orig, next) {
  return inModel(next, orig?.model || "rgb");
}

export function tinted(c, t) {
  const u = clamp(t, 0, 1);
  if (u === 1 || !c) return c;
  if (c.model === "cmyk") return { model: "cmyk", c: (c.c ?? 0) * u, m: (c.m ?? 0) * u, y: (c.y ?? 0) * u, k: (c.k ?? 0) * u };
  if (c.model === "gray") return { model: "gray", k: (c.k ?? 0) * u };
  if (c.model === "lab") return { model: "lab", l: 100 - (100 - (c.l ?? 0)) * u, a: (c.a ?? 0) * u, b: (c.b ?? 0) * u };
  const w = (v) => v + (1 - v) * (1 - u);
  return { model: "rgb", r: w(c.r ?? 0), g: w(c.g ?? 0), b: w(c.b ?? 0) };
}

export function shaded(c, f) {
  const u = clamp(f, 0, 1);
  if (!c) return c;
  if (c.model === "cmyk") return { model: "cmyk", c: c.c ?? 0, m: c.m ?? 0, y: c.y ?? 0, k: (c.k ?? 0) + (1 - (c.k ?? 0)) * u };
  if (c.model === "gray") return { model: "gray", k: (c.k ?? 0) + (1 - (c.k ?? 0)) * u };
  if (c.model === "lab") return { model: "lab", l: (c.l ?? 0) * (1 - u), a: (c.a ?? 0) * (1 - u), b: (c.b ?? 0) * (1 - u) };
  return { model: "rgb", r: (c.r ?? 0) * (1 - u), g: (c.g ?? 0) * (1 - u), b: (c.b ?? 0) * (1 - u) };
}

function fmtKey(q) {
  const sign = q < 0 ? "-" : "";
  const a = Math.abs(q);
  return `${sign}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, "0")}`.replace(/0+$/, "").replace(/\.$/, "");
}

function keyParts(c) {
  if (!c) return { model: 0, v: [0, 0, 0, 0] };
  if (c.model === "cmyk") {
    const ink = (x) => Math.round(clamp(x ?? 0, 0, 1) * INK_Q);
    return { model: 1, v: [ink(c.c), ink(c.m), ink(c.y), ink(c.k)] };
  }
  if (c.model === "gray") return { model: 2, v: [Math.round(clamp(c.k ?? 0, 0, 1) * INK_Q), 0, 0, 0] };
  if (c.model === "lab") {
    const lab = (x) => Math.round((x ?? 0) * LAB_Q);
    return { model: 3, v: [Math.round(clamp(c.l ?? 0, 0, 100) * LAB_Q), lab(c.a), lab(c.b), 0] };
  }
  const rgb = (x) => Math.round(clamp(x ?? 0, 0, 1) * RGB_Q);
  return { model: 0, v: [rgb(c.r), rgb(c.g), rgb(c.b), 0] };
}

export function colorKey(c) {
  const { model, v } = keyParts(c);
  const [a, b, d, k] = v.map(fmtKey);
  if (model === 1) return `cmyk ${a} ${b} ${d} ${k}`;
  if (model === 2) return `gray ${a}`;
  if (model === 3) return `lab ${a} ${b} ${d}`;
  return `rgb ${a} ${b} ${d}`;
}

export function cmpColorKey(a, b) {
  const ka = keyParts(a);
  const kb = keyParts(b);
  if (ka.model !== kb.model) return ka.model - kb.model;
  for (let i = 0; i < 4; i++) if (ka.v[i] !== kb.v[i]) return ka.v[i] - kb.v[i];
  return 0;
}

function colorFromParts(s) {
  if (typeof s !== "string") return null;
  const parts = s.trim().split(/\s+/);
  const model = parts[0]?.toLowerCase();
  const nums = parts.slice(1).map(Number);
  if (!model || nums.some((n) => !Number.isFinite(n))) return null;
  if (model === "rgb" && nums.length === 3) return { model: "rgb", r: nums[0] / 255, g: nums[1] / 255, b: nums[2] / 255 };
  if (model === "cmyk" && nums.length === 4) return { model: "cmyk", c: nums[0] / 100, m: nums[1] / 100, y: nums[2] / 100, k: nums[3] / 100 };
  if (model === "gray" && nums.length === 1) return { model: "gray", k: nums[0] / 100 };
  if (model === "lab" && nums.length === 3) return { model: "lab", l: nums[0], a: nums[1], b: nums[2] };
  return null;
}

export function colorFromKey(s) {
  const c = colorFromParts(s);
  return c ? quantize(c) : null;
}

export function quantize(c) {
  const { model, v } = keyParts(c);
  if (model === 1) return { model: "cmyk", c: v[0] / INK_Q, m: v[1] / INK_Q, y: v[2] / INK_Q, k: v[3] / INK_Q };
  if (model === 2) return { model: "gray", k: v[0] / INK_Q };
  if (model === 3) return { model: "lab", l: v[0] / LAB_Q, a: v[1] / LAB_Q, b: v[2] / LAB_Q };
  return { model: "rgb", r: v[0] / RGB_Q, g: v[1] / RGB_Q, b: v[2] / RGB_Q };
}

export function colorHex(c) {
  const { r, g, b } = displayRgb(c);
  const q = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");
  return `#${q(r)}${q(g)}${q(b)}`;
}

export function hexToColor(hex) {
  const h = String(hex || "").replace("#", "").trim();
  const n = h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h;
  const v = parseInt(n, 16);
  if (!Number.isFinite(v) || n.length < 6) return { model: "rgb", r: 0, g: 0, b: 0 };
  return { model: "rgb", r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

export function neutralOf(c) {
  if (!c) return null;
  if (c.model === "gray") {
    if ((c.k ?? 0) <= NEUTRAL_E) return "white";
    if ((c.k ?? 0) >= 1 - NEUTRAL_E) return "black";
    return "gray";
  }
  if (c.model === "cmyk") {
    const mx = Math.max(c.c ?? 0, c.m ?? 0, c.y ?? 0, c.k ?? 0);
    if (mx <= NEUTRAL_E) return "white";
    if ((c.k ?? 0) >= 1 - NEUTRAL_E) return "black";
    if (Math.max(c.c ?? 0, c.m ?? 0, c.y ?? 0) <= NEUTRAL_E) return "gray";
    return null;
  }
  if (c.model === "lab") {
    if ((c.l ?? 0) >= 99.5 && Math.max(Math.abs(c.a ?? 0), Math.abs(c.b ?? 0)) <= 0.5) return "white";
    if ((c.l ?? 0) <= 0.5) return "black";
    if (Math.max(Math.abs(c.a ?? 0), Math.abs(c.b ?? 0)) <= 0.5) return "gray";
    return null;
  }
  const lo = Math.min(c.r ?? 0, c.g ?? 0, c.b ?? 0);
  const hi = Math.max(c.r ?? 0, c.g ?? 0, c.b ?? 0);
  if (lo >= 1 - NEUTRAL_E) return "white";
  if (hi <= NEUTRAL_E) return "black";
  if (hi - lo <= NEUTRAL_E) return "gray";
  return null;
}

export function keepsNeutral(c, preserve = { white: true, black: true, grays: false }) {
  const n = neutralOf(c);
  if (n === "white") return !!preserve.white;
  if (n === "black") return !!preserve.black;
  if (n === "gray") return !!preserve.grays;
  return false;
}

function inkOf(c) {
  if (c.model === "cmyk") return [c.c ?? 0, c.m ?? 0, c.y ?? 0, c.k ?? 0];
  if (c.model === "gray") return [c.k ?? 0, 0, 0, 0];
  if (c.model === "lab") return [(100 - (c.l ?? 0)) / 100, (c.a ?? 0) / 100, (c.b ?? 0) / 100, 0];
  return [1 - (c.r ?? 0), 1 - (c.g ?? 0), 1 - (c.b ?? 0), 0];
}
function dot4(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; }

export function tintOf(c, base) {
  const a = inkOf(c);
  const b = inkOf(base);
  const bb = dot4(b, b);
  if (bb <= 1e-9) return 1;
  return clamp(dot4(a, b) / bb, 0, 1);
}

export function isTint(c, base) {
  const t = tintOf(c, base);
  const a = inkOf(c);
  const b = inkOf(base);
  return a.every((x, i) => Math.abs(x - b[i] * t) <= 0.01);
}

export function keyColor(method, row) {
  if (!row?.length) return null;
  const scored = row.map((c) => ({ c, lab: toLab(c) }));
  const pick = (score) => {
    let best = scored[0];
    let bestS = score(best.lab);
    for (let i = 1; i < scored.length; i++) {
      const s = score(scored[i].lab);
      if (s < bestS) { best = scored[i]; bestS = s; }
    }
    return best.c;
  };
  if (method === "hueShift") return pick((l) => -chroma(l) * 1000 + l.l);
  if (method === "tintsShades") {
    const mean = scored.reduce((s, x) => s + x.lab.l, 0) / scored.length;
    return pick((l) => Math.abs(l.l - mean));
  }
  return pick((l) => l.l * 1000 - chroma(l));
}

function sameExact(a, b) {
  if (!a || !b || a.model !== b.model) return false;
  const keys = a.model === "cmyk" ? ["c", "m", "y", "k"] : a.model === "gray" ? ["k"] : a.model === "lab" ? ["l", "a", "b"] : ["r", "g", "b"];
  return keys.every((k) => a[k] === b[k]);
}

function rowMapper(method, row, to) {
  const key = keyColor(method, row) || to;
  const mean = method === "tintsShades"
    ? row.reduce((s, c) => s + toLab(c).l, 0) / Math.max(1, row.length)
    : 0;
  const turn = toHsb(to)[0] - toHsb(key)[0];
  return (c) => {
    const dest = keepModel(c, to);
    if (method === "preserveTints") return isTint(c, key) ? tinted(dest, tintOf(c, key)) : dest;
    if (method === "scaleTints") return tinted(dest, tintOf(c, key));
    if (method === "tintsShades") {
      const d = toLab(c).l - mean;
      if (d >= 0) return tinted(dest, 1 - d / Math.max(1e-3, 100 - mean));
      return shaded(dest, -d / Math.max(1e-3, mean));
    }
    if (method === "hueShift") {
      if (sameExact(c, key)) return dest;
      const [h, s, v] = toHsb(c);
      if (s <= 0) return c;
      return keepModel(c, fromHsb(h + turn, s, v));
    }
    return dest;
  };
}

/** Map one current colour through a row, as `RowMap::map`. */
export function mapColor(method, row, to, c) {
  return rowMapper(method || "exact", row, to)(c);
}

function asColor(v) {
  if (!v) return null;
  if (typeof v === "string") return colorFromKey(v) || (v.startsWith("#") ? hexToColor(v) : null);
  if (v.model) return v;
  if (v.r != null || v.g != null || v.b != null) return { model: "rgb", r: v.r ?? 0, g: v.g ?? 0, b: v.b ?? 0 };
  return null;
}

function buildMap(rows, method) {
  const byKey = new Map();
  for (const row of rows || []) {
    if (!row || row.exclude || row.to == null) continue;
    const from = (Array.isArray(row.from) ? row.from : [row.from]).map(asColor).filter(Boolean);
    if (!from.length) continue;
    const to = asColor(row.to);
    if (!to) continue;
    const map = rowMapper(method || "exact", from.map(quantize), to);
    for (const c of from) if (!byKey.has(colorKey(c))) byKey.set(colorKey(c), map);
  }
  return (c) => {
    const map = byKey.get(colorKey(c));
    return map ? map(c) : c;
  };
}

function noteColor(used, index, color, swatch) {
  const c = asColor(color);
  if (!c || c.type === "none") return;
  const key = colorKey(c);
  let i = index.get(key);
  if (i == null) {
    i = used.length;
    index.set(key, i);
    used.push({ color: c, count: 0, swatch: null, key });
  }
  const u = used[i];
  u.count += 1;
  if (!u.swatch && swatch) u.swatch = swatch;
}

function notePaint(used, index, paint) {
  if (!paint || paint.type === "none") return;
  if (paint.type === "solid") noteColor(used, index, paint.color, paint.swatch);
  else if (paint.type === "gradient") {
    for (const s of paint.gradient?.stops || paint.stops || []) noteColor(used, index, s.color, s.swatch);
  }
}

/** Unique colours of the selection, most used first. Fills, strokes, gradient stops, text and mesh points. */
export function artworkColors(nodes) {
  const used = [];
  const index = new Map();
  const seen = new Set();
  for (const root of nodes || []) {
    for (const { node } of walk(root)) {
      if (node.id != null && seen.has(node.id)) continue;
      if (node.id != null) seen.add(node.id);
      for (const it of node.appearance?.items || []) {
        if (it.kind === "fill" || it.kind === "stroke") notePaint(used, index, it.paint);
      }
      for (const run of node.kind?.runs || []) {
        notePaint(used, index, run.style?.fill);
        notePaint(used, index, run.style?.stroke);
      }
      if (node.kind?.type === "mesh") {
        for (const p of node.kind.points || []) noteColor(used, index, p.color, null);
      }
    }
  }
  used.sort((a, b) => b.count - a.count || cmpColorKey(a.color, b.color));
  return used;
}

function d2(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** K-means in Lab (lightness weighted by half), seeded heaviest then farthest-first. */
export function cluster(colors, weights, n) {
  const pts = colors.map((c) => {
    const l = toLab(c);
    return [l.l * 0.5, l.a, l.b];
  });
  const w = (i) => Math.max(1e-6, weights?.[i] ?? 1);
  const count = Math.max(1, n | 0);
  if (!pts.length) return [];
  let first = 0;
  for (let i = 1; i < pts.length; i++) if (w(i) > w(first)) first = i;
  const centres = [pts[first]];
  const near = pts.map((p) => d2(p, pts[first]));
  while (centres.length < count) {
    let i = 0;
    let far = 0;
    for (let j = 0; j < near.length; j++) if (near[j] > far) { i = j; far = near[j]; }
    if (far <= 1e-6) break;
    centres.push(pts[i]);
    for (let j = 0; j < pts.length; j++) near[j] = Math.min(near[j], d2(pts[j], pts[i]));
  }
  const nearest = (p) => {
    let best = 0;
    let bestD = d2(p, centres[0]);
    for (let i = 1; i < centres.length; i++) {
      const d = d2(p, centres[i]);
      if (d < bestD) { best = i; bestD = d; }
    }
    return best;
  };
  let of = pts.map((p) => nearest(p));
  for (let iter = 0; iter < 50; iter++) {
    const sum = centres.map(() => ({ s: [0, 0, 0], w: 0 }));
    pts.forEach((p, i) => {
      const s = sum[of[i]];
      const wt = w(i);
      s.s[0] += p[0] * wt; s.s[1] += p[1] * wt; s.s[2] += p[2] * wt;
      s.w += wt;
    });
    sum.forEach((s, i) => {
      if (s.w > 0) centres[i] = s.s.map((v) => v / s.w);
    });
    const next = pts.map((p) => nearest(p));
    if (next.every((v, i) => v === of[i])) break;
    of = next;
  }
  const rows = centres.map(() => []);
  of.forEach((c, i) => rows[c].push(i));
  return rows.filter((r) => r.length).sort((a, b) => a[0] - b[0]);
}

/** Group the selection's colours into rows. `count` null keeps one row per colour. */
export function reduceColors(used, opts = {}) {
  const method = opts.method || "scaleTints";
  const preserve = { white: opts.preserve?.white !== false, black: opts.preserve?.black !== false, grays: !!opts.preserve?.grays };
  const kept = [];
  const rest = [];
  for (const u of used || []) (keepsNeutral(u.color, preserve) ? kept : rest).push(u);
  const units = [];
  for (const u of rest) {
    const g = u.swatch ? units.find((row) => row[0].swatch === u.swatch) : null;
    if (g) g.push(u);
    else units.push([u]);
  }
  let grouped = units;
  const n = opts.count;
  if (n != null && n < units.length) {
    const keys = units.map((g) => keyColor(method, g.map((u) => u.color)) || g[0].color);
    const weights = units.map((g) => g.reduce((s, u) => s + u.count, 0));
    grouped = cluster(keys, weights, n).map((ix) => ix.flatMap((i) => units[i]));
  }
  const map = grouped.map((row) => {
    const from = row.map((u) => u.color);
    const key = keyColor(method, from) || from[0];
    const i = from.findIndex((c) => colorKey(c) === colorKey(key));
    if (i > 0) from.unshift(from.splice(i, 1)[0]);
    return { from, to: { ...key }, exclude: false };
  });
  return { map, preserved: kept.map((u) => u.color), method };
}

function mapPaint(paint, map) {
  if (!paint || paint.type === "none") return false;
  let changed = false;
  if (paint.type === "solid" && paint.color) {
    const next = map(paint.color);
    if (colorKey(next) !== colorKey(paint.color) || next.model !== paint.color.model) {
      paint.color = next;
      delete paint.swatch;
      changed = true;
    }
  } else if (paint.type === "gradient") {
    for (const s of paint.gradient?.stops || paint.stops || []) {
      if (!s.color) continue;
      const next = map(s.color);
      if (colorKey(next) !== colorKey(s.color) || next.model !== s.color.model) {
        s.color = next;
        delete s.swatch;
        changed = true;
      }
    }
    if (changed) {
      delete paint.swatch;
      if (paint.gradient) delete paint.gradient.swatch;
    }
  }
  return changed;
}

function recolorOne(node, map) {
  let changed = 0;
  for (const it of node.appearance?.items || []) {
    if ((it.kind === "fill" || it.kind === "stroke") && mapPaint(it.paint, map)) changed += 1;
  }
  for (const run of node.kind?.runs || []) {
    if (mapPaint(run.style?.fill, map)) changed += 1;
    if (mapPaint(run.style?.stroke, map)) changed += 1;
  }
  if (node.kind?.type === "mesh") {
    let meshChanged = false;
    for (const p of node.kind.points || []) {
      if (!p.color) continue;
      const next = map(p.color);
      if (colorKey(next) !== colorKey(p.color) || next.model !== p.color.model) {
        p.color = next;
        meshChanged = true;
      }
    }
    if (meshChanged) changed += 1;
  }
  return changed;
}

/** Recolour `nodes` and everything inside them. Returns how many paints and meshes changed. */
export function applyRecolor(nodes, rows, method = "exact") {
  const map = buildMap(rows, method);
  let changed = 0;
  const seen = new Set();
  for (const root of nodes || []) {
    for (const { node } of walk(root)) {
      if (node.id != null && seen.has(node.id)) continue;
      if (node.id != null) seen.add(node.id);
      changed += recolorOne(node, map);
    }
  }
  return changed;
}
