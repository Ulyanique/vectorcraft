/** Document model: the native .vectorcraft JSON, plus editing operations. */

import {
  applyXf, boundsOf, ellipsePath, ident, include, linePath, mulXf, pathBounds, pathFromAnchors,
  polygonPath, rotateXf, scaleXf, starPath, subpathBounds, translatePath, translateXf, union,
} from "./geom.js";
import { measureWidth, metricsFor, typoBox } from "./fontmetrics.js";

export const GENERATOR = "VectorCraft";

function asPt(p) {
  if (!p) return { x: 0, y: 0 };
  if (Array.isArray(p)) return { x: +p[0] || 0, y: +p[1] || 0 };
  return { x: +p.x || 0, y: +p.y || 0 };
}

function normalizeNode(node) {
  const k = node?.kind;
  if (!k) return;
  if (k.type === "path" && k.path) {
    for (const sp of k.path.subpaths || []) {
      for (const a of sp.anchors || []) {
        a.p = asPt(a.p);
        a.in = a.in ? asPt(a.in) : { ...a.p };
        a.out = a.out ? asPt(a.out) : { ...a.p };
        if (!a.kind) a.kind = "Corner";
      }
    }
  } else if (k.type === "mesh") {
    for (const p of k.points || []) {
      p.p = asPt(p.p);
      if (Array.isArray(p.handles)) p.handles = p.handles.map(asPt);
    }
  } else if (k.type === "repeat" && k.kind?.center) k.kind.center = asPt(k.kind.center);
  const kids = childrenOf(node);
  if (kids) for (const c of kids) normalizeNode(c);
}

export function loadFile(text) {
  const file = JSON.parse(text);
  if (file.format !== "vectorcraft" || !file.document) throw new Error("Not a VectorCraft document");
  if (!file.document.layers) file.document.layers = [];
  if (!file.document.artboards) file.document.artboards = [];
  if (file.document.next_id == null) file.document.next_id = 1;
  for (const layer of file.document.layers) normalizeNode(layer);
  return file;
}

export function newFile({ title = "Untitled-1", width = 800, height = 600, colorMode = "Rgb", units = "Points", artboards = 1 } = {}) {
  const abs = [];
  const gap = 40;
  for (let i = 0; i < artboards; i++) {
    const x0 = i * (width + gap);
    abs.push({
      id: i + 1,
      name: artboards === 1 ? "Artboard 1" : `Artboard ${i + 1}`,
      rect: { x0, y0: 0, x1: x0 + width, y1: height },
    });
  }
  return {
    format: "vectorcraft",
    version: 1,
    generator: GENERATOR,
    images: {},
    document: {
      title,
      units,
      color_mode: colorMode,
      artboards: abs,
      active_artboard: 1,
      layers: [makeLayer(artboards + 1, "Layer 1")],
      swatches: defaultSwatches(),
      swatch_groups: [],
      graphic_styles: [],
      brushes: [],
      symbols: [],
      next_id: artboards + 2,
    },
  };
}

function defaultSwatches() {
  const solid = (name, r, g, b) => ({ name, paint: { type: "solid", color: { model: "rgb", r, g, b } }, global: false, spot: false });
  return [
    { name: "[None]", paint: { type: "none" }, global: false, spot: false },
    solid("White", 1, 1, 1),
    solid("Black", 0, 0, 0),
    solid("Red", 0.9, 0.16, 0.22),
    solid("Orange", 0.96, 0.49, 0.13),
    solid("Yellow", 0.98, 0.8, 0.08),
    solid("Green", 0.18, 0.7, 0.38),
    solid("Cyan", 0.05, 0.72, 0.85),
    solid("Blue", 0.22, 0.45, 0.95),
    solid("Purple", 0.55, 0.28, 0.85),
    solid("Magenta", 0.9, 0.25, 0.55),
  ];
}

export function makeLayer(id, name, color = 0) {
  return {
    id, name, visible: true, locked: false, opacity: 1, blend: "Normal",
    isolate: false, knockout: false, appearance: { items: [] },
    kind: { type: "layer", color: { Preset: color % 8 }, template: false, printable: true, children: [] },
  };
}

