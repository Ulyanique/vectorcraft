/** Polygon boolean (union / intersect / difference / xor) on simple rings. */

const EPS = 1e-7;

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function cross(a, b) { return a.x * b.y - a.y * b.x; }
function keyOf(p) { return `${Math.round(p.x * 1000) / 1000},${Math.round(p.y * 1000) / 1000}`; }

function segHit(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
    return { x: a.x + r.x * t, y: a.y + r.y * t, t, u };
  }
  return null;
}

function inside(p, ring) {
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

function clean(ring) {
  const out = [];
  for (const p of ring) {
    if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) > 0.05) out.push({ x: p.x, y: p.y });
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 0.05) out.pop();
  return out;
}

function area(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * @param {Array<{x:number,y:number}>} subj
 * @param {Array<{x:number,y:number}>} clip
 * @param {"union"|"intersect"|"difference"|"xor"} op
 */
export function polygonBoolean(subj, clip, op) {
  subj = clean(subj);
  clip = clean(clip);
  if (subj.length < 3 || clip.length < 3) return op === "difference" || op === "union" ? [subj] : [];
  const edges = [];
  const addSplit = (ring, other, source) => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const hits = [{ t: 0, p: a }, { t: 1, p: b }];
      for (let j = 0; j < other.length; j++) {
        const hit = segHit(a, b, other[j], other[(j + 1) % other.length]);
        if (hit) hits.push({ t: hit.t, p: { x: hit.x, y: hit.y } });
      }
      hits.sort((p, q) => p.t - q.t);
      for (let k = 0; k < hits.length - 1; k++) {
        const p = hits[k].p, q = hits[k + 1].p;
        if (Math.hypot(p.x - q.x, p.y - q.y) < 0.04) continue;
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const inn = inside(mid, other);
        let keep = false;
        let rev = false;
        if (source === "s") {
          if (op === "union") keep = !inn;
          else if (op === "intersect") keep = inn;
          else if (op === "difference") keep = !inn;
          else if (op === "xor") keep = !inn;
        } else {
          if (op === "union") keep = !inn;
          else if (op === "intersect") keep = inn;
          else if (op === "difference") { keep = inn; rev = true; }
          else if (op === "xor") keep = !inn;
        }
        if (!keep) continue;
        edges.push(rev ? [q, p] : [p, q]);
      }
    }
  };
  addSplit(subj, clip, "s");
  addSplit(clip, subj, "c");
  return stitch(edges);
}

function stitch(edges) {
  const map = new Map();
  for (const [a, b] of edges) {
    const k = keyOf(a);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(b);
  }
  const used = new Set();
  const rings = [];
  for (const [a, b] of edges) {
    const startKey = keyOf(a) + ">" + keyOf(b);
    if (used.has(startKey)) continue;
    const ring = [{ ...a }];
    let cur = b;
    let prev = a;
    let guard = 0;
    used.add(startKey);
    while (guard++ < 10000) {
      ring.push({ ...cur });
      if (keyOf(cur) === keyOf(a) && ring.length > 2) break;
      const nexts = map.get(keyOf(cur)) || [];
      let nxt = null;
      let best = Infinity;
      // prefer the sharpest left turn so rings stay consistent
      const vin = sub(cur, prev);
      for (const cand of nexts) {
        const ek = keyOf(cur) + ">" + keyOf(cand);
        if (used.has(ek)) continue;
        const vout = sub(cand, cur);
        const ang = Math.atan2(cross(vin, vout), vin.x * vout.x + vin.y * vout.y);
        // leftmost = largest CCW angle
        const score = -ang;
        if (score < best) { best = score; nxt = cand; }
      }
      if (!nxt) break;
      used.add(keyOf(cur) + ">" + keyOf(nxt));
      prev = cur;
      cur = nxt;
    }
    const cleaned = clean(ring);
    if (cleaned.length >= 3 && Math.abs(area(cleaned)) > 1) rings.push(cleaned);
  }
  return rings;
}

export function ringArea(ring) { return area(ring); }
