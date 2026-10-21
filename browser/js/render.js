/** Paint a VectorCraft document to an SVG string. */

import {
  applyXf, flattenPath, hitStroke, ident, lerp, lerpColor, meshColor, meshEval, mulXf, pathD, rgbCss,
  rotateXf, toRgb, translateXf, warpDocPoint, mapPath, pathBounds, union,
} from "./geom.js";
import { childrenOf, nodeBounds } from "./model.js";
import { cachedFace, outlineGlyphs } from "./outlines.js";
import { placeStep, spineActive, stepsBetween } from "./blend.js";

let gid = 1;
function nextId(prefix) { return `${prefix}${gid++}`; }

export function renderDocument(file, opts = {}) {
  gid = 1;
  const mode = opts.mode || "preview";
  const defs = [];
  const fontMisses = [];
  const seen = new Set();
  const noteFont = (family, style) => {
    const key = `${family}\0${style}`;
    if (seen.has(key)) return;
    seen.add(key);
    fontMisses.push({ family, style });
  };
  const body = [];
  for (const layer of file.document.layers || []) {
    body.push(renderNode(layer, { defs, mode, opacity: 1, noteFont }));
  }
  return { defs: defs.join(""), body: body.join(""), fontMisses };
}

function renderNode(node, ctx) {
  if (!node || node.visible === false) return "";
  const op = (node.opacity ?? 1) * (ctx.opacity ?? 1);
  const blend = svgBlend(node.blend);
  const kids = childrenOf(node);
  const k = node.kind || {};
  let inner = "";
  if (k.type === "layer" || k.type === "group") {
    inner = renderGroup(node, k, ctx, op);
  } else if (k.type === "path") {
    inner = renderPathNode(node, k, ctx, op);
  } else if (k.type === "compound") {
    inner = renderCompound(node, k, ctx, op);
  } else if (k.type === "text") {
    inner = ctx.skipText ? "" : renderText(node, k, ctx, op);
  } else if (k.type === "blend") {
    inner = renderBlend(node, k, ctx, op);
  } else if (k.type === "mesh") {
    inner = renderMesh(node, k, ctx, op);
  } else if (k.type === "repeat") {
    inner = renderRepeat(node, k, ctx, op);
  } else if (k.type === "envelope") {
    inner = renderEnvelope(node, k, ctx, op);
  } else if (kids) {
    inner = kids.map((c) => renderNode(c, { ...ctx, opacity: 1 })).join("");
  }
  if (!inner) return "";
  const effects = (node.appearance?.effects || []).filter((e) => e.visible !== false);
  // Glow is a separate layer so its blend mode (usually screen) hits the backdrop.
  // Duplicating the already-built markup keeps gradient ids shared.
  const painted = effects.length ? withEffects(effects, inner, ctx.defs) : inner;
  const attrs = [
    `data-id="${node.id}"`,
    op < 0.999 ? `opacity="${round(op)}"` : "",
    blend !== "normal" ? `style="mix-blend-mode:${blend}"` : "",
  ].filter(Boolean).join(" ");
  return `<g ${attrs}>${painted}</g>`;
}

function renderGroup(node, k, ctx, op) {
  const kids = k.children || [];
  if (!k.clip) return kids.map((c) => renderNode(c, { ...ctx, opacity: 1 })).join("");
  const clipChild = kids.find((c) => c.kind?.clipping) || kids[0];
  const geom = maskGeometry(clipChild, ctx);
  const clipD = geom ? pathD(geom) : "";
  const clipId = clipD ? nextId("clip") : null;
  if (clipId) {
    const rule = clipChild?.kind?.rule === "EvenOdd" ? ` clip-rule="evenodd"` : "";
    ctx.defs.push(`<clipPath id="${clipId}"><path d="${clipD}"${rule}/></clipPath>`);
  }
  const parts = kids
    .filter((c) => !clipId || c !== clipChild)
    .map((c) => renderNode(c, { ...ctx, opacity: 1 }))
    .join("");
  const clipped = clipId ? `<g clip-path="url(#${clipId})">${parts}</g>` : parts;
  // A mask painted after Make shows its fill behind the clipped art and its stroke over it.
  const under = clipId ? maskPaint(clipChild, geom, ctx, "fill") : "";
  const over = clipId ? maskPaint(clipChild, geom, ctx, "stroke") : "";
  if (!under && !over) return clipped;
  return `${under}${clipped}${over}`;
  void op;
  void node;
}

