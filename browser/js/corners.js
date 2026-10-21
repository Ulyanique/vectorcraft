// Live Corners, matching the desktop editor: the anchors where two sides meet at an angle,
// cut round, inverted-round or chamfered, and the widgets that drag that radius.

import { applyXf, ident, pathFromAnchors } from "./geom.js";

const EPS = 1e-9;
const MIN_SINE = 1e-6;
const KAPPA = 0.5522847498307936;
const MIN_INSET_PX = 10;
const MIN_SIDE_PX = 30;
const MAX_ANGLE = 177;

const NEXT_KIND = { round: "invertedRound", invertedRound: "chamfer", chamfer: "round" };

function pt(p) {
  return { x: +p?.x || 0, y: +p?.y || 0 };
}
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a, s) { return { x: a.x * s, y: a.y * s }; }
function dot(a, b) { return a.x * b.x + a.y * b.y; }
function cross(a, b) { return a.x * b.y - a.y * b.x; }
function len(a) { return Math.hypot(a.x, a.y); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function same(a, b) { return dist(a, b) <= EPS; }

function anchor(p, hin, hout, kind = "Corner") {
  const q = pt(p);
  return { p: q, in: pt(hin || q), out: pt(hout || q), kind };
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const uu = u * u, tt = t * t;
  return add(add(mul(p0, uu * u), mul(p1, 3 * uu * t)), add(mul(p2, 3 * u * tt), mul(p3, tt * t)));
}
function cubicDeriv(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return add(add(mul(sub(p1, p0), 3 * u * u), mul(sub(p2, p1), 6 * u * t)), mul(sub(p3, p2), 3 * t * t));
}
function splitCubic(p0, p1, p2, p3, t) {
  const lerp = (a, b) => add(a, mul(sub(b, a), t));
  const ab = lerp(p0, p1), bc = lerp(p1, p2), cd = lerp(p2, p3);
  const abc = lerp(ab, bc), bcd = lerp(bc, cd);
  const m = lerp(abc, bcd);
  return { left: [p0, ab, abc, m], right: [m, bcd, cd, p3] };
}
function subsegment(curve, s0, s1) {
  let [p0, p1, p2, p3] = curve;
  const end = Math.max(s0, Math.min(1, s1));
  if (end < 1 - 1e-12) [p0, p1, p2, p3] = splitCubic(p0, p1, p2, p3, end).left;
  if (s0 > 1e-12) {
    const t = end > 1e-12 ? Math.min(1, s0 / end) : 0;
    [p0, p1, p2, p3] = splitCubic(p0, p1, p2, p3, t).right;
  }
  return [p0, p1, p2, p3];
}
function cubicLen(p0, p1, p2, p3, tol = 1e-4, depth = 0) {
  const chord = dist(p0, p3);
  const poly = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  if (depth > 16 || poly - chord < tol) return (poly + chord) / 2;
  const m = splitCubic(p0, p1, p2, p3, 0.5);
  return cubicLen(...m.left, tol, depth + 1) + cubicLen(...m.right, tol, depth + 1);
}
function invArclen(curve, s) {
  const total = cubicLen(...curve);
  if (!(s > 0) || total <= EPS) return 0;
  if (s >= total) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const part = subsegment(curve, 0, mid);
    if (cubicLen(...part) < s) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function sideOf(from, fromHandle, toHandle, to) {
  return { curve: [pt(from), pt(fromHandle), pt(toHandle), pt(to)] };
}
function sideStraight(side) {
  const [p0, p1, p2, p3] = side.curve;
  return dist(p1, p0) <= EPS && dist(p2, p3) <= EPS;
}
function sideDirection(side) {
  const [p0, p1, p2, p3] = side.curve;
  const d = [p1, p2, p3].map((q) => sub(q, p0)).find((v) => len(v) > EPS);
  if (!d) return null;
  const u = mul(d, 1 / len(d));
  return Number.isFinite(u.x) && Number.isFinite(u.y) ? u : null;
}
function sideLength(side) {
  const [p0, , , p3] = side.curve;
  return sideStraight(side) ? dist(p0, p3) : cubicLen(...side.curve);
}
function sideAt(side, s, u) {
  const [p0, , , p3] = side.curve;
  if (sideStraight(side)) {
    const span = dist(p0, p3);
    const t = span > EPS ? Math.max(0, Math.min(1, s / span)) : 0;
    return { t, p: add(p0, mul(u, s)), dir: u };
  }
  const t = Math.max(0, Math.min(1, invArclen(side.curve, s)));
  const d = cubicDeriv(...side.curve, t);
  const n = len(d);
  return { t, p: cubic(...side.curve, t), dir: n > EPS ? mul(d, 1 / n) : u };
}

function cornerOf(sp, i, index) {
  const anchors = sp.anchors || [];
  const n = anchors.length;
  if (!n) return null;
  let prev, next;
  if (sp.closed) {
    prev = (i + n - 1) % n;
    next = (i + 1) % n;
  } else {
    if (i === 0 || i + 1 >= n) return null;
    prev = i - 1;
    next = i + 1;
  }
  const a = anchors[i], before = anchors[prev], after = anchors[next];
  if (!a || !before || !after) return null;
  if (String(a.kind || "Corner").toLowerCase() === "smooth") return null;
  const sideU = sideOf(a.p, a.in, before.out, before.p);
  const sideV = sideOf(a.p, a.out, after.in, after.p);
  const u = sideDirection(sideU);
  const v = sideDirection(sideV);
  if (!u || !v) return null;
  const lu = sideLength(sideU);
  const lv = sideLength(sideV);
  if (!(lu > EPS && lv > EPS && Number.isFinite(lu) && Number.isFinite(lv))) return null;
  const c = { index, at: pt(a.p), u, v, lu, lv, sideU, sideV };
  return Math.abs(cross(u, v)) > MIN_SINE ? c : null;
}

export function pathCorners(path) {
  const out = [];
  let first = 0;
  for (const sp of path?.subpaths || []) {
    const anchors = sp.anchors || [];
    for (let i = 0; i < anchors.length; i++) {
      const c = cornerOf(sp, i, first + i);
      if (c) out.push(c);
    }
    first += anchors.length;
  }
  return out;
}

function arcHandle(cos) {
  if (Math.abs(cos) < 1e-12) return KAPPA;
  const c = Math.max(-1, Math.min(1, cos));
  const sinHalf = Math.sqrt(Math.max(0, (1 - c) / 2));
  const cosHalf = Math.sqrt(Math.max(0, (1 + c) / 2));
  return (4 / 3) * sinHalf / (1 + cosHalf);
}
function squareTo(a, b) {
  const w = sub(b, mul(a, dot(a, b)));
  const l = len(w);
  return l > EPS ? mul(w, 1 / l) : { x: 0, y: 0 };
}
function cornerCos(c) { return dot(c.u, c.v); }
function cornerSin(c) { return Math.abs(cross(c.u, c.v)); }
export function cornerAngle(c) { return Math.atan2(cornerSin(c), cornerCos(c)) * 180 / Math.PI; }
function setback(c, r) { return r * (1 + cornerCos(c)) / cornerSin(c); }
export function maxRadius(c) { return Math.min(c.lu, c.lv) / 2 * cornerSin(c) / (1 + cornerCos(c)); }
export function fittedRadius(c, radius) { return Math.max(0, Math.min(maxRadius(c), radius || 0)); }
function onBisector(c, k) { return add(c.at, mul(add(c.u, c.v), k)); }
export function radiusChange(c, d) {
  return dot(d, add(c.u, c.v)) * cornerSin(c) / (2 + 2 * cornerCos(c));
}

function cutOf(c, radius, kind) {
  const s = setback(c, radius);
  const u = sideAt(c.sideU, s, c.u);
  const v = sideAt(c.sideV, s, c.v);
  const cos = dot(u.dir, v.dir);
  let hout, hin;
  if (kind === "invertedRound") {
    const h = s * arcHandle(cos);
    hout = add(u.p, mul(squareTo(u.dir, v.dir), h));
    hin = add(v.p, mul(squareTo(v.dir, u.dir), h));
  } else if (kind === "chamfer") {
    hout = u.p;
    hin = v.p;
  } else {
    const h = radius * arcHandle(-cos);
    hout = sub(u.p, mul(u.dir, h));
    hin = sub(v.p, mul(v.dir, h));
  }
  return { tu: u.t, tv: v.t, start: u.p, hout, hin, end: v.p };
}

function pad(list, n, fill) {
  const out = (list || []).slice(0, n);
  while (out.length < n) out.push(fill);
  return out;
}
function anchorCount(path) {
  return (path?.subpaths || []).reduce((n, sp) => n + (sp.anchors?.length || 0), 0);
}
function identitySources(path) {
  const out = [];
  let first = 0;
  for (const sp of path?.subpaths || []) {
    const n = sp.anchors?.length || 0;
    out.push(Array.from({ length: n }, (_, i) => first + i));
    first += n;
  }
  return out;
}

/** `path` with each corner cut. Radii and kinds are indexed by the uncut anchor. */
export function cutCorners(path, radii = [], kinds = []) {
  const corners = pathCorners(path);
  let ci = 0;
  const subpaths = [];
  const sources = [];
  let first = 0;
  for (const sp of path?.subpaths || []) {
    const anchors = sp.anchors || [];
    const n = anchors.length;
    const cuts = anchors.map((_, i) => {
      const index = first + i;
      const c = corners[ci]?.index === index ? corners[ci++] : null;
      if (!c) return null;
      const radius = fittedRadius(c, radii[index] || 0);
      return radius > EPS ? cutOf(c, radius, kinds[index] || "round") : null;
    });
    const trimmed = anchors.map((a, j) => {
      const k = (j + 1) % n;
      const b = anchors[k];
      const from = cuts[j];
      const to = cuts[k];
      if ((!from && !to) || (k === 0 && !sp.closed)) return null;
      if (same(pt(a.p), pt(a.out)) && same(pt(b.in), pt(b.p))) {
        return [from ? from.end : pt(a.p), to ? to.start : pt(b.p)];
      }
      const s0 = from ? from.tv : 0;
      const s1 = to ? 1 - to.tu : 1;
      const sub = subsegment([pt(a.p), pt(a.out), pt(b.in), pt(b.p)], s0, Math.max(s0, s1));
      return [sub[1], sub[2]];
    });
    const next = [];
    const from = [];
    let closing = null;
    anchors.forEach((a, i) => {
      const index = first + i;
      const hin = trimmed[(i + n - 1) % n]?.[1] || pt(a.in);
      const hout = trimmed[i]?.[0] || pt(a.out);
      const cut = cuts[i];
      if (cut) {
        const start = anchor(cut.start, hin, cut.hout);
        const end = anchor(cut.end, cut.hin, hout);
        if (i === 0 && sp.closed) closing = { anchor: start, index };
        else { next.push(start); from.push(index); }
        next.push(end);
        from.push(index);
      } else {
        next.push(anchor(a.p, hin, hout, a.kind || "Corner"));
        from.push(index);
      }
    });
    if (closing) { next.push(closing.anchor); from.push(closing.index); }
    first += n;
    subpaths.push({ anchors: next, closed: !!sp.closed });
    sources.push(from);
  }
  return { path: { subpaths }, sources };
}

export function transformPath(path, xf) {
  if (!xf) return path;
  const map = (p) => applyXf(xf, pt(p));
  return {
    subpaths: (path?.subpaths || []).map((sp) => ({
      closed: !!sp.closed,
      anchors: (sp.anchors || []).map((a) => ({ p: map(a.p), in: map(a.in), out: map(a.out), kind: a.kind || "Corner" })),
    })),
  };
}

function det(xf) {
  const m = xf || ident();
  return m[0] * m[3] - m[1] * m[2];
}
export function invertXf(xf) {
  const m = xf || ident();
  const d = det(m);
  if (Math.abs(d) < 1e-12) return ident();
  const [a, b, c, e, f, g] = [m[0], m[1], m[2], m[3], m[4], m[5]];
  const ia = e / d, ib = -b / d, ic = -c / d, id = a / d;
  return [ia, ib, ic, id, -(ia * f + ic * g), -(ib * f + id * g)];
}

function rectBase(w, h) {
  return pathFromAnchors([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], true);
}
function ellipseLocal(w, h) {
  const cx = w / 2, cy = h / 2, rx = Math.abs(w) / 2, ry = Math.abs(h) / 2;
  const kx = rx * KAPPA, ky = ry * KAPPA;
  const s = (x, y, ix, iy) => anchor({ x, y }, { x: x + ix, y: y + iy }, { x: x - ix, y: y - iy }, "Smooth");
  return { subpaths: [{ closed: true, anchors: [s(cx - rx, cy, 0, ky), s(cx, cy - ry, -kx, 0), s(cx + rx, cy, 0, -ky), s(cx, cy + ry, kx, 0)] }] };
}
function wrapDeg(a) {
  if (!Number.isFinite(+a)) return 0;
  const x = (+a) % 360;
  return x < 0 ? x + 360 : x;
}
function pieEnd(a) {
  const x = wrapDeg(a);
  return x === 0 ? 360 : x;
}

export function ellipsePiePath(w, h, start, end, xf) {
  const span = wrapDeg((+end || 0) - (+start || 0));
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || span < 1e-9 || 360 - span < 1e-9) {
    return transformPath(ellipseLocal(w, h), xf || ident());
  }
  const cx = w / 2, cy = h / 2, rx = Math.abs(w) / 2, ry = Math.abs(h) / 2;
  const at = (deg) => {
    const t = deg * Math.PI / 180;
    return { x: cx + rx * Math.cos(t), y: cy - ry * Math.sin(t) };
  };
  const tangent = (deg) => {
    const t = deg * Math.PI / 180;
    return { x: -rx * Math.sin(t), y: -ry * Math.cos(t) };
  };
  const pieces = span <= 90 ? 1 : span <= 180 ? 2 : span <= 270 ? 3 : 4;
  const step = span / pieces;
  const k = (4 / 3) * Math.tan((step * Math.PI / 180) / 4);
  const anchors = [anchor({ x: cx, y: cy })];
  for (let i = 0; i <= pieces; i++) {
    const a = (+start || 0) + step * i;
    const p = at(a);
    const d = mul(tangent(a), k);
    anchors.push(anchor(p, i === 0 ? p : sub(p, d), i === pieces ? p : add(p, d), i === 0 || i === pieces ? "Corner" : "Smooth"));
  }
  return transformPath({ subpaths: [{ anchors, closed: true }] }, xf || ident());
}

function polygonOutline(live) {
  const sides = Math.max(3, live.sides || 3);
  const r = live.radius || 0;
  const xf = live.xf || ident();
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + Math.PI * 2 * i / sides;
    pts.push(applyXf(xf, { x: Math.cos(a) * r, y: Math.sin(a) * r }));
  }
  return pathFromAnchors(pts, true);
}