export function blankNode(id, kind, appearance) {
  return {
    id, name: null, visible: true, locked: false, opacity: 1, blend: "Normal",
    isolate: false, knockout: false,
    appearance: appearance || defaultAppearance(),
    kind,
  };
}

export function defaultAppearance(fill = { type: "solid", color: { model: "rgb", r: 0.2, g: 0.45, b: 0.95 } }, stroke = { type: "none" }, width = 1) {
  return {
    items: [
      { kind: "fill", paint: fill, opacity: 1, blend: "Normal", visible: true },
      strokeItem(stroke, width),
    ],
  };
}

export function strokeItem(paint, width = 1) {
  return {
    kind: "stroke", paint, width, cap: "Butt", join: "Miter", miter_limit: 10,
    align: "Center", arrow_scale: [100, 100], opacity: 1, blend: "Normal", visible: true,
  };
}

export function solid(r, g, b) { return { type: "solid", color: { model: "rgb", r, g, b } }; }
export function nonePaint() { return { type: "none" }; }

export function allocId(file) {
  const id = file.document.next_id || 1;
  file.document.next_id = id + 1;
  return id;
}

export function childrenOf(node) {
  const k = node?.kind;
  if (!k || typeof k !== "object") return null;
  if (k.type === "layer" || k.type === "group" || k.type === "blend" || k.type === "compound") return k.children;
  if (k.type === "repeat") return k.source;
  if (k.type === "envelope") return k.content;
  return null;
}

export function* walk(node, parent = null) {
  yield { node, parent };
  const kids = childrenOf(node);
  if (kids) for (const c of kids) yield* walk(c, node);
}

export function indexNodes(file) {
  const map = new Map();
  const parent = new Map();
  for (const layer of file.document.layers) {
    for (const { node, parent: p } of walk(layer)) {
      map.set(node.id, node);
      parent.set(node.id, p);
    }
  }
  return { map, parent };
}

export function artboardBounds(file) {
  let b = null;
  for (const a of file.document.artboards) b = union(b, a.rect);
  return b || { x0: 0, y0: 0, x1: 800, y1: 600 };
}

export function nodeBounds(node) {
  if (!node?.visible && node?.visible !== undefined && node.kind?.type !== "layer") {
    // still compute; callers filter visibility
  }
  const k = node.kind;
  if (!k) return null;
  if (k.type === "path") return pathBounds(k.path);
  if (k.type === "text") return textBounds(k);
  if (k.type === "mesh") {
    let b = null;
    for (const p of k.points || []) b = include(b, p.p);
    return b;
  }
  const kids = childrenOf(node);
  if (kids) {
    let b = null;
    for (const c of kids) if (c.visible !== false) b = union(b, nodeBounds(c));
    return b;
  }
  return null;
}

/** Typographic box of point type: font em-box, tracking on every character (including the last). */
function textBounds(k) {
  const xf = k.xf || ident();
  const runs = k.runs || [];
  const st = runs[0]?.style || {};
  const size = st.size || 12;
  const text = runs.map((r) => r.text || "").join("");
  const tracking = st.tracking || 0;
  const metrics = metricsFor(st.font_family, st.font_style);
  let w;
  let ascent;
  let descent;
  if (metrics) {
    w = measureWidth(metrics, text, size, tracking);
    const box = typoBox(metrics, size);
    ascent = box.ascent;
    descent = box.descent;
  } else {
    const n = Math.max(1, [...text].length);
    w = n * size * 0.55 + (tracking / 1000) * size * n;
    ascent = size * 0.8;
    descent = size * 0.22;
  }
  const justify = k.para?.justify || "Left";
  const xLocal = justify === "Center" ? -w / 2 : justify === "Right" ? -w : 0;
  const corners = [
    { x: xLocal, y: -ascent },
    { x: xLocal + w, y: -ascent },
    { x: xLocal + w, y: descent },
    { x: xLocal, y: descent },
  ].map((p) => applyXf(xf, p));
  return boundsOf(corners);
}