function maskGeometry(node, ctx) {
  const k = node?.kind;
  if (!k) return null;
  if (k.type === "path") return k.path;
  if (k.type === "compound") {
    const subpaths = [];
    for (const c of k.children || []) if (c.kind?.path) subpaths.push(...c.kind.path.subpaths);
    return { subpaths };
  }
  if (k.type === "text") {
    const outlined = textAsPaths(node, k, ctx);
    if (!outlined?.length) return null;
    return { subpaths: outlined.flatMap((n) => n.kind.path.subpaths || []) };
  }
  return null;
}

function maskPaint(node, geom, ctx, which) {
  if (!node || !geom) return "";
  const items = (node.appearance?.items || []).filter((it) => it.kind === which && it.visible !== false && it.paint && it.paint.type !== "none" && (which !== "stroke" || (it.width ?? 1) > 0));
  if (!items.length) return "";
  return renderNode({
    ...node,
    appearance: { items },
    kind: { type: "path", path: geom, rule: node.kind?.rule || "NonZero", clipping: false, guide: false },
  }, ctx);
}

function renderPathNode(node, k, ctx, op) {
  if (k.guide) return "";
  if (ctx.mode === "outline") {
    const d = pathD(k.path);
    if (!d) return "";
    return `<path data-id="${node.id}" d="${d}" fill="none" stroke="#6aa0ff" stroke-width="${ctx.hair || 1}" vector-effect="non-scaling-stroke"/>`;
  }
  return paintPath(node, k.path, k.rule, ctx);
  void op;
}

