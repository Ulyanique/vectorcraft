/** TrueType glyph outlines for Create Outlines.

Contours come out in font units, y-down (the same flip the desktop editor uses), as closed
cubic subpaths the rest of the editor already draws. */

import { applyXf } from "./geom.js";
import { fontUrl } from "./fontmetrics.js";

const faces = new Map();
const pending = new Map();

export function loadFace(family, style) {
  const url = fontUrl(family, style);
  if (faces.has(url)) return Promise.resolve(faces.get(url));
  if (pending.has(url)) return pending.get(url);
  const job = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(url);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const face = parseFace(buf);
      faces.set(url, face);
      pending.delete(url);
      return face;
    })
    .catch((err) => {
      pending.delete(url);
      throw err;
    });
  pending.set(url, job);
  return job;
}

export function parseFace(buf) {
  const view = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  const u8 = (o) => view.getUint8(o);
  const u16 = (o) => view.getUint16(o);
  const i16 = (o) => view.getInt16(o);
  const u32 = (o) => view.getUint32(o);
  const num = u16(4);
  const tables = {};
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(u8(o), u8(o + 1), u8(o + 2), u8(o + 3));
    tables[tag] = u32(o + 8);
  }
  const units = u16(tables.head + 18);
  const locaLong = i16(tables.head + 50) === 1;
  const ascent = i16(tables.hhea + 4);
  const descent = i16(tables.hhea + 6);
  const lineGap = i16(tables.hhea + 8);
  const numH = u16(tables.hhea + 34);
  const numGlyphs = u16(tables.maxp + 4);
  const glyphOf = cmapLookup(view, tables.cmap);
  const locaOf = (gid) => {
    if (locaLong) return u32(tables.loca + gid * 4);
    return u16(tables.loca + gid * 2) * 2;
  };
  const advanceOf = (gid) => {
    const gi = gid < numH ? gid : Math.max(0, numH - 1);
    return u16(tables.hmtx + gi * 4);
  };
  const cache = new Map();
  function contoursOf(gid, depth = 0) {
    if (cache.has(gid)) return cache.get(gid);
    if (gid < 0 || gid >= numGlyphs || depth > 8) return [];
    const start = locaOf(gid);
    const end = locaOf(gid + 1);
    if (end <= start) {
      cache.set(gid, []);
      return [];
    }
    const g = tables.glyf + start;
    const nContours = i16(g);
    let out;
    if (nContours < 0) out = compositeContours(g, depth);
    else if (nContours === 0) out = [];
    else out = simpleContours(g, nContours);
    cache.set(gid, out);
    return out;
  }
  function simpleContours(g, nContours) {
    const ends = [];
    let o = g + 10;
    for (let i = 0; i < nContours; i++) {
      ends.push(u16(o));
      o += 2;
    }
    const nPts = ends[ends.length - 1] + 1;
    o += 2 + u16(o);
    const flags = new Array(nPts);
    for (let i = 0; i < nPts;) {
      const f = u8(o++);
      flags[i++] = f;
      if (f & 8) {
        let rep = u8(o++);
        while (rep-- > 0 && i < nPts) flags[i++] = f;
      }
    }
    const xs = new Array(nPts);
    let x = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 2) x += (f & 16) ? u8(o++) : -u8(o++);
      else if (!(f & 16)) { x += i16(o); o += 2; }
      xs[i] = x;
    }
    const ys = new Array(nPts);
    let y = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 4) y += (f & 32) ? u8(o++) : -u8(o++);
      else if (!(f & 32)) { y += i16(o); o += 2; }
      ys[i] = -y;
    }
    const contours = [];
    let from = 0;
    for (const end of ends) {
      const pts = [];
      for (let i = from; i <= end; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
      const anchors = contourAnchors(pts);
      if (anchors.length) contours.push(anchors);
      from = end + 1;
    }
    return contours;
  }
  function compositeContours(g, depth) {
    let o = g + 10;
    const out = [];
    for (;;) {
      const flags = u16(o); o += 2;
      const gid = u16(o); o += 2;
      let arg1, arg2;
      if (flags & 1) {
        arg1 = i16(o); arg2 = i16(o + 2); o += 4;
      } else {
        arg1 = view.getInt8(o); arg2 = view.getInt8(o + 1); o += 2;
      }
      let a = 1, b = 0, c = 0, d = 1;
      if (flags & 8) { a = d = i16(o) / 16384; o += 2; }
      else if (flags & 64) { a = i16(o) / 16384; d = i16(o + 2) / 16384; o += 4; }
      else if (flags & 128) { a = i16(o) / 16384; b = i16(o + 2) / 16384; c = i16(o + 4) / 16384; d = i16(o + 6) / 16384; o += 8; }
      const e = flags & 2 ? arg1 : 0;
      const dy = flags & 2 ? arg2 : 0;
      for (const contour of contoursOf(gid, depth + 1)) {
        out.push(contour.map((pt) => xfAnchor(pt, a, b, c, d, e, dy)));
      }
      if (!(flags & 32)) break;
    }
    return out;
  }
  return {
    units, ascent, descent, lineGap,
    glyphOf,
    advance: advanceOf,
    outline: (gid) => contoursOf(gid),
  };
}

