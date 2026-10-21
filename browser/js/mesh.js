/** Gradient meshes from a path outline, matching `GradientMesh::for_path`.

The outline is split at the points nearest its bounding-box corners and turned into a Coons
patch. Mesh points sit on that surface; handles come from its partial derivatives. */

import { flattenPath, lerp, lerpColor, pathBounds } from "./geom.js";

const SIDE = 65;

export function meshFromPath(path, opts = {}) {
  const coons = coonsFromPath(path);
  if (!coons) return null;
  const rows = Math.max(1, Math.min(200, opts.rows ?? 4));
  const cols = Math.max(1, Math.min(200, opts.cols ?? 4));
  const at = opts.at || null;
  const us = axisSteps(at ? 1 : cols, at?.u);
  const vs = axisSteps(at ? 1 : rows, at?.v);
  const sample = opts.sample || (() => ({ color: opts.color || { model: "rgb", r: 1, g: 1, b: 1 }, opacity: 1 }));
  const mesh = meshFromSurface(us, vs, (u, v) => coons.eval(u, v), (_r, _c, p) => sample(p));
  highlightMesh(mesh, opts.appearance || "flat", opts.highlight ?? 100);
  return mesh;
}

/** (u, v) on the path's Coons patch nearest `p`. */
export function locateUv(path, p) {
  const coons = coonsFromPath(path);
  if (!coons || !p) return null;
  let best = Infinity, u = 0.5, v = 0.5;
  const n = 32;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const uu = i / n, vv = j / n;
      const q = coons.eval(uu, vv);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < best) { best = d; u = uu; v = vv; }
    }
  }
  return { u, v };
}

export function coonsFromPath(path) {
  const bounds = pathBounds(path);
  if (!bounds) return null;
  const subs = path?.subpaths || [];
  let poly = null;
  let best = -1;
  for (const sp of subs) {
    if ((sp.anchors || []).length < 2) continue;
    const flat = flattenPath({ subpaths: [sp] }, Math.max(1e-6, (bounds.x1 - bounds.x0 + bounds.y1 - bounds.y0) / 2000))[0];
    if (!flat?.pts?.length) continue;
    const pts = flat.pts.map((p) => ({ x: p.x, y: p.y }));
    if (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-9) pts.pop();
    const area = Math.abs(shoelace(pts));
    if (area > best) { best = area; poly = pts; }
  }
  if (!poly || poly.length < 3) return coonsRect(bounds);
  if (shoelace(poly) < 0) poly.reverse();
  const tl = nearest(poly, { x: bounds.x0, y: bounds.y0 });
  const tr = nearest(poly, { x: bounds.x1, y: bounds.y0 });
  const br = nearest(poly, { x: bounds.x1, y: bounds.y1 });
  const bl = nearest(poly, { x: bounds.x0, y: bounds.y1 });
  const top = resample(walk(poly, tl, tr), SIDE);
  const right = resample(walk(poly, tr, br), SIDE);
  const bottom = resample(walk(poly, br, bl), SIDE).reverse();
  const left = resample(walk(poly, bl, tl), SIDE).reverse();
  return {
    top, right, bottom, left,
    eval(u, v) {
      const t = sample(top, u), b = sample(bottom, u), l = sample(left, v), r = sample(right, v);
      const p00 = top[0], p10 = top[SIDE - 1], p01 = bottom[0], p11 = bottom[SIDE - 1];
      return {
        x: (1 - v) * t.x + v * b.x + (1 - u) * l.x + u * r.x
          - ((1 - u) * (1 - v) * p00.x + u * (1 - v) * p10.x + (1 - u) * v * p01.x + u * v * p11.x),
        y: (1 - v) * t.y + v * b.y + (1 - u) * l.y + u * r.y
          - ((1 - u) * (1 - v) * p00.y + u * (1 - v) * p10.y + (1 - u) * v * p01.y + u * v * p11.y),
      };
    },
  };
}