function renderCompound(node, k, ctx) {
  const subs = [];
  for (const c of k.children || []) {
    if (c.kind?.type === "path") subs.push(...(c.kind.path?.subpaths || []));
    else if (c.kind?.type === "compound") {
      for (const cc of c.kind.children || []) if (cc.kind?.path) subs.push(...cc.kind.path.subpaths);
    }
  }
  const path = { subpaths: subs };
  if (ctx.mode === "outline") {
    return `<path data-id="${node.id}" d="${pathD(path)}" fill="none" stroke="#6aa0ff" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  }
  // Compound uses its own appearance; children often carry none.
  const painted = paintPath(node, path, k.rule || "NonZero", ctx);
  if (painted.replace(/<[^>]+>/g, "").trim() || /fill="(?!none)/.test(painted) || /stroke="(?!none)/.test(painted)) return painted;
  // fall back to first child that has a paint
  const donor = (k.children || []).find((c) => (c.appearance?.items || []).some((it) => it.paint?.type && it.paint.type !== "none"));
  if (donor) return paintPath(donor, path, k.rule || "NonZero", ctx);
  return painted;
}

function paintPath(node, path, rule, ctx) {
  const d = pathD(path);
  if (!d) return "";
  const items = (node.appearance?.items || []).filter((it) => it.visible !== false);
  const fills = items.filter((it) => it.kind === "fill" && it.paint?.type !== "none");
  const strokes = items.filter((it) => it.kind === "stroke" && it.paint?.type && it.paint.type !== "none" && (it.width ?? 1) > 0);
  if (!fills.length && !strokes.length) {
    return `<path data-id="${node.id}" d="${d}" fill="none" stroke="none"/>`;
  }
  const fillRule = rule === "EvenOdd" ? "evenodd" : "nonzero";
  const parts = [];
  if (!fills.length) parts.push(`<path data-id="${node.id}" d="${d}" fill="none"/>`);
  for (const f of fills) {
    const paint = paintAttr(f.paint, path, ctx.defs, "fill");
    const op = f.opacity ?? 1;
    parts.push(`<path data-id="${node.id}" d="${d}" fill="${paint}" fill-rule="${fillRule}" stroke="none"${op < 0.999 ? ` fill-opacity="${round(op)}"` : ""}${blendAttr(f.blend)}/>`);
  }
  for (const s of strokes) {
    const paint = paintAttr(s.paint, path, ctx.defs, "stroke");
    const w = Math.max(s.width ?? 1, ctx?.minStroke || 0);
    const cap = (s.cap || "butt").toLowerCase();
    const join = (s.join || "miter").toLowerCase();
    const op = s.opacity ?? 1;
    parts.push(`<path data-id="${node.id}" d="${d}" fill="none" stroke="${paint}" stroke-width="${round(w)}" stroke-linecap="${cap}" stroke-linejoin="${join}" stroke-miterlimit="${s.miter_limit ?? 10}"${op < 0.999 ? ` stroke-opacity="${round(op)}"` : ""}${blendAttr(s.blend)}/>`);
  }
  return parts.join("");
}

function blendAttr(blend) {
  const b = svgBlend(blend);
  return b !== "normal" ? ` style="mix-blend-mode:${b}"` : "";
}

function paintAttr(paint, path, defs, kind) {
  if (!paint || paint.type === "none") return "none";
  if (paint.type === "solid") return rgbCss(paint.color, 1);
  if (paint.type === "gradient") return `url(#${gradientDef(paint, path, defs)})`;
  if (typeof paint === "string" && paint.startsWith("#")) return paint;
  return kind === "stroke" ? "#000" : "#888";
}

function gradientDef(paint, path, defs) {
  const id = nextId("g");
  const g = paint.gradient || {};
  const stops = (g.stops || []).map((s) => {
    const col = s.color || { model: "rgb", r: 0, g: 0, b: 0 };
    return `<stop offset="${(s.offset ?? 0) * 100}%" stop-color="${rgbCss(col)}" stop-opacity="${s.opacity ?? 1}"/>`;
  }).join("");
  const b = pathBounds(path) || { x0: 0, y0: 0, x1: 100, y1: 100 };
  if (g.kind === "Radial") {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const r = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2;
    defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}">${stops}</radialGradient>`);
  } else {
    const angle = (paint.angle ?? g.angle ?? 0) * Math.PI / 180;
    // Matches GradientGeom::fit: d = (cos θ, −sin θ), stop 0 at center − d.
    // 90° is vertical with the first stop at the bottom (y-down).
    const dx = Math.cos(angle), dy = -Math.sin(angle);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const hx = (b.x1 - b.x0) / 2, hy = (b.y1 - b.y0) / 2;
    const len = Math.abs(dx) * hx + Math.abs(dy) * hy || 1;
    defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${cx - dx * len}" y1="${cy - dy * len}" x2="${cx + dx * len}" y2="${cy + dy * len}">${stops}</linearGradient>`);
  }
  return id;
}

function renderText(node, k, ctx) {
  const runs = k.runs || [];
  const xf = k.xf || ident();
  const [a, b, c, d, e, f] = xf;
  const parts = [];
  let cursor = 0;
  // Point text: one or more runs on a single line (examples are single-run).
  const justify = k.para?.justify || "Left";
  const anchor = justify === "Center" ? "middle" : justify === "Right" ? "end" : "start";
  for (const run of runs) {
    const st = run.style || {};
    const size = st.size || 16;
    const tracking = (st.tracking || 0) / 1000 * size;
    const family = st.font_family || "Source Sans 3";
    const weight = fontWeight(st.font_style);
    const italic = /italic/i.test(st.font_style || "") ? "italic" : "normal";
    const fill = st.fill?.type === "solid" ? rgbCss(st.fill.color) : (st.fill?.type === "none" ? "none" : "#111");
    const text = st.all_caps ? (run.text || "").toUpperCase() : (run.text || "");
    const x = cursor;
    parts.push(`<text data-id="${node.id}" x="${round(x)}" y="0" fill="${fill}" font-family="${esc(family)}, 'Source Sans 3', sans-serif" font-size="${size}" font-weight="${weight}" font-style="${italic}" letter-spacing="${round(tracking)}" text-anchor="${anchor}">${esc(text)}</text>`);
  }
  if (ctx.mode === "outline") {
    return `<g data-id="${node.id}" transform="matrix(${a} ${b} ${c} ${d} ${e} ${f})">${parts.join("").replace(/fill="[^"]*"/g, 'fill="none" stroke="#6aa0ff" stroke-width="0.6"')}</g>`;
  }
  return `<g data-id="${node.id}" transform="matrix(${a} ${b} ${c} ${d} ${e} ${f})">${parts.join("")}</g>`;
}

function fontWeight(style) {
  const s = style || "";
  if (/black|heavy/i.test(s)) return 900;
  if (/extra.?bold|ultra.?bold/i.test(s)) return 800;
  // Semibold contains "bold" — check it first or the subtitle renders as 700.
  if (/semi.?bold|demi/i.test(s)) return 600;
  if (/bold/i.test(s)) return 700;
  if (/medium/i.test(s)) return 500;
  if (/light/i.test(s)) return 300;
  return 400;
}

function placedKey(node, keys, spec, i) {
  if (!spineActive(spec)) return node;
  const copy = JSON.parse(JSON.stringify(node));
  placeStep(copy, keys, spec, i, 0);
  return copy;
}

function renderBlend(node, k, ctx) {
  const keys = k.children || [];
  if (keys.length < 2) return keys.map((c) => renderNode(c, ctx)).join("");
  const spec = k.spec;
  const parts = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    parts.push(renderNode(placedKey(a, keys, spec, i), { ...ctx, opacity: (a.opacity ?? 1) }));
    const n = stepsBetween(keys, spec, i);
    for (let j = 1; j <= n; j++) {
      const t = j / (n + 1);
      const mid = lerpNode(a, b, t);
      if (!mid) continue;
      placeStep(mid, keys, spec, i, t);
      parts.push(renderNode(mid, ctx));
    }
  }
  const last = keys.length - 1;
  parts.push(renderNode(placedKey(keys[last], keys, spec, last), ctx));
  return `<g data-id="${node.id}">${parts.join("")}</g>`;
}

