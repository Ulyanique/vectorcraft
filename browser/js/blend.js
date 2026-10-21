/** Blend spines, matching `blend_spine` and `Rail::place`.

Without a stored spine the spine is the polyline through the key centres. Once it is edited, steps
are shifted from that straight interpolation onto the spine by arc length. Align to Path also
turns them to the spine's direction. */

import { flattenPath, rotateXf } from "./geom.js";
import { nodeBounds, transformNode, translateNode } from "./model.js";

export function centerOf(node) {
  const b = nodeBounds(node);
  if (!b) return { x: 0, y: 0 };
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
}

function cloneSub(sp) {
  return {
    closed: !!sp?.closed,
    anchors: (sp?.anchors || []).map((a) => ({
      p: { ...a.p },
      in: { ...(a.in || a.p) },
      out: { ...(a.out || a.p) },
      kind: a.kind || "Corner",
    })),
  };
}

function corner(p) {
  return { p: { ...p }, in: { ...p }, out: { ...p }, kind: "Corner" };
}

function keyAnchors(spec) {
  const raw = spec?.keyAnchors || spec?.key_anchors || [];
  return raw.map((n) => n | 0);
}

function hasHandle(a, which) {
  const h = a?.[which];
  if (!h || !a?.p) return false;
  return Math.hypot(h.x - a.p.x, h.y - a.p.y) > 1e-6;
}

function translateAnchor(a, dx, dy) {
  a.p = { x: a.p.x + dx, y: a.p.y + dy };
  a.in = { x: a.in.x + dx, y: a.in.y + dy };
  a.out = { x: a.out.x + dx, y: a.out.y + dy };
}

/** The spine path and, when each key sits on an anchor, those anchor indices. */
export function blendSpine(keys, spec) {
  if (!keys || keys.length < 2) return null;
  if (!spec?.spine) {
    const centers = keys.map(centerOf);
    return {
      path: { subpaths: [{ closed: false, anchors: centers.map(corner) }] },
      anchors: centers.map((_, i) => i),
    };
  }
  const first = spec.spine.subpaths?.[0];
  if (!first?.anchors?.length) return null;
  const ka = keyAnchors(spec);
  const pinned = ka.length === keys.length && ka.every((a) => a >= 0 && a < first.anchors.length);
  const sp = cloneSub(first);
  if (!pinned) return { path: { subpaths: [sp] }, anchors: null };
  keys.forEach((k, i) => {
    const a = sp.anchors[ka[i]];
    if (!a) return;
    const c = centerOf(k);
    translateAnchor(a, c.x - a.p.x, c.y - a.p.y);
  });
  return { path: { subpaths: [sp] }, anchors: ka.slice() };
}

function spineGeom(path) {
  const sp = path?.subpaths?.[0];
  const anchors = sp?.anchors || [];
  if (anchors.length < 2) return null;
  const n = anchors.length;
  const segs = sp.closed ? n : n - 1;
  const pts = [];
  const cum = [];
  const anchorLen = [];
  const push = (p) => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) <= 1e-9) return;
    const s = last ? cum[cum.length - 1] + Math.hypot(p.x - last.x, p.y - last.y) : 0;
    pts.push({ x: p.x, y: p.y });
    cum.push(s);
  };
  for (let i = 0; i < segs; i++) {
    anchorLen.push(cum.length ? cum[cum.length - 1] : 0);
    const a = anchors[i % n];
    const b = anchors[(i + 1) % n];
    const line = !hasHandle(a, "out") && !hasHandle(b, "in");
    const flat = line
      ? [a.p, b.p]
      : (flattenPath({ subpaths: [{ anchors: [a, b], closed: false }] }, 0.1)[0]?.pts || [a.p, b.p]);
    for (const p of flat) push(p);
  }
  if (!sp.closed) anchorLen.push(cum.length ? cum[cum.length - 1] : 0);
  if (pts.length < 2) return null;
  return { pts, cum, anchorLen, closed: !!sp.closed, length: cum[cum.length - 1] || 0 };
}