function foldedRect(live) {
  const next = { ...live, radii: (live.radii || [0, 0, 0, 0]).slice(), xf: (live.xf || ident()).slice() };
  const [m0, m1, m2, m3, m4, m5] = next.xf;
  const sx = Math.hypot(m0, m1), sy = Math.hypot(m2, m3);
  const orthogonal = sx > 1e-12 && sy > 1e-12 && Math.abs(m0 * m2 + m1 * m3) <= 1e-9 * sx * sy;
  const unscaled = Math.abs(sx - 1) < 1e-12 && Math.abs(sy - 1) < 1e-12;
  if (!orthogonal || unscaled || !Number.isFinite(next.w) || !Number.isFinite(next.h)) return next;
  const k = Math.sqrt(sx * sy);
  next.radii = pad(next.radii, 4, 0).map((r) => r * k);
  next.w *= sx;
  next.h *= sy;
  next.xf = [m0 / sx, m1 / sx, m2 / sy, m3 / sy, m4, m5];
  return next;
}

function knownShape(live) {
  return live && ["rectangle", "ellipse", "polygon", "line", "path"].includes(live.shape);
}

/** Corners of a path's uncut outline. Null for ellipses and lines. */
export function liveCorners(node) {
  const k = node?.kind;
  if (k?.type !== "path" || !k.path) return null;
  const live = k.live;
  if (live?.shape === "ellipse" || live?.shape === "line") return null;
  if (live?.shape === "rectangle") {
    const folded = foldedRect(live);
    const base = rectBase(folded.w, folded.h);
    const radii = pad(folded.radii, 4, 0);
    const kinds = pad(folded.kinds, 4, "round");
    const sources = radii.some((r) => r > 0) ? cutCorners(base, radii, kinds).sources : identitySources(base);
    return { base, xf: folded.xf, corners: pathCorners(base), radii, kinds, sources, shape: "rectangle" };
  }
  if (live?.shape === "polygon") {
    const base = polygonOutline(live);
    const n = anchorCount(base);
    const radii = pad(live.radii, n, 0);
    const kinds = pad(live.kinds, n, "round");
    const sources = radii.some((r) => r > 0) ? cutCorners(base, radii, kinds).sources : identitySources(base);
    return { base, xf: ident(), corners: pathCorners(base), radii, kinds, sources, shape: "polygon" };
  }
  if (live?.shape === "path" && live.base) {
    const n = anchorCount(live.base);
    const radii = pad(live.radii, n, 0);
    const kinds = pad(live.kinds, n, "round");
    const sources = radii.some((r) => r > 0) || kinds.some((kind) => kind !== "round")
      ? cutCorners(live.base, radii, kinds).sources
      : identitySources(live.base);
    return { base: live.base, xf: ident(), corners: pathCorners(live.base), radii, kinds, sources, shape: "path" };
  }
  if (knownShape(live)) return null;
  return { base: k.path, xf: ident(), corners: pathCorners(k.path), radii: [], kinds: [], sources: identitySources(k.path), shape: null };
}