export function selectionBounds(file, ids) {
  const { map } = indexNodes(file);
  let b = null;
  for (const id of ids) {
    const n = map.get(id);
    if (n) b = union(b, nodeBounds(n));
  }
  return b;
}

export function fillsOf(node) {
  return (node?.appearance?.items || []).filter((it) => it.kind === "fill");
}
export function strokesOf(node) {
  return (node?.appearance?.items || []).filter((it) => it.kind === "stroke");
}
export function primaryFill(node) {
  const f = fillsOf(node).find((it) => it.visible !== false && it.paint?.type !== "none");
  return f?.paint || nonePaint();
}
export function primaryStroke(node) {
  const s = strokesOf(node).find((it) => it.visible !== false);
  return s || null;
}

export function objectLabel(node) {
  if (!node) return "No Selection";
  if (node.name) return node.name;
  const t = node.kind?.type;
  if (t === "path") {
    const live = node.kind.live?.shape;
    if (live === "rectangle") return "Rectangle";
    if (live === "ellipse") return "Ellipse";
    if (live === "polygon") return "Polygon";
    if (live === "star") return "Star";
    if (live === "line") return "Line";
    const sp = node.kind.path?.subpaths || [];
    if (sp.length > 1) return "Compound Path";
    if (sp[0] && !sp[0].closed) return "Path";
    return "Path";
  }
  if (t === "text") return "Type";
  if (t === "group") return node.kind.clip ? "Clip Group" : "Group";
  if (t === "blend") return "Blend";
  if (t === "mesh") return "Gradient Mesh";
  if (t === "repeat") return "Repeat";
  if (t === "envelope") return "Envelope";
  if (t === "compound") return "Compound Path";
  if (t === "layer") return node.name || "Layer";
  return t || "Object";
}

function mapDescPaths(node, fn) {
  const k = node.kind;
  if (!k) return;
  if (k.type === "path" && k.path) fn(k.path, node);
  if (k.type === "text" && k.xf) {
    // caller handles text
  }
  if (k.type === "mesh" && k.points) {
    for (const p of k.points) {
      p.p = fn.point ? fn.point(p.p) : p.p;
      if (fn.point && p.handles) p.handles = p.handles.map((h) => fn.delta ? { x: h.x, y: h.y } : h);
    }
  }
  const kids = childrenOf(node);
  if (kids) for (const c of kids) mapDescPaths(c, fn);
}

export function translateNode(node, dx, dy) {
  if (!dx && !dy) return;
  const k = node.kind;
  if (k?.type === "path" && k.path) {
    translatePath(k.path, dx, dy);
    if (k.live?.xf) k.live.xf = mulXf(translateXf(dx, dy), k.live.xf);
  } else if (k?.type === "text") {
    const xf = k.xf || ident();
    xf[4] += dx; xf[5] += dy;
    k.xf = xf;
  } else if (k?.type === "mesh") {
    for (const p of k.points || []) { p.p.x += dx; p.p.y += dy; }
  } else if (k?.type === "repeat") {
    if (k.kind?.center) { k.kind.center.x += dx; k.kind.center.y += dy; }
    for (const c of k.source || []) translateNode(c, dx, dy);
  } else {
    const kids = childrenOf(node);
    if (kids) for (const c of kids) translateNode(c, dx, dy);
  }
}

export function transformNode(node, xf) {
  const k = node.kind;
  if (k?.type === "path" && k.path) {
    for (const sp of k.path.subpaths) {
      for (const a of sp.anchors) {
        a.p = applyXf(xf, a.p);
        a.in = applyXf(xf, a.in);
        a.out = applyXf(xf, a.out);
      }
    }
    if (k.live) delete k.live;
  } else if (k?.type === "text") {
    k.xf = mulXf(xf, k.xf || ident());
  } else if (k?.type === "mesh") {
    for (const p of k.points || []) {
      const np = applyXf(xf, p.p);
      if (p.handles) {
        p.handles = p.handles.map((h) => {
          const q = applyXf(xf, { x: p.p.x + h.x, y: p.p.y + h.y });
          return { x: q.x - np.x, y: q.y - np.y };
        });
      }
      p.p = np;
    }
  } else {
    const kids = childrenOf(node);
    if (kids) for (const c of kids) transformNode(c, xf);
    if (k?.type === "repeat" && k.kind?.center) k.kind.center = applyXf(xf, k.kind.center);
  }
}

