/** Geometry shared by the renderer, hit-testing and editing tools. */

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.hypot(dx, dy); }
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function mul(a, s) { return { x: a.x * s, y: a.y * s }; }
export function dot(a, b) { return a.x * b.x + a.y * b.y; }
export function len(a) { return Math.hypot(a.x, a.y); }
export function norm(a) { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; }
export function same(a, b, e = 1e-4) { return Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e; }

export function rgbCss(c, a = 1) {
  if (!c) return `rgba(0,0,0,${a})`;
  if (c.model === "gray") {
    // Illustrator gray is ink: 0 = white, 1 = black.
    const v = Math.round(clamp(1 - (c.k ?? c.v ?? 0), 0, 1) * 255);
    return `rgba(${v},${v},${v},${a})`;
  }
  if (c.model === "cmyk") {
    const C = c.c ?? 0, M = c.m ?? 0, Y = c.y ?? 0, K = c.k ?? 0;
    const r = 1 - Math.min(1, C * (1 - K) + K);
    const g = 1 - Math.min(1, M * (1 - K) + K);
    const b = 1 - Math.min(1, Y * (1 - K) + K);
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
  }
  const r = Math.round(clamp(c.r ?? 0, 0, 1) * 255);
  const g = Math.round(clamp(c.g ?? 0, 0, 1) * 255);
  const b = Math.round(clamp(c.b ?? 0, 0, 1) * 255);
  return `rgba(${r},${g},${b},${a})`;
}

export function hexToRgb(hex) {
  const h = hex.replace("#", "").trim();
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const v = parseInt(n, 16);
  if (Number.isNaN(v) || n.length < 6) return { model: "rgb", r: 0, g: 0, b: 0 };
  return { model: "rgb", r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

export function rgbToHex(c) {
  const ch = (x) => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, "0");
  if (!c) return "#000000";
  if (c.model === "gray") { const v = ch(1 - (c.k ?? 0)); return `#${v}${v}${v}`; }
  if (c.model === "cmyk") {
    const css = rgbCss(c);
    const m = css.match(/rgba?\((\d+),(\d+),(\d+)/);
    if (!m) return "#000000";
    return "#" + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, "0")).join("");
  }
  return `#${ch(c.r ?? 0)}${ch(c.g ?? 0)}${ch(c.b ?? 0)}`;
}

export function lerpColor(a, b, t) {
  const A = toRgb(a), B = toRgb(b);
  return { model: "rgb", r: lerp(A.r, B.r, t), g: lerp(A.g, B.g, t), b: lerp(A.b, B.b, t) };
}

export function toRgb(c) {
  if (!c) return { r: 0, g: 0, b: 0 };
  if (c.model === "cmyk") {
    const C = c.c ?? 0, M = c.m ?? 0, Y = c.y ?? 0, K = c.k ?? 0;
    return { r: 1 - Math.min(1, C * (1 - K) + K), g: 1 - Math.min(1, M * (1 - K) + K), b: 1 - Math.min(1, Y * (1 - K) + K) };
  }
  if (c.model === "gray") { const v = 1 - (c.k ?? 0); return { r: v, g: v, b: v }; }
  return { r: c.r ?? 0, g: c.g ?? 0, b: c.b ?? 0 };
}

/** SVG matrix order: x' = a x + c y + e, y' = b x + d y + f. */
export function ident() { return [1, 0, 0, 1, 0, 0]; }
export function applyXf(xf, p) {
  if (!xf) return { x: p.x, y: p.y };
  const [a, b, c, d, e, f] = xf;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}
export function mulXf(m, n) {
  const [a1, b1, c1, d1, e1, f1] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}
export function translateXf(x, y) { return [1, 0, 0, 1, x, y]; }
export function scaleXf(sx, sy, ox = 0, oy = 0) {
  return mulXf(translateXf(ox, oy), mulXf([sx, 0, 0, sy, 0, 0], translateXf(-ox, -oy)));
}
export function rotateXf(rad, ox = 0, oy = 0) {
  const co = Math.cos(rad), si = Math.sin(rad);
  return mulXf(translateXf(ox, oy), mulXf([co, si, -si, co, 0, 0], translateXf(-ox, -oy)));
}

