/** Perspective grid: the same homography the desktop editor uses to draw planes. */

const PLANES = ["left", "right", "ground"];
const PLANE_RGB = { left: "#3366ff", right: "#ff8c1a", ground: "#2eb84a", none: "#999999" };

export function readGrid(file) {
  return file?.document?.unknown?.perspectiveGrid || null;
}

export function planeColor(plane) {
  return PLANE_RGB[plane] || "#999999";
}

function num(v, fallback) {
  return Number.isFinite(+v) ? +v : fallback;
}

function colorOf(v, fallback) {
  return typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v.trim()) ? (v.trim().startsWith("#") ? v.trim() : "#" + v.trim()) : fallback;
}

export function gridView(raw) {
  if (!raw) return null;
  const kind = Math.min(3, Math.max(1, raw.kind || 2));
  return {
    raw,
    kind,
    origin: [num(raw.origin?.[0], 0), num(raw.origin?.[1], 0)],
    horizon: num(raw.horizon, 0),
    vpLeft: num(raw.vpLeft, 0),
    vpRight: num(raw.vpRight, 0),
    vpVertical: [num(raw.vpVertical?.[0], 0), num(raw.vpVertical?.[1], 0)],
    distance: Math.max(1e-9, num(raw.distance, 1)),
    cell: Math.max(1e-9, num(raw.cell, 10)),
    extent: Math.max(1e-9, num(raw.extent, 100)),
    height: Math.max(1e-9, num(raw.height, 100)),
    extentRight: raw.extentRight == null ? null : num(raw.extentRight, raw.extent || 100),
    visible: raw.visible !== false,
    plane: raw.plane || "left",
    angle: raw.angle == null ? null : num(raw.angle, 45),
    leftColor: colorOf(raw.leftColor, PLANE_RGB.left),
    rightColor: colorOf(raw.rightColor, PLANE_RGB.right),
    groundColor: colorOf(raw.groundColor, PLANE_RGB.ground),
    opacity: num(raw.opacity, 50),
    leftOffset: num(raw.leftOffset, 0),
    rightOffset: num(raw.rightOffset, 0),
    groundOffset: num(raw.groundOffset, 0),
    locked: !!raw.locked,
    lockStation: !!raw.lockStation,
  };
}

function rightExtent(g) {
  return g.extentRight == null ? g.extent : g.extentRight;
}

function offsetOf(g, plane) {
  if (plane === "left") return g.leftOffset;
  if (plane === "right") return g.rightOffset;
  if (plane === "ground") return g.groundOffset;
  return 0;
}

export function station(g) {
  const w = g.vpRight - g.vpLeft;
  if (g.kind === 1) return { x: g.vpLeft, distance: g.distance };
  if (g.angle != null && w > 0) {
    const a = g.angle * Math.PI / 180;
    const s = Math.sin(a), c = Math.cos(a);
    return { x: g.vpLeft + w * c * c, distance: w * s * c };
  }
  return { x: (g.vpLeft + g.vpRight) / 2, distance: Math.abs(w) > 1e-9 ? Math.abs(w) / 2 : g.distance };
}

function foreshortening(g) {
  const uniform = 1 / Math.max(1e-9, g.distance);
  if (g.kind === 1 || g.angle == null || g.vpRight <= g.vpLeft) return [uniform, uniform, uniform];
  const st = station(g);
  const to = (x, y) => 1 / Math.max(1e-9, Math.hypot(st.distance, x - st.x, y - g.horizon));
  return [to(g.vpLeft, g.horizon), to(g.vpRight, g.horizon), to(g.vpVertical[0], g.vpVertical[1])];
}

function axisCol(g, axis) {
  const [ll, lr, lu] = foreshortening(g);
  if (axis === "x") return g.kind === 1 ? [1, 0, 0] : [g.vpRight * lr, g.horizon * lr, lr];
  if (axis === "y") return g.kind === 3 ? [g.vpVertical[0] * lu, g.vpVertical[1] * lu, lu] : [0, -1, 0];
  return [g.vpLeft * ll, g.horizon * ll, ll];
}

function axes(g, plane) {
  if (plane === "none") return null;
  if (g.kind === 1 && plane === "left") return ["x", "y", "z"];
  if (g.kind === 1 && plane === "right") return ["z", "y", "x"];
  if (plane === "left") return ["z", "y", "x"];
  if (plane === "right") return ["x", "y", "z"];
  if (plane === "ground") return ["x", "z", "y"];
  return null;
}