function lerpNode(a, b, t) {
  if (a.kind?.type !== "path" || b.kind?.type !== "path") return null;
  const pa = a.kind.path, pb = b.kind.path;
  if ((pa.subpaths?.length || 0) !== (pb.subpaths?.length || 0)) return null;
  const subpaths = pa.subpaths.map((sa, si) => {
    const sb = pb.subpaths[si];
    const na = sa.anchors.length, nb = sb.anchors.length;
    const n = Math.max(na, nb);
    const aa = resample(sa, n), bb = resample(sb, n);
    const anchors = aa.map((p, i) => ({
      p: lerpPt(p.p, bb[i].p, t),
      in: lerpPt(p.in, bb[i].in, t),
      out: lerpPt(p.out, bb[i].out, t),
      kind: t < 0.5 ? p.kind : bb[i].kind,
    }));
    return { anchors, closed: sa.closed && sb.closed };
  });
  const appearance = lerpAppearance(a.appearance, b.appearance, t);
  return {
    id: `b${a.id}_${b.id}_${t}`,
    visible: true,
    opacity: lerp(a.opacity ?? 1, b.opacity ?? 1, t),
    blend: "Normal",
    appearance,
    kind: { type: "path", path: { subpaths }, rule: a.kind.rule || "NonZero", clipping: false, guide: false },
  };
}