export function scaleStroke(node, factor) {
  const s = primaryStroke(node);
  if (s && s.width) s.width = Math.max(0, s.width * factor);
  const kids = childrenOf(node);
  if (kids) for (const c of kids) scaleStroke(c, factor);
}

export function setPaint(node, which, paint) {
  const items = node.appearance?.items || (node.appearance = { items: [] }).items;
  let it = items.find((x) => x.kind === which);
  if (!it) {
    it = which === "fill"
      ? { kind: "fill", paint, opacity: 1, blend: "Normal", visible: true }
      : strokeItem(paint, 1);
    if (which === "fill") items.unshift(it); else items.push(it);
  }
  it.paint = paint;
  it.visible = true;
}

export function setOpacity(node, opacity) { node.opacity = opacity; }
export function setBlend(node, blend) { node.blend = blend; }

export function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

export function removeNodes(file, ids) {
  const want = new Set(ids);
  const strip = (list) => {
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      if (want.has(list[i].id)) list.splice(i, 1);
      else {
        const kids = childrenOf(list[i]);
        if (kids) strip(kids);
      }
    }
  };
  strip(file.document.layers);
}

export function duplicateNodes(file, ids) {
  const { map, parent } = indexNodes(file);
  const created = [];
  // duplicate top-most selected only (skip if ancestor also selected)
  const tops = ids.filter((id) => {
    let p = parent.get(id);
    while (p) {
      if (ids.includes(p.id)) return false;
      p = parent.get(p.id);
    }
    return map.has(id) && map.get(id).kind?.type !== "layer";
  });
  for (const id of tops) {
    const node = map.get(id);
    const par = parent.get(id);
    const list = childrenOf(par);
    if (!list) continue;
    const copy = deepClone(node);
    reassignIds(file, copy);
    translateNode(copy, 12, 12);
    const idx = list.findIndex((n) => n.id === id);
    list.splice(idx + 1, 0, copy);
    created.push(copy.id);
  }
  return created;
}

function reassignIds(file, node) {
  node.id = allocId(file);
  const kids = childrenOf(node);
  if (kids) for (const c of kids) reassignIds(file, c);
}

export function groupNodes(file, ids) {
  if (ids.length < 1) return null;
  const { map, parent } = indexNodes(file);
  const tops = ids.filter((id) => {
    let p = parent.get(id);
    while (p) { if (ids.includes(p.id)) return false; p = parent.get(p.id); }
    return map.has(id) && map.get(id).kind?.type !== "layer";
  });
  if (!tops.length) return null;
  const firstParent = parent.get(tops[0]);
  if (!firstParent || tops.some((id) => parent.get(id)?.id !== firstParent.id)) return null;
  const list = childrenOf(firstParent);
  const picked = tops.map((id) => map.get(id));
  const indexes = picked.map((n) => list.indexOf(n)).filter((i) => i >= 0).sort((a, b) => a - b);
  const min = indexes[0];
  for (const i of indexes.slice().reverse()) list.splice(i, 1);
  const g = blankNode(allocId(file), { type: "group", children: picked, clip: false }, { items: [] });
  g.name = "Group";
  list.splice(min, 0, g);
  return g.id;
}

export function ungroup(file, ids) {
  const { map, parent } = indexNodes(file);
  const out = [];
  for (const id of ids) {
    const n = map.get(id);
    if (n?.kind?.type !== "group") continue;
    const par = parent.get(id);
    const list = childrenOf(par);
    if (!list) continue;
    const i = list.indexOf(n);
    const kids = n.kind.children || [];
    list.splice(i, 1, ...kids);
    out.push(...kids.map((c) => c.id));
  }
  return out;
}