function fromCols(c1, c2, c3) {
  return [
    [c1[0], c2[0], c3[0]],
    [c1[1], c2[1], c3[1]],
    [c1[2], c2[2], c3[2]],
  ];
}

function det(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

export function applyH(m, p) {
  if (!m || !p) return null;
  const x = m[0][0] * p.x + m[0][1] * p.y + m[0][2];
  const y = m[1][0] * p.x + m[1][1] * p.y + m[1][2];
  const w = m[2][0] * p.x + m[2][1] * p.y + m[2][2];
  if (w <= 1e-9 || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: x / w, y: y / w };
}

function inverseH(m) {
  if (!m) return null;
  const d = det(m);
  if (Math.abs(d) < 1e-15 || !Number.isFinite(d)) return null;
  const c = (r0, c0, r1, c1) => m[r0][c0] * m[r1][c1] - m[r0][c1] * m[r1][c0];
  const adj = [
    [c(1, 1, 2, 2), -c(0, 1, 2, 2), c(0, 1, 1, 2)],
    [-c(1, 0, 2, 2), c(0, 0, 2, 2), -c(0, 0, 1, 2)],
    [c(1, 0, 2, 1), -c(0, 0, 2, 1), c(0, 0, 1, 1)],
  ];
  return adj.map((row) => row.map((v) => v / d));
}

function frameHomography(g, u, v, axis, at) {
  if (!Number.isFinite(at)) return null;
  const c = axisCol(g, axis);
  const o = [g.origin[0] + at * c[0], g.origin[1] + at * c[1], 1 + at * c[2]];
  if (o[2] <= 1e-9) return null;
  const h = fromCols(axisCol(g, u), axisCol(g, v), o);
  return Math.abs(det(h)) > 1e-15 ? h : null;
}

export function homographyAt(g, plane, depth) {
  const ax = axes(g, plane);
  if (!ax) return null;
  return frameHomography(g, ax[0], ax[1], ax[2], depth);
}

export function homography(g, plane) {
  return homographyAt(g, plane, offsetOf(g, plane));
}

function domain(g, plane) {
  if (plane === "ground" && g.kind === 1) return { x0: 0, y0: 0, x1: g.extent, y1: rightExtent(g) };
  if (plane === "ground") return { x0: 0, y0: 0, x1: rightExtent(g), y1: g.extent };
  if (plane === "right") return { x0: 0, y0: 0, x1: rightExtent(g), y1: g.height };
  return { x0: 0, y0: 0, x1: g.extent, y1: g.height };
}

function stepFor(cell, len) {
  let s = cell;
  while (len / s > 120) s *= 2;
  return s;
}

export function planeLines(g, plane) {
  const h = homography(g, plane);
  if (!h) return [];
  const d = domain(g, plane);
  const su = stepFor(g.cell, d.x1 - d.x0);
  const sv = stepFor(g.cell, d.y1 - d.y0);
  const out = [];
  for (let u = 0; u <= d.x1 - d.x0 + 1e-9; u += su) {
    const a = applyH(h, { x: u, y: 0 });
    const b = applyH(h, { x: u, y: d.y1 - d.y0 });
    if (a && b) out.push([a, b]);
  }
  for (let v = 0; v <= d.y1 - d.y0 + 1e-9; v += sv) {
    const a = applyH(h, { x: 0, y: v });
    const b = applyH(h, { x: d.x1 - d.x0, y: v });
    if (a && b) out.push([a, b]);
  }
  return out;
}

function lineColor(g, plane) {
  if (plane === "left") return g.leftColor;
  if (plane === "right") return g.rightColor;
  if (plane === "ground") return g.groundColor;
  return planeColor(plane);
}

export function gridOverlay(raw) {
  const g = gridView(raw);
  if (!g || !g.visible) return null;
  const planes = PLANES.map((plane) => {
    const d = domain(g, plane);
    const h = homography(g, plane);
    const corners = h ? [[d.x0, d.y0], [d.x1, d.y0], [d.x1, d.y1], [d.x0, d.y1]].map(([x, y]) => applyH(h, { x, y })) : [];
    return {
      plane,
      color: lineColor(g, plane),
      ink: planeColor(plane),
      opacity: Math.min(1, Math.max(0, g.opacity / 100)),
      lines: planeLines(g, plane),
      outline: g.plane === plane && corners.length === 4 && corners.every(Boolean) ? corners : null,
    };
  });
  const xs = [g.vpLeft, g.vpRight, g.origin[0]];
  return {
    planes,
    horizonY: g.horizon,
    horizonX0: Math.min(...xs),
    horizonX1: Math.max(...xs),
    diamonds: planeWidgets(g),
    active: g.plane,
  };
}

export function planeWidgets(g) {
  const e = g.extent / 2;
  return PLANES.map((plane) => {
    const q = plane === "ground" ? { x: e, y: e } : { x: e, y: 0 };
    const p = applyH(homography(g, plane), q);
    return p ? { plane, p } : null;
  }).filter(Boolean);
}

export function project(raw, plane, u, v) {
  const g = gridView(raw);
  return applyH(homography(g, plane), { x: u, y: v });
}

export function pagePoint(raw, plane, depth, u, v) {
  const g = gridView(raw);
  return applyH(homographyAt(g, plane, depth || 0), { x: u, y: v });
}

export function unproject(raw, plane, p) {
  const g = gridView(raw);
  return applyH(inverseH(homography(g, plane)), p);
}

export function widgetGeom(width, height, corner = "topLeft") {
  const SIZE = 40, MARGIN = 10;
  const right = corner === "topRight" || corner === "bottomRight";
  const bottom = corner === "bottomLeft" || corner === "bottomRight";
  const inset = MARGIN + SIZE / 2;
  const cx = right ? width - inset : inset;
  const cy = bottom ? height - inset : inset;
  const p = (dx, dy) => ({ x: cx + dx * SIZE, y: cy + dy * SIZE });
  return {
    faces: [
      { plane: "left", quad: [p(-0.5, -0.25), p(0, 0), p(0, 0.5), p(-0.5, 0.25)] },
      { plane: "right", quad: [p(0, 0), p(0.5, -0.25), p(0.5, 0.25), p(0, 0.5)] },
      { plane: "ground", quad: [p(0, -0.5), p(0.5, -0.25), p(0, 0), p(-0.5, -0.25)] },
    ],
    dot: { c: p(right ? -0.62 : 0.62, bottom ? -0.62 : 0.62), r: 0.12 * SIZE },
  };
}

function inQuad(q, p) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-9) continue;
    const s = Math.sign(c);
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function widgetHit(x, y, width, height, corner) {
  const w = widgetGeom(width, height, corner);
  const p = { x, y };
  if (Math.hypot(p.x - w.dot.c.x, p.y - w.dot.c.y) <= w.dot.r * 1.5) return "none";
  return w.faces.find((f) => inQuad(f.quad, p))?.plane || null;
}