/** Component transform. `a b c d` are the font-space matrix (x' = ax + by, y' = cx + dy); points are already y-flipped. */
function xfAnchor(pt, a, b, c, d, e, dy) {
  const map = (p) => ({ x: a * p.x - b * p.y + e, y: -c * p.x + d * p.y - dy });
  return { p: map(pt.p), in: map(pt.in), out: map(pt.out), kind: pt.kind };
}

/** Closed contour of on/off points → cubic anchors. */
export function contourAnchors(points) {
  const n = points.length;
  if (n < 2) return [];
  const expanded = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const next = points[(i + 1) % n];
    expanded.push(p);
    if (!p.on && !next.on) expanded.push({ x: (p.x + next.x) / 2, y: (p.y + next.y) / 2, on: true });
  }
  const s = expanded.findIndex((p) => p.on);
  if (s < 0) return [];
  const seq = expanded.slice(s).concat(expanded.slice(0, s));
  const ring = seq.concat([seq[0]]);
  const anchors = [];
  const add = (p) => anchors.push({ p: { x: p.x, y: p.y }, in: { x: p.x, y: p.y }, out: { x: p.x, y: p.y }, kind: "Corner" });
  add(ring[0]);
  for (let i = 1; i < ring.length;) {
    if (ring[i].on) {
      add(ring[i]);
      i++;
    } else {
      const c = ring[i];
      const p1 = ring[i + 1];
      if (!p1) break;
      const p0 = anchors[anchors.length - 1].p;
      anchors[anchors.length - 1].out = { x: p0.x + (2 / 3) * (c.x - p0.x), y: p0.y + (2 / 3) * (c.y - p0.y) };
      anchors[anchors.length - 1].kind = "Smooth";
      add(p1);
      anchors[anchors.length - 1].in = { x: p1.x + (2 / 3) * (c.x - p1.x), y: p1.y + (2 / 3) * (c.y - p1.y) };
      anchors[anchors.length - 1].kind = "Smooth";
      i += 2;
    }
  }
  if (anchors.length > 1 && near(anchors[0].p, anchors[anchors.length - 1].p)) {
    const last = anchors.pop();
    anchors[0].in = last.in;
    if (last.kind === "Smooth") anchors[0].kind = "Smooth";
  }
  return anchors;
}

function near(a, b) { return Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3; }