export function emptyBounds() { return null; }
export function boundsOf(pts) {
  let b = null;
  for (const p of pts) b = include(b, p);
  return b;
}
export function include(b, p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return b;
  if (!b) return { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  return { x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) };
}
export function union(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
export function pad(b, m) {
  if (!b) return b;
  return { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m };
}
export function bw(b) { return b ? b.x1 - b.x0 : 0; }
export function bh(b) { return b ? b.y1 - b.y0 : 0; }
export function center(b) { return b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : { x: 0, y: 0 }; }
export function contains(b, p, e = 0) {
  return !!b && p.x >= b.x0 - e && p.x <= b.x1 + e && p.y >= b.y0 - e && p.y <= b.y1 + e;
}
export function intersects(a, b) {
  return !!a && !!b && a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

export function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const uu = u * u, tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}
export function cubicBounds(p0, p1, p2, p3) {
  let b = include(include(null, p0), p3);
  for (const t of cubicExtrema(p0.x, p1.x, p2.x, p3.x)) b = include(b, cubic(p0, p1, p2, p3, t));
  for (const t of cubicExtrema(p0.y, p1.y, p2.y, p3.y)) b = include(b, cubic(p0, p1, p2, p3, t));
  return b;
}
function cubicExtrema(p0, p1, p2, p3) {
  const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
  const b = 6 * (p0 - 2 * p1 + p2);
  const c = 3 * (p1 - p0);
  const out = [];
  if (Math.abs(a) < 1e-8) {
    if (Math.abs(b) > 1e-8) {
      const t = -c / b;
      if (t > 0 && t < 1) out.push(t);
    }
    return out;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return out;
  const s = Math.sqrt(disc);
  for (const t of [(-b + s) / (2 * a), (-b - s) / (2 * a)]) {
    if (t > 1e-6 && t < 1 - 1e-6) out.push(t);
  }
  return out;
}

export function subpathBounds(sp) {
  const a = sp.anchors || [];
  if (!a.length) return null;
  let b = null;
  for (let i = 0; i < a.length; i++) {
    const n = (i + 1) % a.length;
    if (!sp.closed && i === a.length - 1) { b = include(b, a[i].p); break; }
    const p0 = a[i].p, p3 = a[n].p, p1 = a[i].out, p2 = a[n].in;
    if (same(p0, p1) && same(p2, p3)) b = include(include(b, p0), p3);
    else b = union(b, cubicBounds(p0, p1, p2, p3));
  }
  return b;
}

export function pathBounds(path) {
  let b = null;
  for (const sp of path?.subpaths || []) b = union(b, subpathBounds(sp));
  return b;
}

function pt(p) {
  if (!p) return { x: 0, y: 0 };
  if (Array.isArray(p)) return { x: +p[0] || 0, y: +p[1] || 0 };
  return { x: +p.x || 0, y: +p.y || 0 };
}

export function pathD(path) {
  let d = "";
  for (const sp of path?.subpaths || []) {
    const a = sp.anchors || [];
    if (!a.length || !a[0].p) continue;
    const p0 = pt(a[0].p);
    d += `M ${n(p0.x)} ${n(p0.y)}`;
    const segs = sp.closed ? a.length : a.length - 1;
    for (let i = 0; i < segs; i++) {
      const cur = a[i], nxt = a[(i + 1) % a.length];
      if (!cur?.p || !nxt?.p) continue;
      const cp = pt(cur.p), co = pt(cur.out || cur.p), np = pt(nxt.p), ni = pt(nxt.in || nxt.p);
      if (same(cp, co) && same(ni, np)) d += `L ${n(np.x)} ${n(np.y)}`;
      else d += `C ${n(co.x)} ${n(co.y)} ${n(ni.x)} ${n(ni.y)} ${n(np.x)} ${n(np.y)}`;
    }
    if (sp.closed) d += "Z";
  }
  return d;
}
function n(v) { return Math.abs(v) < 1e-4 ? "0" : (Math.round(v * 1000) / 1000).toString(); }

/** Flatten a path to polylines (one per subpath). */
export function flattenPath(path, tol = 0.6) {
  const rings = [];
  for (const sp of path?.subpaths || []) {
    const a = sp.anchors || [];
    if (a.length < 2) continue;
    const pts = [a[0].p];
    const segs = sp.closed ? a.length : a.length - 1;
    for (let i = 0; i < segs; i++) {
      const cur = a[i], nxt = a[(i + 1) % a.length];
      if (same(cur.p, cur.out) && same(nxt.in, nxt.p)) pts.push(nxt.p);
      else flattenCubic(cur.p, cur.out, nxt.in, nxt.p, tol, pts);
    }
    rings.push({ pts, closed: !!sp.closed });
  }
  return rings;
}

function flattenCubic(p0, p1, p2, p3, tol, out) {
  const stack = [[p0, p1, p2, p3]];
  let guard = 0;
  while (stack.length && guard++ < 8000) {
    const [a, b, c, d] = stack.pop();
    if (flatEnough(a, b, c, d, tol)) out.push(d);
    else {
      const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d);
      const abbc = mid(ab, bc), bccd = mid(bc, cd);
      const m = mid(abbc, bccd);
      stack.push([m, bccd, cd, d]);
      stack.push([a, ab, abbc, m]);
    }
  }
}
function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function flatEnough(a, b, c, d, tol) {
  const ux = 3 * b.x - 2 * a.x - d.x, uy = 3 * b.y - 2 * a.y - d.y;
  const vx = 3 * c.x - 2 * d.x - a.x, vy = 3 * c.y - 2 * d.y - a.y;
  return Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy) <= tol * tol * 16;
}