function resample(sp, n) {
  if (sp.anchors.length === n) return sp.anchors;
  const flat = flattenPath({ subpaths: [sp] }, 0.5)[0];
  if (!flat) return sp.anchors;
  const pts = flat.pts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const f = t * (pts.length - 1);
    const i0 = Math.floor(f), i1 = Math.min(pts.length - 1, i0 + 1);
    const p = lerpPt(pts[i0], pts[i1], f - i0);
    out.push({ p, in: { ...p }, out: { ...p }, kind: "Corner" });
  }
  return out;
}

function lerpPt(a, b, t) { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }; }

function lerpAppearance(A, B, t) {
  const itemsA = A?.items || [];
  const itemsB = B?.items || [];
  const n = Math.max(itemsA.length, itemsB.length);
  const items = [];
  for (let i = 0; i < n; i++) {
    const a = itemsA[i] || itemsB[i];
    const b = itemsB[i] || itemsA[i];
    if (!a) continue;
    const item = JSON.parse(JSON.stringify(a));
    if (a.kind === "stroke" || b.kind === "stroke") item.width = lerp(a.width ?? 1, b.width ?? 1, t);
    item.opacity = lerp(a.opacity ?? 1, b.opacity ?? 1, t);
    item.paint = lerpPaint(a.paint, b.paint, t);
    items.push(item);
  }
  return { items };
}

function lerpPaint(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  if (a.type === "solid" && b.type === "solid") return { type: "solid", color: lerpColor(a.color, b.color, t) };
  if (a.type === "none") return t < 0.5 ? a : b;
  return t < 0.5 ? a : b;
}

/** Subdivisions per patch. Desktop uses ceil(patch_px / 5), clamped 2..32; document units stand in for 100% zoom. */
function meshLevel(pts, rows, cols) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pt of pts) {
    const p = pt.p;
    if (!p) continue;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    for (const h of pt.handles || []) {
      x0 = Math.min(x0, p.x + h.x); y0 = Math.min(y0, p.y + h.y);
      x1 = Math.max(x1, p.x + h.x); y1 = Math.max(y1, p.y + h.y);
    }
  }
  const size = Math.max(x1 - x0, y1 - y0, 1);
  const per = size / Math.max(rows, cols, 1);
  return Math.max(2, Math.min(32, Math.ceil(per / 5)));
}

function renderMesh(node, k, ctx) {
  const rows = k.rows | 0, cols = k.cols | 0;
  const pts = k.points || [];
  if (!rows || !cols || pts.length < (rows + 1) * (cols + 1)) return "";
  const N = meshLevel(pts, rows, cols);
  const parts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const u0 = i / N, u1 = (i + 1) / N, v0 = j / N, v1 = (j + 1) / N;
          const p00 = meshEval(pts, rows, cols, r, c, u0, v0);
          const p10 = meshEval(pts, rows, cols, r, c, u1, v0);
          const p11 = meshEval(pts, rows, cols, r, c, u1, v1);
          const p01 = meshEval(pts, rows, cols, r, c, u0, v1);
          const col = meshColor(pts, rows, cols, r, c, (u0 + u1) / 2, (v0 + v1) / 2);
          const d = `M ${p00.x} ${p00.y} L ${p10.x} ${p10.y} L ${p11.x} ${p11.y} L ${p01.x} ${p01.y} Z`;
          parts.push(`<path d="${d}" fill="${rgbCss(col.color, col.opacity)}" stroke="none"/>`);
        }
      }
    }
  }
  return `<g data-id="${node.id}">${parts.join("")}</g>`;
  void ctx;
}

/** Instance matrices (source → document), in paint order. Matches `repeat_transforms`. */
export function repeatTransforms(spec, bounds) {
  const b = bounds || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  if (spec?.type === "radial") return radialTransforms(spec, cx, cy);
  if (spec?.type === "grid") return gridTransforms(spec, b);
  if (spec?.type === "mirror") return [ident(), reflectAbout(spec.center || { x: cx, y: cy }, spec.angle || 0)];
  return [ident()];
}