function angleIn(xf, c) {
  const m = xf || ident();
  const map = (v) => ({ x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y });
  const u = map(c.u), v = map(c.v);
  return Math.atan2(Math.abs(cross(u, v)), dot(u, v)) * 180 / Math.PI;
}

export function cornerWidgets(node, zoom = 1, anyPath = false) {
  const live = node?.kind?.live;
  if (!anyPath && live?.shape !== "rectangle" && live?.shape !== "polygon") return [];
  const lc = liveCorners(node);
  if (!lc?.corners.length) return [];
  const scale = Math.abs(zoom) * Math.sqrt(Math.abs(det(lc.xf)));
  if (!(scale > 1e-9)) return [];
  const widgets = [];
  for (const c of lc.corners) {
    if (Math.min(c.lu, c.lv) * scale < MIN_SIDE_PX) continue;
    if (angleIn(lc.xf, c) > MAX_ANGLE + 1e-9) continue;
    const radius = lc.radii[c.index] || 0;
    const drawn = fittedRadius(c, radius);
    const inset = MIN_INSET_PX / (scale * Math.sqrt(1 + cornerCos(c)));
    const k = Math.min(Math.max(drawn / cornerSin(c), inset), Math.min(c.lu, c.lv) / 2);
    widgets.push({
      id: node.id,
      index: c.index,
      at: applyXf(lc.xf, onBisector(c, k)),
      radius,
      fitted: drawn,
      kind: lc.kinds[c.index] || "round",
      corner: c,
      xf: lc.xf,
      max: maxRadius(c),
    });
  }
  return widgets;
}