export function reorder(file, id, dir) {
  const { parent } = indexNodes(file);
  const par = parent.get(id);
  const list = childrenOf(par);
  if (!list) return;
  const i = list.findIndex((n) => n.id === id);
  if (i < 0) return;
  const j = dir === "front" ? list.length - 1 : dir === "back" ? 0 : dir === "forward" ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
  if (i === j) return;
  const [n] = list.splice(i, 1);
  list.splice(j, 0, n);
}

export function alignNodes(file, ids, h, v) {
  const { map } = indexNodes(file);
  const nodes = ids.map((id) => map.get(id)).filter((n) => n && n.kind?.type !== "layer");
  if (nodes.length < 2 && !(h || v)) return;
  const boxes = nodes.map((n) => ({ n, b: nodeBounds(n) })).filter((x) => x.b);
  if (boxes.length < 1) return;
  let u = null;
  for (const x of boxes) u = union(u, x.b);
  for (const { n, b } of boxes) {
    let dx = 0, dy = 0;
    if (h === "left") dx = u.x0 - b.x0;
    if (h === "center") dx = (u.x0 + u.x1) / 2 - (b.x0 + b.x1) / 2;
    if (h === "right") dx = u.x1 - b.x1;
    if (v === "top") dy = u.y0 - b.y0;
    if (v === "center") dy = (u.y0 + u.y1) / 2 - (b.y0 + b.y1) / 2;
    if (v === "bottom") dy = u.y1 - b.y1;
    translateNode(n, dx, dy);
  }
}

export function activeLayer(file, preferId) {
  const layers = file.document.layers.filter((l) => l.visible !== false && !l.locked);
  if (preferId) {
    const hit = layers.find((l) => l.id === preferId);
    if (hit) return hit;
  }
  return layers[layers.length - 1] || file.document.layers[file.document.layers.length - 1];
}

export function addToLayer(file, node, layerId) {
  const layer = activeLayer(file, layerId);
  layer.kind.children.push(node);
  return node;
}

export function makePathNode(file, path, { fill, stroke, strokeWidth = 1, name, live } = {}) {
  const appearance = defaultAppearance(fill || solid(0.15, 0.45, 0.95), stroke || nonePaint(), strokeWidth);
  const kind = { type: "path", path, rule: "NonZero", clipping: false, guide: false };
  if (live) kind.live = live;
  const node = blankNode(allocId(file), kind, appearance);
  if (name) node.name = name;
  return node;
}

export function makeRect(file, x, y, w, h, style, radii = [0, 0, 0, 0]) {
  const path = pathFromAnchors([
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
  ], true);
  return makePathNode(file, path, {
    ...style,
    name: "Rectangle",
    live: { shape: "rectangle", w: Math.abs(w), h: Math.abs(h), radii, xf: [1, 0, 0, 1, Math.min(x, x + w), Math.min(y, y + h)] },
  });
}

export function makeEllipse(file, x, y, w, h, style) {
  const path = ellipsePath(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2);
  return makePathNode(file, path, { ...style, name: "Ellipse", live: { shape: "ellipse", w: Math.abs(w), h: Math.abs(h), xf: ident() } });
}

export function makePolygon(file, cx, cy, r, sides, style) {
  return makePathNode(file, polygonPath(cx, cy, r, sides), { ...style, name: "Polygon", live: { shape: "polygon", sides, radius: r } });
}

export function makeStar(file, cx, cy, r, points, inner, style) {
  return makePathNode(file, starPath(cx, cy, r, points, inner), { ...style, name: "Star", live: { shape: "star", points, radius: r, inner } });
}

export function makeLine(file, x0, y0, x1, y1, style) {
  const node = makePathNode(file, linePath(x0, y0, x1, y1), { ...style, fill: nonePaint(), name: "Line" });
  if (style?.stroke?.type === "none" || !style?.stroke) setPaint(node, "stroke", solid(0, 0, 0));
  const s = primaryStroke(node);
  if (s && (!s.width || s.paint?.type === "none")) {
    s.paint = style?.stroke?.type && style.stroke.type !== "none" ? style.stroke : solid(0, 0, 0);
    s.width = style?.strokeWidth || 1;
  }
  return node;
}