export function pointInRing(p, ring) {
  let w = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a.y > p.y) !== (b.y > p.y)) {
      const x = a.x + (b.x - a.x) * (p.y - a.y) / ((b.y - a.y) || 1e-12);
      if (p.x < x) w++;
    }
  }
  return w % 2 === 1;
}

export function distToSeg(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1;
  let t = dot(sub(p, a), ab) / l2;
  t = clamp(t, 0, 1);
  return dist(p, add(a, mul(ab, t)));
}

export function hitStroke(path, p, width) {
  const tol = Math.max(width, 1) / 2 + 1.5;
  for (const ring of flattenPath(path, 0.8)) {
    const pts = ring.pts;
    const n = ring.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      if (distToSeg(p, pts[i], pts[(i + 1) % pts.length]) <= tol) return true;
    }
  }
  return false;
}

export function hitFill(path, p, rule) {
  const rings = flattenPath(path, 0.8).filter((r) => r.closed && r.pts.length > 2);
  if (!rings.length) return false;
  if (rule === "EvenOdd") {
    let w = 0;
    for (const r of rings) if (pointInRing(p, r.pts)) w++;
    return w % 2 === 1;
  }
  // NonZero approximated by odd-even of the outer-most; good enough for typical art.
  for (const r of rings) if (pointInRing(p, r.pts)) return true;
  return false;
}

export function translatePath(path, dx, dy) {
  for (const sp of path.subpaths || []) {
    for (const a of sp.anchors || []) {
      a.p = add(a.p, { x: dx, y: dy });
      a.in = add(a.in, { x: dx, y: dy });
      a.out = add(a.out, { x: dx, y: dy });
    }
  }
}

export function transformPath(path, xf) {
  for (const sp of path.subpaths || []) {
    for (const a of sp.anchors || []) {
      a.p = applyXf(xf, a.p);
      a.in = applyXf(xf, a.in);
      a.out = applyXf(xf, a.out);
    }
  }
}