function radialTransforms(spec, cx, cy) {
  const n = Math.max(1, Math.min(1000, spec.instances || 1));
  const center = spec.center || { x: 0, y: 0 };
  let dx = cx - center.x, dy = cy - center.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) { dx = 0; dy = -1; }
  else { dx /= len; dy /= len; }
  const radius = Math.max(0, spec.radius || 0);
  // Keep the source's centre `radius` from the repeat centre, then spin.
  const pre = translateXf(center.x + dx * radius - cx, center.y + dy * radius - cy);
  const start = (spec.startAngle || 0) * Math.PI / 180;
  const end = (spec.endAngle ?? 360) * Math.PI / 180;
  const sweep = end - start;
  const full = Math.abs(Math.abs(sweep) - Math.PI * 2) < 1e-6;
  const step = full || n === 1 ? sweep / n : sweep / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(mulXf(rotateXf(start + step * i, center.x, center.y), pre));
  if (spec.reverseOverlap) out.reverse();
  return out;
}

function gridTransforms(spec, b) {
  const rows = Math.max(1, Math.min(500, spec.rows || 3));
  const cols = Math.max(1, Math.min(500, spec.cols || 3));
  const w = Math.max(1e-3, (b.x1 - b.x0) + (spec.hSpacing || 0));
  const h = Math.max(1e-3, (b.y1 - b.y0) + (spec.vSpacing || 0));
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const o = tileOffset(spec.gridType, w, h, i, j);
      let flip = ident();
      if (spec.flipCols && i % 2 === 1) flip = mulXf(reflectAbout({ x: cx, y: cy }, 90), flip);
      if (spec.flipRows && j % 2 === 1) flip = mulXf(reflectAbout({ x: cx, y: cy }, 0), flip);
      out.push(mulXf(translateXf(o.x, o.y), flip));
    }
  }
  return out;
}

function tileOffset(tt, w, h, i, j) {
  const type = tt?.type || "grid";
  const offset = tt?.offset ?? 0.5;
  const frac = (v) => v - Math.floor(v);
  if (type === "brickByRow") return { x: i * w + frac(j * offset) * w, y: j * h };
  if (type === "brickByColumn") return { x: i * w, y: j * h + frac(i * offset) * h };
  if (type === "hexByColumn") return { x: i * w * 0.75, y: j * h + (i % 2 === 1 ? h / 2 : 0) };
  if (type === "hexByRow") return { x: i * w + (j % 2 === 1 ? w / 2 : 0), y: j * h * 0.75 };
  return { x: i * w, y: j * h };
}

function reflectAbout(c, deg) {
  const t = 2 * deg * Math.PI / 180;
  const s2 = Math.sin(t), c2 = Math.cos(t);
  return mulXf(translateXf(c.x, c.y), mulXf([c2, s2, s2, -c2, 0, 0], translateXf(-c.x, -c.y)));
}

function renderRepeat(node, k, ctx) {
  const spec = k.kind || {};
  const sources = k.source || [];
  let b = null;
  for (const s of sources) b = union(b, nodeBounds(s));
  const parts = repeatTransforms(spec, b).map((xf) => {
    const inner = sources.map((s) => renderNode(s, ctx)).join("");
    return `<g transform="matrix(${xf.map(round).join(" ")})">${inner}</g>`;
  });
  return `<g data-id="${node.id}">${parts.join("")}</g>`;
}

function renderEnvelope(node, k, ctx) {
  const content = k.content || [];
  const warp = k.kind || {};
  if (warp.type !== "warp") return content.map((c) => renderNode(c, ctx)).join("");
  let src = null;
  for (const c of content) src = union(src, nodeBounds(c));
  if (!src) return "";
  const style = warp.style || "flag";
  const bend = warp.bend || 0;
  const dh = warp.h || 0, dv = warp.v || 0;
  const horizontal = warp.horizontal !== false;
  const fn = (p) => warpDocPoint(p, src, style, bend, dh, dv, horizontal);
  const parts = content.map((c) => renderWarped(c, fn, ctx)).join("");
  return `<g data-id="${node.id}">${parts}</g>`;
}

