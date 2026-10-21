/** Gradient meshes from a path outline, matching `GradientMesh::for_path`.

The outline is split at the points nearest its bounding-box corners and turned into a Coons
patch. Mesh points sit on that surface; handles come from its partial derivatives. */

import { flattenPath, hitFill, lerp, lerpColor, meshColor, meshEval, pathBounds } from "./geom.js";

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

/** Point and line edits, matching `object.mesh.movePoint`, `addLine` and `deletePoint`.
Handles are offsets from the point, in order right, left, down, up. */

const H_RIGHT = 0, H_LEFT = 1, H_DOWN = 2, H_UP = 3;

function meshOk(mesh) {
  const rows = mesh?.rows | 0, cols = mesh?.cols | 0;
  return rows >= 1 && cols >= 1 && (mesh.points || []).length === (rows + 1) * (cols + 1);
}

function handlesOf(pt) {
  if (!pt.handles || pt.handles.length < 4) {
    pt.handles = [0, 1, 2, 3].map((i) => ({ x: pt.handles?.[i]?.x || 0, y: pt.handles?.[i]?.y || 0 }));
  }
  return pt.handles;
}

function hoff(pt, i) {
  return pt?.handles?.[i] || { x: 0, y: 0 };
}

function vadd(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function vsub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function vmul(a, s) { return { x: a.x * s, y: a.y * s }; }

function ptAt(mesh, r, c) {
  return mesh.points[r * ((mesh.cols | 0) + 1) + c];
}

function edgeU(mesh, r, c) {
  const a = ptAt(mesh, r, c), b = ptAt(mesh, r, c + 1);
  return [a.p, vadd(a.p, hoff(a, H_RIGHT)), vadd(b.p, hoff(b, H_LEFT)), b.p];
}

function edgeV(mesh, r, c) {
  const a = ptAt(mesh, r, c), b = ptAt(mesh, r + 1, c);
  return [a.p, vadd(a.p, hoff(a, H_DOWN)), vadd(b.p, hoff(b, H_UP)), b.p];
}

function splitCubic(p0, p1, p2, p3, t) {
  const L = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  const a = L(p0, p1, t), b = L(p1, p2, t), c = L(p2, p3, t);
  const d = L(a, b, t), e = L(b, c, t), f = L(d, e, t);
  return { left: [p0, a, d, f], right: [f, e, c, p3] };
}

function surfaceDu(mesh, r, c, u, v) {
  const e = 1e-3;
  const a = Math.max(0, u - e), b = Math.min(1, u + e);
  const pa = meshEval(mesh.points, mesh.rows, mesh.cols, r, c, a, v);
  const pb = meshEval(mesh.points, mesh.rows, mesh.cols, r, c, b, v);
  const du = b - a || 1;
  return { x: (pb.x - pa.x) / du, y: (pb.y - pa.y) / du };
}

function surfaceDv(mesh, r, c, u, v) {
  const e = 1e-3;
  const a = Math.max(0, v - e), b = Math.min(1, v + e);
  const pa = meshEval(mesh.points, mesh.rows, mesh.cols, r, c, u, a);
  const pb = meshEval(mesh.points, mesh.rows, mesh.cols, r, c, u, b);
  const dv = b - a || 1;
  return { x: (pb.x - pa.x) / dv, y: (pb.y - pa.y) / dv };
}

function clonePoint(p) {
  return {
    p: { x: p.p.x, y: p.p.y },
    color: p.color ? { ...p.color } : { model: "rgb", r: 1, g: 1, b: 1 },
    opacity: p.opacity ?? 1,
    handles: handlesOf(p).map((h) => ({ x: h.x, y: h.y })),
  };
}

function anchorFrom(p, inn, out) {
  return { p: { ...p }, in: { ...inn }, out: { ...out }, kind: "Smooth" };
}

/** Row and column edges as open cubics, for the selection outline. */
export function meshLinesPath(mesh) {
  if (!meshOk(mesh)) return { subpaths: [] };
  const rows = mesh.rows | 0, cols = mesh.cols | 0;
  const subpaths = [];
  const push = (e) => {
    subpaths.push({
      closed: false,
      anchors: [anchorFrom(e[0], e[0], e[1]), anchorFrom(e[3], e[2], e[3])],
    });
  };
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) push(edgeU(mesh, r, c));
  for (let c = 0; c <= cols; c++) for (let r = 0; r < rows; r++) push(edgeV(mesh, r, c));
  return { subpaths };
}