export function roundedRectPath(x, y, w, h, r = 0) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  if (rr < 0.5) return pathFromAnchors([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
  const k = 0.5522847498 * rr;
  const a = (px, py, ix, iy, ox, oy) => ({ p: { x: px, y: py }, in: { x: ix, y: iy }, out: { x: ox, y: oy }, kind: "Smooth" });
  return {
    subpaths: [{
      closed: true,
      anchors: [
        a(x + rr, y, x + rr - k, y, x + rr, y),
        a(x + w - rr, y, x + w - rr, y, x + w - rr + k, y),
        a(x + w, y + rr, x + w, y + rr - k, x + w, y + rr),
        a(x + w, y + h - rr, x + w, y + h - rr, x + w, y + h - rr + k),
        a(x + w - rr, y + h, x + w - rr + k, y + h, x + w - rr, y + h),
        a(x + rr, y + h, x + rr, y + h, x + rr - k, y + h),
        a(x, y + h - rr, x, y + h - rr + k, x, y + h - rr),
        a(x, y + rr, x, y + rr, x, y + rr - k),
      ],
    }],
  };
}

export function rectPath(x, y, w, h, radii = [0, 0, 0, 0]) {
  const [r0, r1, r2, r3] = radii.map((r) => Math.max(0, Math.min(r, Math.min(Math.abs(w), Math.abs(h)) / 2)));
  if (r0 + r1 + r2 + r3 < 0.01) {
    return pathFromAnchors([
      { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
    ], true);
  }
  const k = 0.5522847498;
  const pts = [];
  const corner = (cx, cy, a0, rx, ry) => {
    // not used — build with arcs approximated
  };
  void corner;
  // Clockwise from top-left, y-down.
  const c = (px, py) => ({ p: { x: px, y: py }, in: { x: px, y: py }, out: { x: px, y: py }, kind: "Corner" });
  const arc = (cx, cy, rx, ry, a0, a1) => {
    const segs = 1;
    void segs;
    const p0 = { x: cx + Math.cos(a0) * rx, y: cy + Math.sin(a0) * ry };
    const p1 = { x: cx + Math.cos(a1) * rx, y: cy + Math.sin(a1) * ry };
    const da = a1 - a0;
    const h = 4 / 3 * Math.tan(da / 4);
    return {
      p: p1,
      in: { x: p1.x + Math.sin(a1) * rx * h, y: p1.y - Math.cos(a1) * ry * h },
      out: { x: p1.x, y: p1.y },
      startOut: { x: p0.x - Math.sin(a0) * rx * h, y: p0.y + Math.cos(a0) * ry * h },
      p0,
      kind: "Smooth",
    };
  };
  // corners: TL, TR, BR, BL
  const corners = [
    { cx: x + r0, cy: y + r0, rx: r0, ry: r0, a0: Math.PI, a1: Math.PI * 1.5 },
    { cx: x + w - r1, cy: y + r1, rx: r1, ry: r1, a0: -Math.PI / 2, a1: 0 },
    { cx: x + w - r2, cy: y + h - r2, rx: r2, ry: r2, a0: 0, a1: Math.PI / 2 },
    { cx: x + r3, cy: y + h - r3, rx: r3, ry: r3, a0: Math.PI / 2, a1: Math.PI },
  ];
  const anchors = [];
  for (const cn of corners) {
    if (cn.rx < 0.01) {
      const px = cn.a0 === Math.PI ? x : cn.a0 === -Math.PI / 2 ? x + w : cn.a0 === 0 ? x + w : x;
      const py = cn.a0 === Math.PI ? y : cn.a0 === -Math.PI / 2 ? y : cn.a0 === 0 ? y + h : y + h;
      anchors.push(c(px, py));
    } else {
      const ar = arc(cn.cx, cn.cy, cn.rx, cn.ry, cn.a0, cn.a1);
      if (anchors.length) anchors[anchors.length - 1].out = ar.startOut;
      else pts._firstOut = ar.startOut;
      anchors.push({ p: ar.p, in: ar.in, out: { x: ar.p.x, y: ar.p.y }, kind: "Smooth" });
      if (!anchors._start) anchors._start = ar.p0;
    }
  }
  if (pts._firstOut && anchors[0]) {
    // close the first corner's incoming handle onto the last
  }
  if (anchors._start && anchors.length) {
    const last = anchors[anchors.length - 1];
    // the first anchor should be the start of the first arc
    const first = {
      p: anchors._start,
      in: last.out && !same(last.out, last.p) ? last.out : anchors._start,
      out: pts._firstOut || anchors._start,
      kind: "Smooth",
    };
    // rebuild: prepend start if it isn't anchors[0]
    if (!same(anchors[0].p, first.p)) anchors.unshift(first);
  }
  void k;
  return { subpaths: [{ anchors, closed: true }] };
}

export function pathFromAnchors(points, closed, kind = "Corner") {
  const anchors = points.map((p) => ({ p: { ...p }, in: { ...p }, out: { ...p }, kind }));
  return { subpaths: [{ anchors, closed }] };
}

export function ellipsePath(cx, cy, rx, ry) {
  const k = 0.5522847498;
  const a = (x, y, ix, iy, ox, oy) => ({
    p: { x, y }, in: { x: ix, y: iy }, out: { x: ox, y: oy }, kind: "Smooth",
  });
  return {
    subpaths: [{
      closed: true,
      anchors: [
        a(cx + rx, cy, cx + rx, cy - ry * k, cx + rx, cy + ry * k),
        a(cx, cy + ry, cx + rx * k, cy + ry, cx - rx * k, cy + ry),
        a(cx - rx, cy, cx - rx, cy + ry * k, cx - rx, cy - ry * k),
        a(cx, cy - ry, cx - rx * k, cy - ry, cx + rx * k, cy - ry),
      ],
    }],
  };
}

export function polygonPath(cx, cy, r, sides, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + TAU * i / sides;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pathFromAnchors(pts, true);
}

export function starPath(cx, cy, r, points, inner = 0.4, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + Math.PI * i / points;
    const rr = i % 2 ? r * inner : r;
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return pathFromAnchors(pts, true);
}

export function linePath(x0, y0, x1, y1) {
  return pathFromAnchors([{ x: x0, y: y0 }, { x: x1, y: y1 }], false);
}

/** Illustrator-style warp on normalised coords x,y ∈ [-1, 1]. Port of warp_point. */
export function warpPoint(style, b, dh, dv, x, y) {
  const t = (y + 1) / 2;
  const par = 1 - x * x;
  let x2 = x, y2 = y;
  switch (style) {
    case "arc": {
      if (Math.abs(b) < 1e-6) break;
      const sweep = Math.abs(b) * Math.PI;
      const r0 = 2 / sweep;
      const yy = b > 0 ? y : -y;
      const a = x / r0;
      const r = r0 - yy;
      const nx = r * Math.sin(a);
      const ny = r0 - r * Math.cos(a);
      x2 = nx; y2 = b > 0 ? ny : -ny;
      break;
    }
    case "arcLower": y2 = y + b * par * t; break;
    case "arcUpper": y2 = y - b * par * (1 - t); break;
    case "arch": y2 = y - b * par; break;
    case "bulge": y2 = y + b * par * y; break;
    case "shellLower": x2 = x * (1 - 0.5 * b * (1 - t)); y2 = y + b * par * t; break;
    case "shellUpper": x2 = x * (1 - 0.5 * b * t); y2 = y - b * par * (1 - t); break;
    case "flag": y2 = y + 0.5 * b * Math.sin(Math.PI * x); break;
    case "wave":
      x2 = x + 0.1 * b * Math.sin(Math.PI * y);
      y2 = y + 0.3 * b * Math.sin(2 * Math.PI * x) * (0.5 + 0.5 * t);
      break;
    case "fish": y2 = y * (1 + 0.5 * b * Math.sin(0.75 * Math.PI * (x + 1))); break;
    case "rise": y2 = y - b * ((x + 1) / 2) ** 2 * 2 + b; break;
    case "fisheye": {
      const r2 = x * x + y * y;
      const s = r2 < 1 ? 1 + 0.5 * b * (1 - r2) : 1;
      x2 = x * s; y2 = y * s;
      break;
    }
    case "inflate":
      x2 = x * (1 + 0.5 * b * (1 - y * y));
      y2 = y * (1 + 0.5 * b * par);
      break;
    case "squeeze":
      x2 = x * (1 - 0.5 * b * (1 - y * y));
      y2 = y * (1 + 0.3 * b * par);
      break;
    case "twist": {
      const r = Math.hypot(x, y);
      const a = -b * Math.PI * 0.5 * Math.max(0, 1 - r / Math.SQRT2);
      const co = Math.cos(a), si = Math.sin(a);
      x2 = x * co - y * si; y2 = x * si + y * co;
      break;
    }
    default: break;
  }
  if (dh) y2 *= Math.max(0, 1 + dh * x2 * 0.5);
  if (dv) x2 *= Math.max(0, 1 + dv * y2 * 0.5);
  return { x: x2, y: y2 };
}

/** Map a document point through an envelope warp whose content bounds are `src`. */
export function warpDocPoint(p, src, style, bend, dh, dv, horizontal) {
  const w = Math.max(1e-6, src.x1 - src.x0);
  const h = Math.max(1e-6, src.y1 - src.y0);
  const u = (p.x - src.x0) / w;
  const v = (p.y - src.y0) / h;
  const x = 2 * u - 1, y = 2 * v - 1;
  const b = clamp(bend, -100, 100) / 100;
  const hx = clamp(dh, -100, 100) / 100;
  const vy = clamp(dv, -100, 100) / 100;
  let q;
  if (horizontal) q = warpPoint(style, b, hx, vy, x, y);
  else { const t = warpPoint(style, b, hx, vy, y, x); q = { x: t.y, y: t.x }; }
  return { x: (src.x0 + src.x1) / 2 + q.x * w / 2, y: (src.y0 + src.y1) / 2 + q.y * h / 2 };
}

export function mapPath(path, fn, tol = 8) {
  const out = { subpaths: [] };
  for (const sp of path.subpaths || []) {
    const flat = flattenPath({ subpaths: [sp] }, Math.max(0.4, tol / 4))[0];
    if (!flat) continue;
    const anchors = flat.pts.map((p) => {
      const q = fn(p);
      return { p: q, in: { ...q }, out: { ...q }, kind: "Corner" };
    });
    // drop duplicate close
    if (sp.closed && anchors.length > 1 && same(anchors[0].p, anchors[anchors.length - 1].p)) anchors.pop();
    out.subpaths.push({ anchors, closed: sp.closed });
  }
  return out;
}

/** Coons patch evaluation. handles: [right, left, down, up] offsets. points row-major (rows+1)*(cols+1). */
export function meshPoint(points, handles, rows, cols, r, c) {
  const i = r * (cols + 1) + c;
  return { p: points[i].p, color: points[i].color, opacity: points[i].opacity ?? 1, h: handles ? handles[i] : points[i].handles };
}
function bez(p0, p1, p2, p3, t) { return cubic(p0, p1, p2, p3, t); }
export function meshEval(points, rows, cols, r, c, u, v) {
  const A = meshPoint(points, null, rows, cols, r, c);
  const B = meshPoint(points, null, rows, cols, r, c + 1);
  const C = meshPoint(points, null, rows, cols, r + 1, c);
  const D = meshPoint(points, null, rows, cols, r + 1, c + 1);
  const h = (pt, i) => pt.h?.[i] || { x: 0, y: 0 };
  const top = bez(A.p, add(A.p, h(A, 0)), add(B.p, h(B, 1)), B.p, u);
  const bot = bez(C.p, add(C.p, h(C, 0)), add(D.p, h(D, 1)), D.p, u);
  const left = bez(A.p, add(A.p, h(A, 2)), add(C.p, h(C, 3)), C.p, v);
  const right = bez(B.p, add(B.p, h(B, 2)), add(D.p, h(D, 3)), D.p, v);
  const p00 = A.p, p10 = B.p, p01 = C.p, p11 = D.p;
  return {
    x: (1 - v) * top.x + v * bot.x + (1 - u) * left.x + u * right.x
      - ((1 - u) * (1 - v) * p00.x + u * (1 - v) * p10.x + (1 - u) * v * p01.x + u * v * p11.x),
    y: (1 - v) * top.y + v * bot.y + (1 - u) * left.y + u * right.y
      - ((1 - u) * (1 - v) * p00.y + u * (1 - v) * p10.y + (1 - u) * v * p01.y + u * v * p11.y),
  };
}
export function meshColor(points, rows, cols, r, c, u, v) {
  const q = [
    meshPoint(points, null, rows, cols, r, c),
    meshPoint(points, null, rows, cols, r, c + 1),
    meshPoint(points, null, rows, cols, r + 1, c),
    meshPoint(points, null, rows, cols, r + 1, c + 1),
  ];
  const w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
  const rgb = { r: 0, g: 0, b: 0 };
  let op = 0;
  for (let k = 0; k < 4; k++) {
    const col = toRgb(q[k].color);
    rgb.r += col.r * w[k]; rgb.g += col.g * w[k]; rgb.b += col.b * w[k];
    op += (q[k].opacity ?? 1) * w[k];
  }
  return { color: { model: "rgb", ...rgb }, opacity: op };
}

/** Offset a closed polyline outward (y-down, positive grows the shape if CCW... we use vertex normals). */
export function offsetRing(pts, delta) {
  if (pts.length < 3 || Math.abs(delta) < 1e-6) return pts.map((p) => ({ ...p }));
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const e0 = norm(sub(cur, prev)), e1 = norm(sub(next, cur));
    const n0 = { x: -e0.y, y: e0.x }, n1 = { x: -e1.y, y: e1.x };
    let nx = n0.x + n1.x, ny = n0.y + n1.y;
    const l = Math.hypot(nx, ny);
    if (l < 1e-6) { nx = n0.x; ny = n0.y; }
    else { nx /= l; ny /= l; }
    const s = dot({ x: nx, y: ny }, n0) || 1;
    const m = delta / s;
    const lim = Math.abs(delta) * 4;
    const mm = clamp(m, -lim, lim);
    out.push({ x: cur.x + nx * mm, y: cur.y + ny * mm });
  }
  return out;
}

export function ringToPath(pts, closed = true) {
  return pathFromAnchors(pts, closed);
}

/** Ramer–Douglas–Peucker. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(pts[i], pts[a], pts[b]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0 && max > tol) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]).map((p) => ({ ...p }));
}