function atLength(geom, s) {
  const last = Math.max(0, geom.pts.length - 2);
  const u0 = Number.isFinite(s) ? Math.max(0, Math.min(geom.length, s)) : 0;
  let lo = 0, hi = geom.cum.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (geom.cum[mid] < u0) lo = mid + 1;
    else hi = mid;
  }
  let i = Math.min(last, Math.max(0, lo - 1));
  if (lo < geom.cum.length && geom.cum[lo] === u0) i = Math.min(last, lo);
  const p0 = geom.pts[i], p1 = geom.pts[i + 1] || p0;
  const c0 = geom.cum[i] || 0, c1 = geom.cum[i + 1] ?? c0;
  const u = Math.max(0, Math.min(1, (u0 - c0) / Math.max(1e-12, c1 - c0)));
  return {
    x: p0.x + (p1.x - p0.x) * u,
    y: p0.y + (p1.y - p0.y) * u,
    ang: Math.atan2(p1.y - p0.y, p1.x - p0.x),
  };
}

function alignsToPath(spec) {
  const o = spec?.orientation || "";
  return o === "alignToPath" || o === "AlignToPath";
}

export function spineActive(spec) {
  return !!(spec?.spine || alignsToPath(spec));
}

function railOf(keys, spec) {
  if (!spineActive(spec)) return null;
  const live = blendSpine(keys, spec);
  if (!live) return null;
  const geom = spineGeom(live.path);
  if (!geom) return null;
  const k = keys.length;
  let stops;
  if (live.anchors) {
    stops = live.anchors.map((a) => geom.anchorLen[a] ?? 0);
    if (geom.closed) {
      for (let i = 1; i < stops.length; i++) {
        if (stops[i] <= stops[i - 1] + 1e-9) stops[i] += geom.length;
      }
    }
  } else {
    stops = Array.from({ length: k }, (_, i) => geom.length * i / Math.max(1, k - 1));
  }
  return { geom, stops, centers: keys.map(centerOf), rotate: alignsToPath(spec) };
}

/** Shift `node` (already the straight interpolation at `t` between keys `i` and `i + 1`) onto the spine. */
export function placeStep(node, keys, spec, i, t) {
  const rail = railOf(keys, spec);
  if (!rail || !node) return node;
  const s0 = rail.stops[i], c0 = rail.centers[i];
  if (s0 == null || !c0) return node;
  let s = s0;
  let base = c0;
  if (t > 0 && rail.stops[i + 1] != null && rail.centers[i + 1]) {
    s = s0 + (rail.stops[i + 1] - s0) * t;
    const c1 = rail.centers[i + 1];
    base = { x: c0.x + (c1.x - c0.x) * t, y: c0.y + (c1.y - c0.y) * t };
  }
  if (rail.geom.closed) {
    const L = Math.max(1e-12, rail.geom.length);
    s = ((s % L) + L) % L;
  }
  const p = atLength(rail.geom, s);
  const offx = p.x - base.x, offy = p.y - base.y;
  if (Math.hypot(offx, offy) > 1e-9) translateNode(node, offx, offy);
  if (rail.rotate && Math.abs(p.ang) > 1e-12) {
    const c = centerOf(node);
    transformNode(node, rotateXf(p.ang, c.x, c.y));
  }
  return node;
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
  };
}

function splitCubic(p0, p1, p2, p3, t) {
  const L = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  const a = L(p0, p1, t), b = L(p1, p2, t), c = L(p2, p3, t);
  const d = L(a, b, t), e = L(b, c, t), f = L(d, e, t);
  return { left: [p0, a, d, f], right: [f, e, c, p3] };
}