export function cellSteps(raw, tol) {
  const g = gridView(raw);
  return Math.min(1e6, Math.max(1, Math.ceil(24 * tol / g.cell)));
}

export function gridHandles(raw, tol) {
  const g = gridView(raw);
  if (!g) return [];
  const o = { x: g.origin[0], y: g.origin[1] };
  const v = [{ id: "vpLeft", p: { x: g.vpLeft, y: g.horizon } }];
  if (g.kind !== 1) v.push({ id: "vpRight", p: { x: g.vpRight, y: g.horizon } });
  if (g.kind === 3) v.push({ id: "vpVertical", p: { x: g.vpVertical[0], y: g.vpVertical[1] } });
  v.push({ id: "origin", p: o });
  const at = (id, plane, q) => {
    const p = applyH(homography(g, plane), q);
    if (p) v.push({ id, p });
  };
  at("extentLeft", "left", { x: g.extent, y: 0 });
  at("extentRight", "right", { x: rightExtent(g), y: 0 });
  at("height", "left", { x: 0, y: g.height });
  const steps = cellSteps(raw, tol);
  at("cell", "left", { x: 0, y: g.cell * steps });
  for (const [id, plane] of [["groundLeft", "left"], ["groundRight", "right"]]) {
    const p = applyH(homography(g, plane), { x: g.cell, y: 0 });
    if (p && Math.hypot(p.x - o.x, p.y - o.y) > 1e-9) {
      const len = Math.hypot(p.x - o.x, p.y - o.y) || 1;
      v.push({ id, p: { x: o.x + (p.x - o.x) / len * (24 * tol), y: o.y + (p.y - o.y) / len * (24 * tol) } });
    }
  }
  v.push({ id: "horizon", p: { x: g.origin[0], y: g.horizon } });
  v.forEach((h) => { h.steps = steps; });
  return v;
}