/** Closed outer boundary, for hit-testing a click inside the mesh. */
export function meshOutlinePath(mesh) {
  if (!meshOk(mesh)) return { subpaths: [] };
  const rows = mesh.rows | 0, cols = mesh.cols | 0;
  const segs = [];
  for (let c = 0; c < cols; c++) segs.push(edgeU(mesh, 0, c));
  for (let r = 0; r < rows; r++) segs.push(edgeV(mesh, r, cols));
  for (let c = cols - 1; c >= 0; c--) {
    const e = edgeU(mesh, rows, c);
    segs.push([e[3], e[2], e[1], e[0]]);
  }
  for (let r = rows - 1; r >= 0; r--) {
    const e = edgeV(mesh, r, 0);
    segs.push([e[3], e[2], e[1], e[0]]);
  }
  const anchors = segs.map((s, i) => {
    const prev = segs[(i + segs.length - 1) % segs.length];
    return anchorFrom(s[0], prev[2], s[1]);
  });
  return { subpaths: [{ anchors, closed: true }] };
}

/** Index of the mesh point within `tol` of `p`. */
export function pointNear(mesh, p, tol) {
  let best = Infinity, idx = -1;
  const pts = mesh?.points || [];
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i].p.x - p.x, pts[i].p.y - p.y);
    if (d <= tol && d < best) { best = d; idx = i; }
  }
  return idx < 0 ? null : idx;
}

/** Move a point, or place handle `handle` (0 right, 1 left, 2 down, 3 up) at (x, y). */
export function moveMeshPoint(mesh, index, x, y, handle) {
  const pt = mesh?.points?.[index];
  if (!pt) return false;
  if (handle == null) pt.p = { x, y };
  else handlesOf(pt)[handle] = { x: x - pt.p.x, y: y - pt.p.y };
  return true;
}

/** Patch and local (u, v) containing `p`, or null outside the outline. */
export function locateMesh(mesh, p) {
  if (!meshOk(mesh) || !p || !hitFill(meshOutlinePath(mesh), p)) return null;
  const rows = mesh.rows | 0, cols = mesh.cols | 0;
  const N = 16;
  let best = Infinity, br = 0, bc = 0, bu = 0, bv = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          const u = i / N, v = j / N;
          const q = meshEval(mesh.points, rows, cols, r, c, u, v);
          const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
          if (d < best) { best = d; br = r; bc = c; bu = u; bv = v; }
        }
      }
    }
  }
  let u = bu, v = bv, step = 0.5 / N;
  for (let k = 0; k < 12; k++) {
    let improved = false;
    const cur = meshEval(mesh.points, rows, cols, br, bc, u, v);
    let curd = (cur.x - p.x) ** 2 + (cur.y - p.y) ** 2;
    for (const [du, dv] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const nu = Math.max(0, Math.min(1, u + du));
      const nv = Math.max(0, Math.min(1, v + dv));
      const q = meshEval(mesh.points, rows, cols, br, bc, nu, nv);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < curd) { u = nu; v = nv; curd = d; improved = true; }
    }
    if (!improved) step /= 2;
  }
  return { r: br, c: bc, u, v };
}

export function insertMeshRow(mesh, r, v) {
  if (!meshOk(mesh) || r < 0 || r >= mesh.rows) return;
  const cols = mesh.cols | 0;
  v = Math.max(0.01, Math.min(0.99, v));
  const row = [];
  const ups = [];
  for (let c = 0; c <= cols; c++) {
    const e = edgeV(mesh, r, c);
    const { left, right } = splitCubic(e[0], e[1], e[2], e[3], v);
    ups.push([vsub(left[1], left[0]), vsub(right[2], right[3])]);
    const pc = Math.min(c, cols - 1);
    const u = c === cols ? 1 : 0;
    const painted = meshColor(mesh.points, mesh.rows, mesh.cols, r, pc, u, v);
    const rightH = c < cols ? vmul(surfaceDu(mesh, r, c, 0, v), 1 / 3) : { x: 0, y: 0 };
    const leftH = c > 0 ? vmul(surfaceDu(mesh, r, c - 1, 1, v), -1 / 3) : { x: 0, y: 0 };
    row.push({
      p: { ...left[3] },
      color: painted.color,
      opacity: painted.opacity,
      handles: [rightH, leftH, vsub(right[1], right[0]), vsub(left[2], left[3])],
    });
  }
  for (let c = 0; c <= cols; c++) {
    handlesOf(mesh.points[r * (cols + 1) + c])[H_DOWN] = ups[c][0];
    handlesOf(mesh.points[(r + 1) * (cols + 1) + c])[H_UP] = ups[c][1];
  }
  mesh.points.splice((r + 1) * (cols + 1), 0, ...row);
  mesh.rows += 1;
}