function renderWarped(node, fn, ctx) {
  if (!node || node.visible === false) return "";
  const k = node.kind || {};
  if (k.type === "path") {
    const path = mapPath(k.path, fn, 6);
    const clone = { ...node, kind: { ...k, path, live: undefined } };
    return renderNode(clone, ctx);
  }
  if (k.type === "text") {
    // Desktop outlines type, then pushes the glyph paths through the same map as the art.
    const paths = textAsPaths(node, k, ctx);
    if (paths) return paths.map((p) => renderWarped(p, fn, ctx)).join("");
    const xf = k.xf || ident();
    const o = fn(applyXf(xf, { x: 0, y: 0 }));
    const clone = JSON.parse(JSON.stringify(node));
    clone.kind.xf = [xf[0], xf[1], xf[2], xf[3], o.x, o.y];
    return renderNode(clone, ctx);
  }
  const kids = childrenOf(node);
  if (kids) return kids.map((c) => renderWarped(c, fn, ctx)).join("");
  return renderNode(node, ctx);
}

/** Glyph outlines for a text node, or null if a face is not loaded yet. */
function textAsPaths(node, k, ctx) {
  const xf = k.xf || ident();
  const justify = k.para?.justify || "Left";
  let origin = 0;
  const out = [];
  for (const run of k.runs || []) {
    const st = run.style || {};
    const family = st.font_family || "Source Sans 3";
    const style = st.font_style || "Regular";
    const face = cachedFace(family, style);
    if (!face) {
      ctx.noteFont?.(family, style);
      return null;
    }
    const text = st.all_caps ? (run.text || "").toUpperCase() : (run.text || "");
    const outlined = outlineGlyphs(face, text, st, xf, origin ? "Left" : justify, null, origin);
    origin += outlined.advance;
    const items = [];
    if (!st.fill || st.fill.type !== "none") {
      items.push({ kind: "fill", paint: st.fill || { type: "solid", color: { model: "rgb", r: 0, g: 0, b: 0 } }, opacity: 1, visible: true });
    }
    if (st.stroke?.type && st.stroke.type !== "none" && (st.stroke_width || 0) > 0) {
      items.push({ kind: "stroke", paint: st.stroke, width: st.stroke_width, opacity: 1, visible: true });
    }
    for (const path of outlined.paths) {
      out.push({
        id: node.id,
        visible: true,
        opacity: node.opacity ?? 1,
        blend: node.blend,
        appearance: { items },
        kind: { type: "path", path },
      });
    }
  }
  return out;
}

function withEffects(effects, inner, defs) {
  const glow = effects.find((e) => e.id === "stylize.outerGlow");
  if (!glow) return inner;
  const id = nextId("fx");
  const blur = glow.params?.blur ?? 8;
  const color = glow.params?.color || "#fff";
  const op = (glow.params?.opacity ?? 75) / 100;
  // Rust rasterizes outer glow with σ = blur / 2, then composites in the effect's blend mode.
  const dev = Math.max(0.4, blur / 2);
  const mode = svgBlend(glow.params?.mode || "screen");
  defs.push(`<filter id="${id}" x="-120%" y="-120%" width="340%" height="340%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="${dev}" result="b"/>
    <feFlood flood-color="${color}" flood-opacity="${op}" result="c"/>
    <feComposite in="c" in2="b" operator="in"/>
  </filter>`);
  return `<g filter="url(#${id})" style="mix-blend-mode:${mode};pointer-events:none">${inner}</g>${inner}`;
}