export function hitCornerWidget(nodes, p, zoom, anyPath, tol) {
  let best = null;
  let bestD = tol;
  for (const n of nodes || []) {
    if (!n || n.visible === false || n.locked || n.kind?.guide) continue;
    for (const w of cornerWidgets(n, zoom, anyPath)) {
      const d = dist(w.at, p);
      if (d <= bestD) { bestD = d; best = { node: n, ...w }; }
    }
  }
  return best;
}

function writePath(node, path) {
  node.kind.path = path;
}

export function rectanglePath(w, h, radii, kinds, xf) {
  const cut = cutCorners(rectBase(w, h), pad(radii, 4, 0), pad(kinds, 4, "round"));
  return transformPath(cut.path, xf || ident());
}

function rebuild(node) {
  const live = node.kind?.live;
  if (!live) return;
  if (live.shape === "rectangle") {
    const folded = foldedRect(live);
    Object.assign(live, { w: folded.w, h: folded.h, radii: folded.radii, xf: folded.xf });
    if (folded.kinds && folded.kinds.some((k) => k !== "round")) live.kinds = folded.kinds;
    writePath(node, rectanglePath(live.w, live.h, live.radii, live.kinds, live.xf));
  } else if (live.shape === "polygon") {
    const n = Math.max(3, live.sides || 3);
    const radii = pad(live.radii, n, 0);
    const kinds = pad(live.kinds, n, "round");
    writePath(node, cutCorners(polygonOutline(live), radii, kinds).path);
  } else if (live.shape === "path") {
    writePath(node, cutCorners(live.base, live.radii || [], live.kinds || []).path);
  } else if (live.shape === "ellipse") {
    const pie = piePair(live);
    writePath(node, ellipsePiePath(live.w, live.h, pie[0], pie[1], live.xf));
  }
}