function setHandle(a, out, pos, independent) {
  if (independent) a.kind = "Corner";
  const p = a.p;
  const smooth = a.kind === "Smooth";
  if (out) a.out = { x: pos.x, y: pos.y };
  else a.in = { x: pos.x, y: pos.y };
  if (!smooth) return;
  const other = out ? a.in : a.out;
  const len = Math.hypot(other.x - p.x, other.y - p.y);
  const dirx = p.x - pos.x, diry = p.y - pos.y;
  const l = Math.hypot(dirx, diry);
  if (l > 1e-9) {
    const q = { x: p.x + dirx * (len / l), y: p.y + diry * (len / l) };
    if (out) a.in = q;
    else a.out = q;
  }
}

export function nearestOnSubpath(sp, p) {
  const anchors = sp?.anchors || [];
  const n = anchors.length;
  if (n < 2) return null;
  const segs = sp.closed ? n : n - 1;
  let best = Infinity, seg = 0, t = 0, q = { ...anchors[0].p };
  for (let i = 0; i < segs; i++) {
    const a = anchors[i], b = anchors[(i + 1) % n];
    const line = !hasHandle(a, "out") && !hasHandle(b, "in");
    if (line) {
      const abx = b.p.x - a.p.x, aby = b.p.y - a.p.y;
      const len2 = abx * abx + aby * aby || 1;
      const u = Math.max(0, Math.min(1, ((p.x - a.p.x) * abx + (p.y - a.p.y) * aby) / len2));
      const qx = a.p.x + abx * u, qy = a.p.y + aby * u;
      const d = (qx - p.x) ** 2 + (qy - p.y) ** 2;
      if (d < best) { best = d; seg = i; t = u; q = { x: qx, y: qy }; }
    } else {
      const N = 24;
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const c = cubic(a.p, a.out, b.in, b.p, u);
        const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
        if (d < best) { best = d; seg = i; t = u; q = c; }
      }
    }
  }
  return { seg, t, p: q, dist: Math.sqrt(best) };
}

function insertAnchor(sp, seg, t) {
  const n = sp.anchors.length;
  const a = sp.anchors[seg % n];
  const b = sp.anchors[(seg + 1) % n];
  const line = !hasHandle(a, "out") && !hasHandle(b, "in");
  let mid;
  if (line) {
    const p = { x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t };
    mid = corner(p);
  } else {
    const split = splitCubic(a.p, a.out, b.in, b.p, t);
    a.out = { ...split.left[1] };
    b.in = { ...split.right[2] };
    mid = { p: { ...split.left[3] }, in: { ...split.left[2] }, out: { ...split.right[1] }, kind: "Smooth" };
  }
  sp.anchors.splice(seg + 1, 0, mid);
  return seg + 1;
}

function anchorAtLength(sp, s) {
  const geom = spineGeom({ subpaths: [sp] });
  if (!geom) return null;
  const n = sp.anchors.length;
  const segs = sp.closed ? n : n - 1;
  let seg = 0;
  for (let i = segs - 1; i >= 0; i--) {
    if ((geom.anchorLen[i] ?? 0) <= s) { seg = i; break; }
  }
  const from = geom.anchorLen[seg] ?? 0;
  const to = geom.anchorLen[seg + 1] ?? geom.length;
  if (s - from < 0.01) return seg;
  if (to - s < 0.01) return (seg + 1) % Math.max(1, n);
  const t = Math.max(1e-4, Math.min(1 - 1e-4, (s - from) / Math.max(1e-12, to - from)));
  return insertAnchor(sp, seg, t);
}

/** Pin a replace-spine onto anchors, or return the already pinned spine. */
export function pinSpine(keys, spec) {
  const live = blendSpine(keys, spec);
  if (!live) return null;
  if (live.anchors) return { path: live.path, anchors: live.anchors.slice() };
  const sp = live.path.subpaths[0];
  const k = keys.length;
  const anchors = [0];
  for (let i = 1; i < k - 1; i++) {
    const geom = spineGeom(live.path);
    if (!geom) return null;
    const ai = anchorAtLength(sp, geom.length * i / (k - 1));
    if (ai == null) return null;
    anchors.push(ai);
  }
  anchors.push(sp.closed ? 0 : Math.max(0, sp.anchors.length - 1));
  return { path: live.path, anchors };
}