function cmapLookup(view, cmap) {
  const u16 = (o) => view.getUint16(o);
  const i16 = (o) => view.getInt16(o);
  const u32 = (o) => view.getUint32(o);
  const nsub = u16(cmap + 2);
  let chosen = null;
  for (let i = 0; i < nsub; i++) {
    const so = cmap + u32(cmap + 8 + i * 8);
    const fmt = u16(so);
    if (fmt === 12) return format12(view, so);
    if (fmt === 4 && !chosen) chosen = so;
  }
  return chosen ? format4(view, chosen) : () => 0;
  function format12(view, so) {
    const n = u32(so + 12);
    const groups = [];
    let p = so + 16;
    for (let i = 0; i < n; i++) {
      groups.push([u32(p), u32(p + 4), u32(p + 8)]);
      p += 12;
    }
    return (cp) => {
      let lo = 0, hi = groups.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const [s, e, g] = groups[mid];
        if (cp < s) hi = mid - 1;
        else if (cp > e) lo = mid + 1;
        else return g + (cp - s);
      }
      return 0;
    };
  }
  function format4(view, so) {
    const segCount = u16(so + 6) >> 1;
    const endOff = so + 14;
    const startOff = endOff + 2 * segCount + 2;
    const deltaOff = startOff + 2 * segCount;
    const rangeOff = deltaOff + 2 * segCount;
    return (cp) => {
      for (let i = 0; i < segCount; i++) {
        const end = u16(endOff + 2 * i);
        if (cp > end) continue;
        const start = u16(startOff + 2 * i);
        if (cp < start) return 0;
        const delta = i16(deltaOff + 2 * i);
        const ro = u16(rangeOff + 2 * i);
        if (!ro) return (cp + delta) & 0xffff;
        const g = u16(rangeOff + 2 * i + ro + 2 * (cp - start));
        return g ? (g + delta) & 0xffff : 0;
      }
      return 0;
    };
  }
}

/** Glyphs of one run in text space: pen along the baseline, y-down, tracking after each glyph. */
export function layoutRun(face, text, style) {
  const size = style.size || 16;
  const hs = (style.h_scale ?? 100) / 100;
  const vs = (style.v_scale ?? 100) / 100;
  const sx = size / face.units * hs;
  const sy = size / face.units * vs;
  const tracking = (style.tracking || 0) / 1000 * size;
  const shift = style.baseline_shift || 0;
  const src = style.all_caps ? String(text || "").toUpperCase() : String(text || "");
  const glyphs = [];
  let pen = 0;
  let line = 0;
  const lineH = ((face.ascent - face.descent + face.lineGap) / face.units) * size * vs || size * 1.2;
  for (const ch of src) {
    if (ch === "\n") {
      line++;
      pen = 0;
      continue;
    }
    const gid = face.glyphOf(ch.codePointAt(0)) || 0;
    const adv = face.advance(gid) * sx + tracking;
    glyphs.push({ ch, gid, contours: gid ? face.outline(gid) : [], pen, line, adv, sx, sy, shift, lineH });
    pen += adv;
  }
  return glyphs;
}

/** One path per glyph, in document space. `advances` replaces hmtx+tracking steps so browser kerning can match the type on screen. */
export function outlineGlyphs(face, text, style, xf, justify = "Left", advances = null, originX = 0) {
  const glyphs = layoutRun(face, text, style);
  if (advances) glyphs.forEach((g, i) => { if (advances[i] != null) g.adv = advances[i]; });
  let pen = 0;
  let line = -1;
  const lines = [];
  for (const g of glyphs) {
    if (g.line !== line) { line = g.line; pen = 0; }
    g.pen = pen;
    pen += g.adv;
    (lines[g.line] ||= []).push(g);
  }
  const tracking = (style.tracking || 0) / 1000 * (style.size || 16);
  const paths = [];
  for (const row of lines) {
    if (!row) continue;
    const width = row.reduce((s, g) => s + g.adv, 0) - tracking;
    const shiftX = justify === "Center" || justify === "JustifyCenter" ? -width / 2
      : justify === "Right" || justify === "JustifyRight" ? -width : 0;
    for (const g of row) {
      if (!g.contours.length) continue;
      const ox = originX + g.pen + shiftX;
      const oy = g.line * g.lineH - g.shift;
      paths.push({
        subpaths: g.contours.map((contour) => ({
          closed: true,
          anchors: contour.map((a) => ({
            p: place(a.p, g, ox, oy, xf),
            in: place(a.in, g, ox, oy, xf),
            out: place(a.out, g, ox, oy, xf),
            kind: a.kind,
          })),
        })),
      });
    }
  }
  const advance = glyphs.reduce((s, g) => s + g.adv, 0);
  return { paths, advance };
}

function place(p, g, ox, oy, xf) {
  return applyXf(xf, { x: p.x * g.sx + ox, y: p.y * g.sy + oy });
}