function ensureLive(node) {
  const k = node.kind;
  if (k.live?.shape === "rectangle" || k.live?.shape === "polygon" || k.live?.shape === "path") return k.live;
  if (k.live?.shape === "ellipse" || k.live?.shape === "line") return null;
  k.live = { shape: "path", base: structuredClone(k.path), radii: [], kinds: [] };
  return k.live;
}

/** Set radius and/or kind on a path's corners, then cut it again. */
export function setLiveCorners(node, { radius, kind, corners } = {}) {
  if (node?.kind?.type !== "path") return false;
  if (radius == null && !kind) return false;
  const live = ensureLive(node);
  if (!live) return false;
  if (live.shape === "rectangle") {
    const folded = foldedRect(live);
    Object.assign(live, folded);
    live.radii = pad(live.radii, 4, 0);
    live.kinds = pad(live.kinds, 4, "round");
    const picked = corners?.length ? corners : [0, 1, 2, 3];
    for (const i of picked) {
      if (i < 0 || i > 3) continue;
      if (radius != null) live.radii[i] = Math.max(0, +radius || 0);
      if (kind) live.kinds[i] = kind;
    }
    if (live.kinds.every((k) => k === "round")) delete live.kinds;
  } else {
    const base = live.shape === "polygon" ? polygonOutline(live) : live.base;
    const n = live.shape === "polygon" ? Math.max(3, live.sides || 3) : anchorCount(base);
    if (live.shape === "path") live.base = live.base || base;
    const radii = pad(live.radii, n, 0);
    const kinds = pad(live.kinds, n, "round");
    const picked = corners?.length ? corners : pathCorners(base).map((c) => c.index);
    for (const i of picked) {
      if (i < 0 || i >= n) continue;
      if (radius != null) radii[i] = Math.max(0, +radius || 0);
      if (kind) kinds[i] = kind;
    }
    const sharp = radii.every((r) => r <= 0);
    const round = kinds.every((k) => k === "round");
    if (live.shape === "path" && sharp && round) {
      node.kind.path = live.base;
      delete node.kind.live;
      return true;
    }
    live.radii = sharp ? [] : radii;
    if (round) delete live.kinds;
    else live.kinds = kinds;
  }
  rebuild(node);
  return true;
}