function setStation(n, st, angle) {
  n.distance = st.distance;
  n.angle = angle;
  if (n.kind === 1) n.vpLeft = st.x;
  else {
    const t = Math.tan(angle * Math.PI / 180);
    n.vpLeft = st.x - st.distance / t;
    n.vpRight = st.x + st.distance * t;
  }
}

function swing(n, left, x) {
  const st = station(gridView(n));
  const off = left ? st.x - x : x - st.x;
  if (off <= 1e-6 || st.distance <= 0) return;
  const a = Math.atan2(off, st.distance) * 180 / Math.PI;
  setStation(n, st, left ? 90 - a : a);
}

function valid(raw) {
  const g = gridView(raw);
  if (!g) return false;
  const nums = [g.origin[0], g.origin[1], g.horizon, g.vpLeft, g.vpRight, g.vpVertical[0], g.vpVertical[1], g.distance, g.cell, g.extent, g.height];
  if (nums.some((v) => !Number.isFinite(v) || Math.abs(v) > 4e6)) return false;
  if (g.distance <= 0 || g.cell <= 0 || g.extent <= 0 || g.height <= 0) return false;
  if (Math.abs(g.origin[1] - g.horizon) < 1e-6) return false;
  if (g.angle != null && !(g.angle > 0 && g.angle < 90)) return false;
  if (g.kind !== 1 && g.angle != null && g.vpRight <= g.vpLeft) return false;
  return true;
}

/** Grid after dragging `handle` from the press snapshot to `p`. Returns a new object, or null. */
export function dragHandle(snapshot, handle, p, mods, steps) {
  const n = structuredClone(snapshot);
  const g = gridView(snapshot);
  const cells = (v) => mods.shift ? Math.max(1, Math.round(v / g.cell)) * g.cell : Math.max(g.cell, v);
  if (handle === "vpLeft" || handle === "vpRight") {
    if (!mods.shift) n.horizon = p.y;
    if (g.lockStation && g.kind !== 1) swing(n, handle === "vpLeft", p.x);
    else if (handle === "vpLeft") n.vpLeft = p.x;
    else n.vpRight = p.x;
  } else if (handle === "vpVertical") n.vpVertical = [p.x, p.y];
  else if (handle === "horizon") n.horizon = p.y;
  else if (handle === "origin") {
    const d = { x: p.x - mods.from.x, y: p.y - mods.from.y };
    const a = mods.shift ? (Math.abs(d.x) >= Math.abs(d.y) ? { x: d.x, y: 0 } : { x: 0, y: d.y }) : d;
    n.origin = [g.origin[0] + a.x, g.origin[1] + a.y];
  } else if (handle === "groundLeft" || handle === "groundRight") {
    const d = { x: p.x - mods.from.x, y: p.y - mods.from.y };
    const a = mods.shift ? (Math.abs(d.x) >= Math.abs(d.y) ? { x: d.x, y: 0 } : { x: 0, y: d.y }) : d;
    n.origin = [g.origin[0] + a.x, g.origin[1] + a.y];
    n.horizon = g.horizon + a.y;
    n.vpLeft = g.vpLeft + a.x;
    n.vpRight = g.vpRight + a.x;
    n.vpVertical = [g.vpVertical[0] + a.x, g.vpVertical[1] + a.y];
  } else if (handle === "extentLeft" || handle === "extentRight") {
    const plane = handle === "extentRight" ? "right" : "left";
    const q = applyH(inverseH(homography(g, plane)), p);
    if (q) {
      const e = cells(q.x);
      if (handle === "extentLeft" || mods.alt) n.extent = e;
      if (handle === "extentRight" || mods.alt) n.extentRight = e;
    }
  } else if (handle === "height") {
    const q = applyH(inverseH(homography(g, "left")), p);
    if (q) n.height = cells(q.y);
  } else if (handle === "cell") {
    const q = applyH(inverseH(homography(g, "left")), p);
    if (q) n.cell = Math.max(0.5, q.y / (steps || 1));
  }
  return valid(n) ? n : null;
}