function storeSpine(spec, pinned) {
  spec.spine = pinned.path;
  spec.keyAnchors = pinned.anchors.slice();
  delete spec.key_anchors;
}

export function moveSpineAnchor(blend, index, x, y, handle, independent) {
  const keys = blend?.kind?.children;
  if (!keys || keys.length < 2) return false;
  const spec = blend.kind.spec || (blend.kind.spec = {});
  const pinned = pinSpine(keys, spec);
  const a = pinned?.path.subpaths[0].anchors[index];
  if (!a) return false;
  if (handle === "in" || handle === "out") setHandle(a, handle === "out", { x, y }, !!independent);
  else {
    const dx = x - a.p.x, dy = y - a.p.y;
    translateAnchor(a, dx, dy);
    pinned.anchors.forEach((ai, k) => {
      if (ai === index && keys[k]) translateNode(keys[k], dx, dy);
    });
  }
  storeSpine(spec, pinned);
  return true;
}

export function bendSpineSegment(blend, seg, t, dx, dy) {
  const keys = blend?.kind?.children;
  if (!keys) return false;
  const spec = blend.kind.spec || (blend.kind.spec = {});
  const pinned = pinSpine(keys, spec);
  const sp = pinned?.path.subpaths[0];
  if (!sp) return false;
  const n = sp.anchors.length;
  const segs = sp.closed ? n : n - 1;
  const tt = Math.max(0.05, Math.min(0.95, t));
  if (seg >= segs || n === 0) return false;
  const scale = 3 * tt * (1 - tt);
  if (Math.abs(scale) < 1e-9) return false;
  const vx = dx / scale, vy = dy / scale;
  setHandle(sp.anchors[seg % n], true, { x: sp.anchors[seg % n].out.x + vx, y: sp.anchors[seg % n].out.y + vy }, false);
  const b = sp.anchors[(seg + 1) % n];
  setHandle(b, false, { x: b.in.x + vx, y: b.in.y + vy }, false);
  storeSpine(spec, pinned);
  return true;
}

export function addSpineAnchor(blend, x, y) {
  const keys = blend?.kind?.children;
  if (!keys) return null;
  const spec = blend.kind.spec || (blend.kind.spec = {});
  const pinned = pinSpine(keys, spec);
  const sp = pinned?.path.subpaths[0];
  if (!sp) return null;
  const near = nearestOnSubpath(sp, { x, y });
  if (!near) return null;
  const i = insertAnchor(sp, near.seg, Math.max(1e-3, Math.min(1 - 1e-3, near.t)));
  for (let k = 0; k < pinned.anchors.length; k++) if (pinned.anchors[k] >= i) pinned.anchors[k] += 1;
  storeSpine(spec, pinned);
  return i;
}

export function removeSpineAnchor(blend, index) {
  const keys = blend?.kind?.children;
  if (!keys) return false;
  const spec = blend.kind.spec || (blend.kind.spec = {});
  const pinned = pinSpine(keys, spec);
  const sp = pinned?.path.subpaths[0];
  if (!sp || index < 0 || index >= sp.anchors.length) return false;
  if (pinned.anchors.includes(index) || sp.anchors.length <= 2) return false;
  sp.anchors.splice(index, 1);
  for (let k = 0; k < pinned.anchors.length; k++) if (pinned.anchors[k] > index) pinned.anchors[k] -= 1;
  storeSpine(spec, pinned);
  return true;
}

export function spinePointAt(path, p, tol) {
  const anchors = path?.subpaths?.[0]?.anchors || [];
  let best = Infinity, idx = -1;
  for (let i = 0; i < anchors.length; i++) {
    const d = Math.hypot(anchors[i].p.x - p.x, anchors[i].p.y - p.y);
    if (d <= tol && d < best) { best = d; idx = i; }
  }
  return idx < 0 ? null : idx;
}