export function nextCornerKind(kind) {
  return NEXT_KIND[kind] || "invertedRound";
}

function piePair(live) {
  const pie = live?.pie;
  if (Array.isArray(pie)) return [+pie[0] || 0, pie[1] == null ? 360 : +pie[1]];
  return [0, 360];
}

export function setEllipsePie(node, { start, end, invert } = {}) {
  const live = node?.kind?.live;
  if (live?.shape !== "ellipse") return false;
  let [a, b] = piePair(live);
  if (start != null) a = wrapDeg(start);
  if (end != null) b = pieEnd(end);
  if (invert) { const s = a; a = wrapDeg(b); b = pieEnd(s); }
  live.pie = [a, b];
  if (!live.xf) live.xf = ident();
  rebuild(node);
  return true;
}

export function setPolygonSides(node, sides) {
  const live = node?.kind?.live;
  if (live?.shape !== "polygon") return false;
  const n = Math.max(3, Math.min(1000, Math.round(+sides || 3)));
  const spread = (list, fill) => {
    if (!list?.length) return list;
    const same = list.every((v) => v === list[0]);
    return same ? Array(n).fill(list[0]) : pad(list, n, fill);
  };
  live.sides = n;
  if (live.radii?.length) live.radii = spread(live.radii, 0);
  if (live.kinds?.length) {
    live.kinds = spread(live.kinds, "round");
    if (live.kinds.every((k) => k === "round")) delete live.kinds;
  }
  rebuild(node);
  return true;
}

/** A drawn rectangle, ellipse or polygon, with the live parameters the desktop stores. */
export function liveShapeSpec(tool, x0, y0, w, h, sides = 6) {
  const W = Math.abs(w), H = Math.abs(h);
  const ox = Math.min(x0, x0 + w), oy = Math.min(y0, y0 + h);
  if (tool === "rectangle" || tool === "roundedRectangle") {
    const r = tool === "roundedRectangle" ? Math.min(W, H) * 0.2 : 0;
    const radii = [r, r, r, r];
    const xf = [1, 0, 0, 1, ox, oy];
    return {
      name: r ? "Rounded Rectangle" : "Rectangle",
      live: { shape: "rectangle", w: W, h: H, radii, xf },
      path: rectanglePath(W, H, radii, null, xf),
    };
  }
  if (tool === "ellipse") {
    const xf = [1, 0, 0, 1, ox, oy];
    return {
      name: "Ellipse",
      live: { shape: "ellipse", w: W, h: H, pie: [0, 360], xf },
      path: ellipsePiePath(W, H, 0, 360, xf),
    };
  }
  if (tool === "polygon") {
    const cx = x0 + w / 2, cy = y0 + h / 2, r = Math.max(W, H) / 2;
    const xf = [1, 0, 0, 1, cx, cy];
    const live = { shape: "polygon", radius: r, sides, xf };
    return { name: "Polygon", live, path: polygonOutline(live) };
  }
  return null;
}