export function insertMeshCol(mesh, c, u) {
  if (!meshOk(mesh) || c < 0 || c >= mesh.cols) return;
  const rows = mesh.rows | 0, cols = mesh.cols | 0;
  u = Math.max(0.01, Math.min(0.99, u));
  const col = [];
  for (let r = 0; r <= rows; r++) {
    const e = edgeU(mesh, r, c);
    const { left, right } = splitCubic(e[0], e[1], e[2], e[3], u);
    const pr = Math.min(r, rows - 1);
    const v = r === rows ? 1 : 0;
    const painted = meshColor(mesh.points, rows, cols, pr, c, u, v);
    const down = r < rows ? vmul(surfaceDv(mesh, r, c, u, 0), 1 / 3) : { x: 0, y: 0 };
    const up = r > 0 ? vmul(surfaceDv(mesh, r - 1, c, u, 1), -1 / 3) : { x: 0, y: 0 };
    col.push({
      mp: {
        p: { ...left[3] },
        color: painted.color,
        opacity: painted.opacity,
        handles: [vsub(right[1], right[0]), vsub(left[2], left[3]), down, up],
      },
      right: vsub(left[1], left[0]),
      left: vsub(right[2], right[3]),
    });
  }
  const pts = [];
  for (let r = 0; r <= rows; r++) {
    for (let cc = 0; cc <= cols; cc++) {
      const q = clonePoint(mesh.points[r * (cols + 1) + cc]);
      if (cc === c) q.handles[H_RIGHT] = { ...col[r].right };
      if (cc === c + 1) q.handles[H_LEFT] = { ...col[r].left };
      pts.push(q);
      if (cc === c) pts.push(clonePoint(col[r].mp));
    }
  }
  mesh.points = pts;
  mesh.cols += 1;
}

/** Add a row and a column through `p`. Returns the new (or existing) point index. */
export function addLinesAt(mesh, p) {
  const loc = locateMesh(mesh, p);
  if (!loc) return null;
  let rr = loc.r, cc = loc.c;
  if (loc.v > 0.02 && loc.v < 0.98) { insertMeshRow(mesh, loc.r, loc.v); rr = loc.r + 1; }
  else if (loc.v >= 0.98) rr = loc.r + 1;
  if (loc.u > 0.02 && loc.u < 0.98) { insertMeshCol(mesh, loc.c, loc.u); cc = loc.c + 1; }
  else if (loc.u >= 0.98) cc = loc.c + 1;
  return rr * ((mesh.cols | 0) + 1) + cc;
}

/** Delete the interior mesh lines through `index`. Corner points are left alone. */
export function removePointLines(mesh, index) {
  if (!meshOk(mesh) || index < 0 || index >= mesh.points.length) return false;
  let w = (mesh.cols | 0) + 1;
  const r = Math.floor(index / w);
  const c = index % w;
  let changed = false;
  if (r > 0 && r < mesh.rows) {
    for (let cc = 0; cc < w; cc++) {
      const above = mesh.points[(r - 1) * w + cc];
      const below = mesh.points[(r + 1) * w + cc];
      handlesOf(above)[H_DOWN] = { x: (below.p.x - above.p.x) / 3, y: (below.p.y - above.p.y) / 3 };
      handlesOf(below)[H_UP] = { x: (above.p.x - below.p.x) / 3, y: (above.p.y - below.p.y) / 3 };
    }
    mesh.points.splice(r * w, w);
    mesh.rows -= 1;
    changed = true;
  }
  w = (mesh.cols | 0) + 1;
  if (c > 0 && c < mesh.cols) {
    const rows = mesh.rows | 0;
    for (let rr = 0; rr <= rows; rr++) {
      const left = mesh.points[rr * w + c - 1];
      const right = mesh.points[rr * w + c + 1];
      handlesOf(left)[H_RIGHT] = { x: (right.p.x - left.p.x) / 3, y: (right.p.y - left.p.y) / 3 };
      handlesOf(right)[H_LEFT] = { x: (left.p.x - right.p.x) / 3, y: (left.p.y - right.p.y) / 3 };
    }
    let k = 0;
    mesh.points = mesh.points.filter(() => {
      const keep = k % w !== c;
      k += 1;
      return keep;
    });
    mesh.cols -= 1;
    changed = true;
  }
  return changed;
}