export function depthAt(raw, plane, depth, from, to) {
  const g = gridView(raw);
  const ax = axes(g, plane);
  if (!ax) return null;
  const hi = inverseH(homographyAt(g, plane, depth));
  const q = applyH(hi, from);
  if (!q) return null;
  const ci = inverseH(frameHomography(g, ax[2], ax[1], ax[0], q.x));
  const a = applyH(ci, to), b = applyH(ci, from);
  if (!a || !b) return null;
  const d = depth + (a.x - b.x);
  return Number.isFinite(d) && Math.abs(d) <= 1e6 ? d : null;
}

export function setOffset(raw, plane, offset) {
  if (plane === "left") raw.leftOffset = offset;
  else if (plane === "right") raw.rightOffset = offset;
  else if (plane === "ground") raw.groundOffset = offset;
}

export function moveMap(raw, plane, from, to) {
  const g = gridView(raw);
  const h = homography(g, plane);
  const hi = inverseH(h);
  const a = applyH(hi, from), b = applyH(hi, to);
  if (!h || !a || !b) return null;
  const d = { x: b.x - a.x, y: b.y - a.y };
  return (p) => applyH(h, { x: (applyH(hi, p)?.x ?? p.x) + d.x, y: (applyH(hi, p)?.y ?? p.y) + d.y });
}

export function defaultGrid(rect) {
  const x0 = rect?.x0 || 0, y0 = rect?.y0 || 0;
  const w = Math.max(1, (rect?.x1 ?? 612) - x0), h = Math.max(1, (rect?.y1 ?? 792) - y0);
  const horizon = y0 + 0.42 * h;
  const ground = y0 + 0.78 * h;
  const ox = x0 + 0.5 * w;
  const vl = x0 + 0.02 * w, vr = x0 + 0.98 * w;
  const st = { x: (vl + vr) / 2, distance: Math.abs(vr - vl) / 2 };
  return {
    kind: 2,
    name: "[2P-Normal View]",
    origin: [ox, ground],
    horizon,
    vpLeft: st.x - st.distance,
    vpRight: st.x + st.distance,
    vpVertical: [ox, horizon - 3 * (ground - horizon)],
    distance: st.distance,
    cell: Math.max(1, Math.round(w / 30)),
    extent: 0.6 * w,
    height: (ground - y0) * 0.8,
    visible: true,
    plane: "left",
    angle: 45,
    leftColor: "#3366ff",
    rightColor: "#ff8c1a",
    groundColor: "#2eb84a",
    opacity: 50,
    snap: true,
  };
}

export function walkPoints(node, fn) {
  const k = node?.kind;
  if (!k) return;
  if (k.type === "path" && k.path) {
    for (const sp of k.path.subpaths || []) {
      for (const a of sp.anchors || []) {
        if (a.p) a.p = fn(a.p) || a.p;
        if (a.in) a.in = fn(a.in) || a.in;
        if (a.out) a.out = fn(a.out) || a.out;
      }
    }
  } else if (k.type === "text") {
    const xf = k.xf || [1, 0, 0, 1, 0, 0];
    const o = fn({ x: xf[4], y: xf[5] });
    if (o) k.xf = [xf[0], xf[1], xf[2], xf[3], o.x, o.y];
  } else if (k.type === "mesh") {
    for (const pt of k.points || []) if (pt.p) pt.p = fn(pt.p) || pt.p;
  } else {
    const kids = k.children || k.source || k.content || [];
    for (const c of kids) walkPoints(c, fn);
  }
}

export function planeBounds(raw, node, plane, depth = 0) {
  const g = gridView(raw);
  const hi = inverseH(homographyAt(g, plane, depth));
  if (!hi) return null;
  let box = null;
  const consider = (p) => {
    const q = applyH(hi, p);
    if (!q) return;
    if (!box) box = { x0: q.x, y0: q.y, x1: q.x, y1: q.y };
    else {
      box.x0 = Math.min(box.x0, q.x); box.y0 = Math.min(box.y0, q.y);
      box.x1 = Math.max(box.x1, q.x); box.y1 = Math.max(box.y1, q.y);
    }
  };
  const look = (n) => {
    const k = n?.kind;
    if (!k) return;
    if (k.type === "path" && k.path) {
      for (const sp of k.path.subpaths || []) for (const a of sp.anchors || []) if (a.p) consider(a.p);
    } else if (k.type === "text" && k.xf) consider({ x: k.xf[4], y: k.xf[5] });
    else for (const c of k.children || k.source || k.content || []) look(c);
  };
  look(node);
  return box;
}
