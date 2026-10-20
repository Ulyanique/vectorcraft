/** Paint a VectorCraft document to an SVG string. */

import {
  applyXf, flattenPath, hitStroke, ident, lerp, lerpColor, meshColor, meshEval, pathD, rgbCss, toRgb,
  warpDocPoint, mapPath, pathBounds, union,
} from "./geom.js";
import { childrenOf, nodeBounds } from "./model.js";

let gid = 1;
function nextId(prefix) { return `${prefix}${gid++}`; }

export function renderDocument(file, opts = {}) {
  gid = 1;
  const mode = opts.mode || "preview";
  const defs = [];
  const body = [];
  for (const layer of file.document.layers || []) {
    body.push(renderNode(layer, { defs, mode, opacity: 1 }));
  }
  return { defs: defs.join(""), body: body.join("") };
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
  const clipChild = k.clip ? kids.find((c) => c.kind?.clipping) : null;
  const clipD = clipPathD(clipChild);
  const clipId = clipD ? nextId("clip") : null;
  if (clipId) ctx.defs.push(`<clipPath id="${clipId}"><path d="${clipD}"/></clipPath>`);
  const parts = kids
    .filter((c) => !clipId || c !== clipChild)
    .map((c) => renderNode(c, { ...ctx, opacity: 1 }))
    .join("");
  if (clipId) return `<g clip-path="url(#${clipId})">${parts}</g>`;
  return parts;
  void op;
  void node;
}

function clipPathD(node) {
  const k = node?.kind;
  if (!k) return "";
  if (k.type === "path") return pathD(k.path);
  if (k.type === "compound") {
    const subs = [];
    for (const c of k.children || []) if (c.kind?.path) subs.push(...c.kind.path.subpaths);
    return pathD({ subpaths: subs });
  }
  return "";
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

function renderBlend(node, k, ctx) {
  const keys = k.children || [];
  if (keys.length < 2) return keys.map((c) => renderNode(c, ctx)).join("");
  const steps = k.spec?.spacing?.steps ?? 20;
  const parts = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    parts.push(renderNode(a, { ...ctx, opacity: (a.opacity ?? 1) }));
    const n = Math.max(1, Math.min(240, steps));
    for (let j = 1; j <= n; j++) {
      const t = j / (n + 1);
      const mid = lerpNode(a, b, t);
      if (mid) parts.push(renderNode(mid, ctx));
    }
  }
  parts.push(renderNode(keys[keys.length - 1], ctx));
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

function renderMesh(node, k, ctx) {
  const rows = k.rows | 0, cols = k.cols | 0;
  const pts = k.points || [];
  if (!rows || !cols || pts.length < (rows + 1) * (cols + 1)) return "";
  const N = 8;
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

function renderRepeat(node, k, ctx) {
  const spec = k.kind || {};
  const sources = k.source || [];
  if (spec.type !== "radial") {
    return sources.map((s) => renderNode(s, ctx)).join("");
  }
  const n = spec.instances || 1;
  const center = spec.center || { x: 0, y: 0 };
  const start = (spec.startAngle || 0) * Math.PI / 180;
  const end = (spec.endAngle ?? 360) * Math.PI / 180;
  const sweep = end - start;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / n;
    const ang = start + sweep * t;
    const co = Math.cos(ang), si = Math.sin(ang);
    // rotate around center: translate, rotate, translate back
    const tf = `translate(${center.x} ${center.y}) rotate(${ang * 180 / Math.PI}) translate(${-center.x} ${-center.y})`;
    const inner = sources.map((s) => renderNode(s, ctx)).join("");
    parts.push(`<g transform="${tf}">${inner}</g>`);
    void co; void si;
  }
  if (spec.reverseOverlap) parts.reverse();
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
    // Warp each glyph roughly by transforming the whole run's origin and drawing as a path-less text
    // at the warped baseline. Good enough for posters; feature-sheet envelope is paths.
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
  const steps = Math.max(1, Math.min(240, node.kind.spec?.spacing?.steps ?? 12));
  const out = [];
  for (let i = 0; i < keys.length - 1; i++) {
    out.push(JSON.parse(JSON.stringify(keys[i])));
    for (let j = 1; j <= steps; j++) {
      const mid = lerpNode(keys[i], keys[i + 1], j / (steps + 1));
      if (mid) out.push(mid);
    }
  }
  out.push(JSON.parse(JSON.stringify(keys[keys.length - 1])));
  return out;
}

export function blendHit(node, p, tol = 6) {
  const keys = node.kind?.children || [];
  if (keys.length < 2) return false;
  const steps = Math.min(40, node.kind.spec?.spacing?.steps ?? 12);
  const samples = [keys[0]];
  for (let j = 1; j <= steps; j++) {
    const mid = lerpNode(keys[0], keys[1], j / (steps + 1));
    if (mid) samples.push(mid);
  }
  samples.push(keys[keys.length - 1]);
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