function svgBlend(b) {
  if (!b || b === "Normal") return "normal";
  const map = {
    Multiply: "multiply", Screen: "screen", Overlay: "overlay", Darken: "darken", Lighten: "lighten",
    ColorDodge: "color-dodge", ColorBurn: "color-burn", HardLight: "hard-light", SoftLight: "soft-light",
    Difference: "difference", Exclusion: "exclusion", Hue: "hue", Saturation: "saturation",
    Color: "color", Luminosity: "luminosity",
  };
  return map[b] || b.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function round(v) { return Math.round(v * 1000) / 1000; }

export function expandBlend(node) {
  const keys = node.kind?.children || [];
  if (keys.length < 2) return keys.map((k) => JSON.parse(JSON.stringify(k)));
  const spec = node.kind.spec;
  const out = [];
  for (let i = 0; i < keys.length - 1; i++) {
    out.push(placedKey(keys[i], keys, spec, i));
    const steps = stepsBetween(keys, spec, i);
    for (let j = 1; j <= steps; j++) {
      const t = j / (steps + 1);
      const mid = lerpNode(keys[i], keys[i + 1], t);
      if (!mid) continue;
      placeStep(mid, keys, spec, i, t);
      out.push(mid);
    }
  }
  const last = keys.length - 1;
  out.push(placedKey(keys[last], keys, spec, last));
  return out;
}

export function blendHit(node, p, tol = 6) {
  const keys = node.kind?.children || [];
  if (keys.length < 2) return false;
  const spec = node.kind.spec;
  const samples = [];
  for (let i = 0; i < keys.length - 1; i++) {
    samples.push(placedKey(keys[i], keys, spec, i));
    const steps = Math.min(40, stepsBetween(keys, spec, i));
    for (let j = 1; j <= steps; j++) {
      const t = j / (steps + 1);
      const mid = lerpNode(keys[i], keys[i + 1], t);
      if (!mid) continue;
      placeStep(mid, keys, spec, i, t);
      samples.push(mid);
    }
  }
  samples.push(placedKey(keys[keys.length - 1], keys, spec, keys.length - 1));
  for (const s of samples) {
    const path = s.kind?.path;
    if (!path) continue;
    const stroke = (s.appearance?.items || []).find((it) => it.kind === "stroke");
    const w = Math.max(tol, stroke?.width || tol);
    if (hitStroke(path, p, w)) return true;
  }
  return false;
}

/** Isolated thumbnail of `node`. `px` is the longest side in pixels; `minStroke` thickens hairlines. */
export function thumbnailSVG(node, px = 64, opts = {}) {
  const defs = [];
  const body = renderNode(node, { defs, mode: "preview", opacity: 1, minStroke: opts.minStroke || 0 });
  const b = nodeBounds(node) || { x0: 0, y0: 0, x1: 8, y1: 8 };
  let x0 = b.x0, y0 = b.y0, x1 = b.x1, y1 = b.y1;
  if (!(x1 > x0)) { x0 = 0; x1 = 8; }
  if (!(y1 > y0)) { y0 = 0; y1 = 8; }
  const bw = x1 - x0, bh = y1 - y0;
  const pad = Math.max(bw, bh) * 0.06 + (opts.minStroke || 0) * 0.6;
  const x = x0 - pad, y = y0 - pad, w = Math.max(1, bw + pad * 2), h = Math.max(1, bh + pad * 2);
  const scale = px / Math.max(w, h);
  const W = Math.max(1, Math.round(w * scale));
  const H = Math.max(1, Math.round(h * scale));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${x} ${y} ${w} ${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/>${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body}</svg>`;
  return { svg, w: W, h: H };
}

export function artboardSVG(file) {
  return (file.document.artboards || []).map((a) => {
    const r = a.rect;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    return `<g data-artboard="${a.id}">
      <rect x="${r.x0 + 3}" y="${r.y0 + 4}" width="${w}" height="${h}" fill="rgba(0,0,0,.28)" filter="url(#abShadow)"/>
      <rect x="${r.x0}" y="${r.y0}" width="${w}" height="${h}" fill="#fff"/>
    </g>`;
  }).join("");
}