export function makeText(file, x, y, text, style = {}) {
  const size = style.size || 24;
  const node = blankNode(allocId(file), {
    type: "text",
    kind: { kind: "point" },
    xf: [1, 0, 0, 1, x, y],
    runs: [{
      text,
      style: {
        font_family: style.family || "Source Sans 3",
        font_style: style.fontStyle || "Regular",
        size,
        tracking: style.tracking || 0,
        baseline_shift: 0,
        h_scale: 100,
        v_scale: 100,
        rotation: 0,
        fill: style.fill || solid(0.1, 0.1, 0.12),
        stroke: nonePaint(),
        stroke_width: 0,
        underline: false,
        strikethrough: false,
        all_caps: false,
      },
    }],
    para: { justify: "Left", left_indent: 0, right_indent: 0, first_line_indent: 0, space_before: 0, space_after: 0, hyphenate: false },
  }, { items: [] });
  node.name = "Type";
  return node;
}

export function setText(node, text) {
  if (node?.kind?.type !== "text") return;
  if (!node.kind.runs?.length) return;
  node.kind.runs[0].text = text;
}

export function textOf(node) {
  if (node?.kind?.type !== "text") return "";
  return (node.kind.runs || []).map((r) => r.text || "").join("");
}

export function lockNodes(file, ids, locked) {
  const { map } = indexNodes(file);
  for (const id of ids) {
    const n = map.get(id);
    if (n && n.kind?.type !== "layer") n.locked = locked;
  }
}
export function hideNodes(file, ids, hidden) {
  const { map } = indexNodes(file);
  for (const id of ids) {
    const n = map.get(id);
    if (n && n.kind?.type !== "layer") n.visible = !hidden;
  }
}
export function unlockAll(file) {
  for (const layer of file.document.layers) {
    for (const { node } of walk(layer)) node.locked = false;
  }
}
export function showAll(file) {
  for (const layer of file.document.layers) {
    for (const { node } of walk(layer)) node.visible = true;
  }
}

export function invertColors(node) {
  const paint = (p) => {
    if (!p || p.type !== "solid" || !p.color) return;
    const c = p.color;
    if (c.model === "rgb") { c.r = 1 - c.r; c.g = 1 - c.g; c.b = 1 - c.b; }
  };
  for (const it of node.appearance?.items || []) paint(it.paint);
  if (node.kind?.type === "text") for (const r of node.kind.runs || []) paint(r.style?.fill);
  const kids = childrenOf(node);
  if (kids) for (const c of kids) invertColors(c);
}

export function toGray(node) {
  const paint = (p) => {
    if (!p || p.type !== "solid" || !p.color) return;
    const c = p.color;
    const r = c.r ?? 0, g = c.g ?? 0, b = c.b ?? 0;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    p.color = { model: "gray", k: 1 - y };
  };
  for (const it of node.appearance?.items || []) paint(it.paint);
  const kids = childrenOf(node);
  if (kids) for (const c of kids) toGray(c);
}

export function collectTop(file, ids) {
  const { map, parent } = indexNodes(file);
  return ids.filter((id) => {
    let p = parent.get(id);
    while (p) { if (ids.includes(p.id)) return false; p = parent.get(p.id); }
    return map.has(id);
  }).map((id) => map.get(id));
}

export function snapshot(file) { return JSON.stringify(file.document); }
export function restore(file, snap) { file.document = JSON.parse(snap); }

export function layerColor(preset) {
  const colors = ["#4f80ff", "#e8573f", "#3dba7c", "#f0a030", "#b07cff", "#30c0c0", "#f06aa0", "#8a8a8a"];
  const i = typeof preset === "number" ? preset : preset?.Preset ?? 0;
  return colors[i % colors.length];
}

export function countObjects(file) {
  let n = 0;
  for (const layer of file.document.layers) {
    for (const { node } of walk(layer)) if (node.kind?.type !== "layer") n++;
  }
  return n;
}

export { subpathBounds, pathBounds, boundsOf };