function coonsRect(r) {
  const line = (a, b) => {
    const out = [];
    for (let i = 0; i < SIDE; i++) {
      const t = i / (SIDE - 1);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return out;
  };
  const tl = { x: r.x0, y: r.y0 }, tr = { x: r.x1, y: r.y0 }, br = { x: r.x1, y: r.y1 }, bl = { x: r.x0, y: r.y1 };
  const top = line(tl, tr), right = line(tr, br), bottom = line(bl, br), left = line(tl, bl);
  return {
    top, right, bottom, left,
    eval(u, v) {
      return { x: r.x0 + (r.x1 - r.x0) * u, y: r.y0 + (r.y1 - r.y0) * v };
    },
  };
}

function meshFromSurface(us, vs, s, colorAt) {
  const rows = vs.length - 1, cols = us.length - 1;
  const eps = 1e-3;
  const points = [];
  const at = (u, v) => s(Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
  for (let r = 0; r < vs.length; r++) {
    for (let c = 0; c < us.length; c++) {
      const u = us[c], v = vs[r];
      const p = at(u, v);
      const u0 = Math.max(0, u - eps), u1 = Math.min(1, u + eps);
      const v0 = Math.max(0, v - eps), v1 = Math.min(1, v + eps);
      const su0 = at(u0, v), su1 = at(u1, v);
      const sv0 = at(u, v0), sv1 = at(u, v1);
      const du = { x: (su1.x - su0.x) / (u1 - u0 || 1), y: (su1.y - su0.y) / (u1 - u0 || 1) };
      const dv = { x: (sv1.x - sv0.x) / (v1 - v0 || 1), y: (sv1.y - sv0.y) / (v1 - v0 || 1) };
      const h = (d, from, to) => to == null ? { x: 0, y: 0 } : { x: d.x * (to - from) / 3, y: d.y * (to - from) / 3 };
      const painted = colorAt(r, c, p) || {};
      points.push({
        p,
        color: painted.color || { model: "rgb", r: 1, g: 1, b: 1 },
        opacity: painted.opacity ?? 1,
        handles: [
          h(du, u, us[c + 1]),
          h(du, u, c > 0 ? us[c - 1] : null),
          h(dv, v, vs[r + 1]),
          h(dv, v, r > 0 ? vs[r - 1] : null),
        ],
      });
    }
  }
  return { rows, cols, points };
}

function highlightMesh(mesh, appearance, highlight) {
  const h = Math.max(0, Math.min(100, highlight)) / 100;
  const name = String(appearance || "flat").toLowerCase();
  if (name === "flat" || h <= 0) return mesh;
  const toCenter = name === "center" || name === "tocenter";
  const toEdge = name === "edge" || name === "toedge";
  if (!toCenter && !toEdge) return mesh;
  const { rows, cols, points } = mesh;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const u = c / cols, v = r / rows;
      const d = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
      const w = (toCenter ? 1 - d : d) * h;
      if (w <= 0) continue;
      const pt = points[r * (cols + 1) + c];
      const col = lerpColor(pt.color, { model: "rgb", r: 1, g: 1, b: 1 }, w);
      pt.color = col;
    }
  }
  return mesh;
}

function axisSteps(n, extra) {
  const count = Math.max(1, Math.min(200, n | 0));
  const steps = [];
  for (let i = 0; i <= count; i++) steps.push(i / count);
  if (extra != null && extra > 0.02 && extra < 0.98) {
    steps.push(extra);
    steps.sort((a, b) => a - b);
    return steps.filter((v, i) => i === 0 || v - steps[i - 1] > 1e-6);
  }
  return steps;
}

function shoelace(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

function nearest(poly, c) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = (poly[i].x - c.x) ** 2 + (poly[i].y - c.y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function walk(poly, i, j) {
  const v = [poly[i]];
  let k = i;
  const n = poly.length;
  let guard = 0;
  while (k !== j && guard++ <= n) {
    k = (k + 1) % n;
    v.push(poly[k]);
  }
  return v;
}

function resample(poly, m) {
  if (!poly.length) return Array.from({ length: m }, () => ({ x: 0, y: 0 }));
  if (poly.length === 1) return Array.from({ length: m }, () => ({ ...poly[0] }));
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
  const total = cum[cum.length - 1];
  const out = [];
  let i = 0;
  for (let k = 0; k < m; k++) {
    const s = m > 1 ? total * k / (m - 1) : 0;
    while (i + 2 < cum.length && cum[i + 1] < s) i++;
    const seg = Math.max(1e-12, cum[Math.min(i + 1, cum.length - 1)] - cum[i]);
    const t = Math.max(0, Math.min(1, (s - cum[i]) / seg));
    const a = poly[i], b = poly[Math.min(i + 1, poly.length - 1)];
    out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
  }
  return out;
}

function sample(side, u) {
  const s = u * (side.length - 1);
  const i = Math.max(0, Math.min(side.length - 2, Math.floor(s)));
  const t = s - i;
  return { x: lerp(side[i].x, side[i + 1].x, t), y: lerp(side[i].y, side[i + 1].y, t) };
}
