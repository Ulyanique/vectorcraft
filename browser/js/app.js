import {
  applyXf, center, clamp, contains, dist, ellipsePath, flattenPath, hitFill, hitStroke,
  ident, linePath, mulXf, offsetRing, pathBounds, pathD, pathFromAnchors, polygonPath, rgbCss, rgbToHex,
  hexToRgb, rotateXf, roundedRectPath, scaleXf, simplify, starPath, translateXf, union,
} from "./geom.js";
import {
  activeLayer, addToLayer, alignNodes, allocId, artboardBounds, blankNode, childrenOf, collectTop,
  deepClone, defaultAppearance, duplicateNodes, groupNodes, hideNodes, indexNodes, loadFile, lockNodes,
  makeEllipse, makeLine, makePathNode, makePolygon, makeRect, makeStar, makeText, newFile,
  nodeBounds, nonePaint, objectLabel, primaryFill, primaryStroke, removeNodes, reorder,
  restore, selectionBounds, setBlend, setOpacity, setPaint, setText, showAll, snapshot,
  solid, textOf, translateNode, transformNode, ungroup, unlockAll, fillsOf,
} from "./model.js";
import { loadFontMetrics } from "./fontmetrics.js";
import { artboardSVG, blendHit, expandBlend, renderDocument } from "./render.js";
import { polygonBoolean } from "./bool.js";
import { icon } from "./icons.js";
import { createLayers, layerColorCss } from "./layers-panel.js";
import {
  readGrid, gridOverlay, widgetGeom, widgetHit, gridHandles, dragHandle, depthAt, setOffset,
  moveMap, walkPoints, planeBounds, planeColor, defaultGrid, pagePoint, unproject,
} from "./perspective.js";
import { importSVG } from "./svg.js";

const SVGNS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const TOOL_DEFS = [
  { cat: "Select", slots: [
    { id: "selection", label: "Selection Tool", key: "V", icon: "selection" },
    { id: "directSelection", label: "Direct Selection Tool", key: "A", icon: "directSelection", flyout: [
      { id: "groupSelection", label: "Group Selection Tool", icon: "groupSelection" },
    ] },
    { id: "lasso", label: "Lasso Tool", key: "Q", icon: "lasso", flyout: [
      { id: "magicWand", label: "Magic Wand", key: "Y", icon: "magicWand" },
    ] },
  ] },
  { cat: "Shapes", slots: [
    { id: "rectangle", label: "Rectangle Tool", key: "M", icon: "rectangle", flyout: [
      { id: "roundedRectangle", label: "Rounded Rectangle Tool", icon: "roundedRectangle" },
      { id: "star", label: "Star Tool", icon: "star" },
      { id: "lineSegment", label: "Line Segment Tool", key: "\\", icon: "lineSegment" },
    ] },
    { id: "ellipse", label: "Ellipse Tool", key: "L", icon: "ellipse" },
    { id: "polygon", label: "Polygon Tool", icon: "polygon" },
    { id: "shaper", label: "Shaper Tool", icon: "shaper" },
  ] },
  { cat: "Draw", slots: [
    { id: "pencil", label: "Pencil Tool", key: "N", icon: "pencil", flyout: [
      { id: "smooth", label: "Smooth Tool", icon: "smooth" },
    ] },
    { id: "eraser", label: "Eraser Tool", icon: "eraser" },
    { id: "paintbrush", label: "Paintbrush Tool", key: "B", icon: "paintbrush" },
    { id: "pen", label: "Pen Tool", key: "P", icon: "pen", flyout: [
      { id: "addAnchor", label: "Add Anchor Point Tool", key: "+", icon: "addAnchor" },
      { id: "deleteAnchor", label: "Delete Anchor Point Tool", key: "-", icon: "deleteAnchor" },
      { id: "anchorPoint", label: "Anchor Point Tool", icon: "anchorPoint" },
    ] },
    { id: "curvature", label: "Curvature Tool", icon: "curvature" },
  ] },
  { cat: "Modify", slots: [
    { id: "width", label: "Width Tool", icon: "width" },
    { id: "rotate", label: "Rotate Tool", key: "R", icon: "rotate", flyout: [
      { id: "reflect", label: "Reflect Tool", key: "O", icon: "reflect" },
      { id: "scale", label: "Scale Tool", key: "S", icon: "scale" },
      { id: "shear", label: "Shear Tool", icon: "shear" },
    ] },
    { id: "shapeBuilder", label: "Shape Builder Tool", icon: "shapeBuilder", flyout: [
      { id: "blend", label: "Blend Tool", key: "W", icon: "blend" },
    ] },
    { id: "perspectiveGrid", label: "Perspective Grid Tool", key: "Shift+P", icon: "perspective", flyout: [
      { id: "perspectiveSelection", label: "Perspective Selection Tool", key: "Shift+V", icon: "perspectiveSelection" },
    ] },
  ] },
  { cat: "Type", slots: [
    { id: "areaType", label: "Area Type Tool", icon: "areaType", flyout: [
      { id: "typeOnPath", label: "Type on a Path Tool", icon: "typeOnPath" },
    ] },
    { id: "type", label: "Type Tool", key: "T", icon: "type", flyout: [
      { id: "verticalType", label: "Vertical Type Tool", icon: "verticalType" },
    ] },
  ] },
  { cat: "Navigate", slots: [
    { id: "zoom", label: "Zoom Tool", key: "Z", icon: "zoom" },
    { id: "hand", label: "Hand Tool", key: "H", icon: "hand" },
    { id: "rotateView", label: "Rotate View Tool", icon: "rotateView" },
  ] },
  { cat: "Color", slots: [
    { id: "gradient", label: "Gradient Tool", key: "G", icon: "gradient", flyout: [
      { id: "mesh", label: "Mesh Tool", key: "U", icon: "mesh" },
    ] },
    { id: "eyedropper", label: "Eyedropper Tool", key: "I", icon: "eyedropper" },
  ] },
];

const ALL_TOOLS = TOOL_DEFS.flatMap((c) => c.slots.flatMap((s) => [s, ...(s.flyout || [])]));
const toolById = (id) => ALL_TOOLS.find((t) => t.id === id);

const PANEL_META = {
  color: ["Color", "palette"], colorGuide: ["Color Guide", "colorGuide"], swatches: ["Swatches", "swatches"],
  brushes: ["Brushes", "brushes"], symbols: ["Symbols", "symbols"], stroke: ["Stroke", "stroke"],
  gradient: ["Gradient", "gradient"], transparency: ["Transparency", "transparency"],
  appearance: ["Appearance", "appearance"], graphicStyles: ["Graphic Styles", "graphicStyles"],
  artboards: ["Artboards", "artboards"], transform: ["Transform", "transform"], align: ["Align", "align"],
  pathfinder: ["Pathfinder", "pathfinder"], character: ["Character", "character"], paragraph: ["Paragraph", "paragraph"],
  history: ["History", "history"], actions: ["Actions", "actions"], info: ["Info", "info"], navigator: ["Navigator", "navigator"],
  properties: ["Properties", "align"], layers: ["Layers", "rectangle"], libraries: ["Libraries", "swatches"],
};
const ICON_GROUPS = [
  ["color", "colorGuide"],
  ["swatches", "brushes", "symbols"],
  ["stroke", "gradient", "transparency"],
  ["appearance", "graphicStyles"],
  ["artboards"],
  ["transform", "align", "pathfinder"],
  ["character", "paragraph"],
  ["history", "actions", "info", "navigator"],
];
const RAIL = Object.entries(PANEL_META).map(([id, [label, icon]]) => ({ id, label, icon }));

const EXAMPLES = [
  { file: "ribbons.vectorcraft", title: "Ribbons", note: "Live blends" },
  { file: "neon-drive.vectorcraft", title: "Neon Drive", note: "Type & glow" },
  { file: "dusk-poster.vectorcraft", title: "Dusk Poster", note: "Poster" },
  { file: "feature-sheet.vectorcraft", title: "Feature Sheet", note: "Mesh, repeat, warp" },
  { file: "perspective-city.vectorcraft", title: "Perspective City", note: "Line art" },
];

const ui = {
  theme: "mediumDark",
  tool: "selection",
  slotChoice: {},
  fill: solid(1, 1, 1),
  stroke: solid(0, 0, 0),
  strokeWidth: 1,
  paintTarget: "fill",
  rulers: false,
  grid: false,
  snap: true,
  outline: false,
  control: false,
  panel: "properties",
  panels: true,
  labels: true,
  home: false,
  docs: [],
  active: -1,
  clipboard: null,
  pen: null,
  blendPick: null,
  guides: null,
  space: false,
  query: "",
  drawMode: "normal",
  drawInside: null,
  screen: false,
  refPoint: 4,
  appearPin: null,
  snapPoint: true,
  snapGrid: false,
  showGuides: true,
  smartGuides: true,
  transGrid: false,
  scaleStrokes: false,
  moveArt: false,
  keyInc: 1,
};

const gesture = { on: false };

function doc() { return ui.docs[ui.active] || null; }
function file() { return doc()?.file || null; }

function pushHistory() {
  const d = doc();
  if (!d) return;
  d.history.push(snapshot(d.file));
  if (d.history.length > 80) d.history.shift();
  d.future = [];
  d.dirty = true;
  layersApi()?.clearThumbs();
}
function undo() {
  const d = doc();
  if (!d?.history.length) return;
  d.future.push(snapshot(d.file));
  restore(d.file, d.history.pop());
  d.selection = d.selection.filter((id) => indexNodes(d.file).map.has(id));
  layersApi()?.clearThumbs();
  paint();
  refreshChrome();
}
function redo() {
  const d = doc();
  if (!d?.future.length) return;
  d.history.push(snapshot(d.file));
  restore(d.file, d.future.pop());
  layersApi()?.clearThumbs();
  paint();
  refreshChrome();
}
let _layers;
function layersApi() {
  if (!_layers) {
    _layers = createLayers({
      $, esc, toast, doc, file, ui,
      pushHistory, paint, paintOverlay, refreshChrome, drawPanel, drawTaskbar, status, syncProxyFromSelection,
    });
  }
  return _layers;
}

function selectedNodes() {
  const f = file();
  if (!f) return [];
  const { map } = indexNodes(f);
  return collectTop(f, doc().selection).map((id) => map.get(id)).filter(Boolean);
}

function styleNow() {
  return { fill: deepClone(ui.fill), stroke: deepClone(ui.stroke), strokeWidth: ui.strokeWidth };
}

function syncProxyFromSelection() {
  const n = selectedNodes()[0];
  if (!n) return;
  const f = shownFill(n);
  const s = shownStroke(n);
  ui.fill = deepClone(f?.type ? f : nonePaint());
  if (s?.paint?.type && s.paint.type !== "none" && (s.width ?? 1) > 0) {
    ui.stroke = deepClone(s.paint);
    ui.strokeWidth = s.width || 1;
  } else {
    ui.stroke = nonePaint();
    ui.strokeWidth = s?.width || 0;
  }
  drawToolbar();
}

/** Fill the proxy and Properties show: a type object's character fill when the stack has none. */
function shownFill(n) {
  if (!n) return nonePaint();
  const item = (n.appearance?.items || []).find((it) => it.kind === "fill" && it.visible !== false);
  if (item?.paint) return item.paint;
  if (n.kind?.type === "text") return n.kind.runs?.[0]?.style?.fill || nonePaint();
  return primaryFill(n);
}
function shownStroke(n) {
  if (!n) return null;
  const item = (n.appearance?.items || []).find((it) => it.kind === "stroke" && it.visible !== false);
  if (item) return item;
  if (n.kind?.type === "text") {
    const st = n.kind.runs?.[0]?.style || {};
    return { paint: st.stroke || nonePaint(), width: st.stroke_width || 0 };
  }
  return primaryStroke(n);
}

function applyPaint(which, paint) {
  const f = file();
  if (!f || !doc().selection.length) {
    if (which === "fill") ui.fill = deepClone(paint);
    else ui.stroke = deepClone(paint);
    drawToolbar();
    return;
  }
  pushHistory();
  const { map } = indexNodes(f);
  for (const id of doc().selection) {
    const n = map.get(id);
    if (n) setPaint(n, which, deepClone(paint));
  }
  if (which === "fill") ui.fill = deepClone(paint);
  else ui.stroke = deepClone(paint);
  paint();
  refreshChrome();
}

function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.style.display = "none"; }, 2200);
}

function closePops() {
  document.querySelectorAll(".menu,.flyout,.pop,.palette").forEach((n) => n.remove());
}

/* ---------- view ---------- */

function screenToDoc(sx, sy) {
  const d = doc();
  if (!d) return { x: sx, y: sy };
  const a = -(d.viewRot || 0) * Math.PI / 180;
  const x = sx - d.panX, y = sy - d.panY;
  const rx = x * Math.cos(a) - y * Math.sin(a);
  const ry = x * Math.sin(a) + y * Math.cos(a);
  return { x: rx / d.zoom, y: ry / d.zoom };
}
function docToScreen(p) {
  const d = doc();
  if (!d) return { x: p.x, y: p.y };
  const a = (d.viewRot || 0) * Math.PI / 180;
  const x = p.x * d.zoom, y = p.y * d.zoom;
  return { x: x * Math.cos(a) - y * Math.sin(a) + d.panX, y: x * Math.sin(a) + y * Math.cos(a) + d.panY };
}
function viewTransform() {
  const d = doc();
  return `translate(${d.panX} ${d.panY}) rotate(${d.viewRot || 0}) scale(${d.zoom})`;
}

function zoomAt(sx, sy, factor) {
  const d = doc();
  if (!d) return;
  const before = screenToDoc(sx, sy);
  d.zoom = clamp(d.zoom * factor, 0.02, 64);
  const a = (d.viewRot || 0) * Math.PI / 180;
  const x = before.x * d.zoom, y = before.y * d.zoom;
  d.panX = sx - (x * Math.cos(a) - y * Math.sin(a));
  d.panY = sy - (x * Math.sin(a) + y * Math.cos(a));
  paint();
  refreshChrome();
}

function fit(which = "all") {
  const d = doc();
  if (!d) return;
  const c = $("canvas");
  const w = c.clientWidth || 800, h = c.clientHeight || 600;
  let b;
  if (which === "sel") b = selectionBounds(d.file, d.selection);
  else if (which === "art") b = d.file.document.artboards[d.artboard]?.rect;
  else b = artboardBounds(d.file);
  if (!b) return;
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  d.zoom = clamp(Math.min(w / bw, h / bh) * 0.86, 0.02, 64);
  d.viewRot = 0;
  d.panX = (w - bw * d.zoom) / 2 - b.x0 * d.zoom;
  d.panY = (h - bh * d.zoom) / 2 - b.y0 * d.zoom;
  paint();
  refreshChrome();
}

function paint() {
  const art = $("art");
  const d = doc();
  if (!d) { art.innerHTML = ""; $("overlay").innerHTML = ""; return; }
  const rendered = renderDocument(d.file, { mode: ui.outline ? "outline" : "preview" });
  const boards = (d.file.document.artboards || []).map((a, i) => {
    const r = a.rect, w = r.x1 - r.x0, h = r.y1 - r.y0;
    const on = i === d.artboard;
    // Hard 2 px drop shadow, right and bottom (measured: alpha 26 then 52 on #606060).
    const s1 = 1 / d.zoom, s2 = 2 / d.zoom;
    const edge = ` stroke="${on ? "#111" : "#787878"}" stroke-width="${(on ? 1 : 0.6) / d.zoom}"`;
    return `<g data-artboard="${a.id}">
      <rect x="${r.x0 + s2}" y="${r.y0 + s2}" width="${w}" height="${h}" fill="rgba(0,0,0,0.102)"/>
      <rect x="${r.x0 + s1}" y="${r.y0 + s1}" width="${w}" height="${h}" fill="rgba(0,0,0,0.204)"/>
      <rect x="${r.x0}" y="${r.y0}" width="${w}" height="${h}" fill="${ui.transGrid ? "url(#tgrid)" : "#fff"}"${edge}/>
    </g>`;
  }).join("");
  let grid = "";
  if (ui.grid) {
    const bounds = artboardBounds(d.file);
    const step = 32;
    const lines = [];
    for (let x = Math.floor(bounds.x0 / step) * step; x <= bounds.x1; x += step) lines.push(`<line x1="${x}" y1="${bounds.y0}" x2="${x}" y2="${bounds.y1}" stroke="#000" stroke-opacity=".12" stroke-width="${1 / d.zoom}"/>`);
    for (let y = Math.floor(bounds.y0 / step) * step; y <= bounds.y1; y += step) lines.push(`<line x1="${bounds.x0}" y1="${y}" x2="${bounds.x1}" y2="${y}" stroke="#000" stroke-opacity=".12" stroke-width="${1 / d.zoom}"/>`);
    grid = lines.join("");
  }
  const checker = ui.transGrid ? `<pattern id="tgrid" width="${16}" height="${16}" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#fff"/><rect width="8" height="8" fill="#d9d9d9"/><rect x="8" y="8" width="8" height="8" fill="#d9d9d9"/></pattern>` : "";
  art.innerHTML = `<defs>
    ${checker}${rendered.defs}
  </defs>
  <g id="view" transform="${viewTransform()}">${boards}${grid}${rendered.body}<g id="live-preview"></g></g>`;
  paintOverlay();
  paintRulers();
}

function paintOverlay() {
  const ov = $("overlay");
  const d = doc();
  if (!d) { ov.innerHTML = ""; return; }
  const parts = [];
  if (d.selection.length && ui.tool !== "artboard") {
    const { map, parent } = indexNodes(d.file);
    const outlines = [];
    for (const id of d.selection) {
      const n = map.get(id);
      if (!n) continue;
      let layer = n;
      while (layer && layer.kind?.type !== "layer") layer = parent.get(layer.id);
      outlines.push(pathOutline(n, layer ? layerColorCss(layer) : "#4f80ff"));
    }
    const body = outlines.filter(Boolean).join("");
    if (body) parts.push(`<g transform="${viewTransform()}">${body}</g>`);
  }
  const b0 = selectionBounds(d.file, d.selection);
  const nudge = gesture.on && gesture.mode === "move" ? { x: gesture.dx || 0, y: gesture.dy || 0 } : { x: 0, y: 0 };
  const b = b0 ? { x0: b0.x0 + nudge.x, y0: b0.y0 + nudge.y, x1: b0.x1 + nudge.x, y1: b0.y1 + nudge.y } : null;
  const perspSel = ui.tool === "perspectiveSelection" && d.selection.some((id) => indexNodes(d.file).map.get(id)?.perspective?.plane);
  if (b && !perspSel && ui.tool !== "directSelection" && ui.tool !== "groupSelection" && ui.tool !== "artboard") {
    const p0 = docToScreen({ x: b.x0, y: b.y0 }), p1 = docToScreen({ x: b.x1, y: b.y1 });
    const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
    const w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#4f80ff" stroke-width="1"/>`);
    const hs = handles(b);
    for (const hnd of hs) {
      const s = docToScreen(hnd);
      parts.push(`<rect x="${s.x - 3.5}" y="${s.y - 3.5}" width="7" height="7" fill="#fff" stroke="#4f80ff" stroke-width="1"/>`);
    }
    const top = docToScreen({ x: (b.x0 + b.x1) / 2, y: b.y0 });
    const rot = { x: top.x, y: top.y - 22 };
    parts.push(`<line x1="${top.x}" y1="${top.y}" x2="${rot.x}" y2="${rot.y}" stroke="#4f80ff" stroke-width="1"/>`);
    parts.push(`<circle cx="${rot.x}" cy="${rot.y}" r="4" fill="#fff" stroke="#4f80ff"/>`);
  }
  if ((ui.tool === "directSelection" || ui.tool === "anchorPoint" || ui.tool === "deleteAnchor") && d.selection.length) {
    const { map, parent } = indexNodes(d.file);
    for (const id of d.selection) {
      const n = map.get(id);
      if (n?.kind?.type !== "path") continue;
      let layer = n;
      while (layer && layer.kind?.type !== "layer") layer = parent.get(layer.id);
      const color = layer ? layerColorCss(layer) : "#4f80ff";
      for (const sp of n.kind.path.subpaths || []) {
        for (const a of sp.anchors) {
          const s = docToScreen(a.p);
          if (!samePt(a.in, a.p)) {
            const hin = docToScreen(a.in);
            parts.push(`<line x1="${s.x}" y1="${s.y}" x2="${hin.x}" y2="${hin.y}" stroke="${color}" stroke-width="1"/><circle cx="${hin.x}" cy="${hin.y}" r="3" fill="#fff" stroke="${color}"/>`);
          }
          if (!samePt(a.out, a.p)) {
            const hout = docToScreen(a.out);
            parts.push(`<line x1="${s.x}" y1="${s.y}" x2="${hout.x}" y2="${hout.y}" stroke="${color}" stroke-width="1"/><circle cx="${hout.x}" cy="${hout.y}" r="3" fill="#fff" stroke="${color}"/>`);
          }
          parts.push(`<rect x="${s.x - 2.5}" y="${s.y - 2.5}" width="5" height="5" fill="${color}" stroke="${color}"/>`);
        }
      }
    }
  }
  if (ui.pen?.anchors?.length) {
    const pts = ui.pen.anchors.map((a) => docToScreen(a.p));
    if (gesture.cursor) pts.push(docToScreen(gesture.cursor));
    if (pts.length > 1) parts.push(`<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="#4f80ff" stroke-width="1.2"/>`);
    for (const p of pts.slice(0, ui.pen.anchors.length)) parts.push(`<rect x="${p.x - 3}" y="${p.y - 3}" width="6" height="6" fill="#fff" stroke="#4f80ff"/>`);
  }
  if (ui.showGuides !== false) {
    const boards = d.file.document.artboards || [];
    for (const g of d.file.document.guides || []) {
      const board = g.artboard != null ? boards.find((a) => a.id === g.artboard) : null;
      const r = board?.rect;
      if (g.vertical) {
        const x = docToScreen({ x: g.pos, y: 0 }).x;
        const y0 = r ? docToScreen({ x: 0, y: r.y0 }).y : 0;
        const y1 = r ? docToScreen({ x: 0, y: r.y1 }).y : 4000;
        parts.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="#3ec7ff" stroke-width="1"/>`);
      } else {
        const y = docToScreen({ x: 0, y: g.pos }).y;
        const x0 = r ? docToScreen({ x: r.x0, y: 0 }).x : 0;
        const x1 = r ? docToScreen({ x: r.x1, y: 0 }).x : 4000;
        parts.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#3ec7ff" stroke-width="1"/>`);
      }
    }
  }
  if (ui.guides) {
    if (ui.guides.x != null) {
      const s = docToScreen({ x: ui.guides.x, y: 0 });
      parts.push(`<line x1="${s.x}" y1="0" x2="${s.x}" y2="4000" stroke="#ff4fa3" stroke-width="1"/>`);
    }
    if (ui.guides.y != null) {
      const s = docToScreen({ x: 0, y: ui.guides.y });
      parts.push(`<line x1="0" y1="${s.y}" x2="4000" y2="${s.y}" stroke="#ff4fa3" stroke-width="1"/>`);
    }
  }
  if (gesture.marquee) {
    const a = gesture.marquee.a, b = gesture.marquee.b;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    parts.push(`<rect x="${x}" y="${y}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}" fill="rgba(79,128,255,.12)" stroke="#4f80ff" stroke-dasharray="3 2"/>`);
  }
  if (gesture.lasso?.length > 1) {
    parts.push(`<polyline points="${gesture.lasso.map((p) => `${p.x},${p.y}`).join(" ")}" fill="rgba(79,128,255,.1)" stroke="#4f80ff"/>`);
  }
  const boards = d.file.document.artboards || [];
  if (ui.tool === "artboard" && boards[d.artboard]) {
    const r = boards[d.artboard].rect;
    const p0 = docToScreen({ x: r.x0, y: r.y0 }), p1 = docToScreen({ x: r.x1, y: r.y1 });
    const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
    parts.push(`<rect x="${x}" y="${y}" width="${Math.abs(p1.x - p0.x)}" height="${Math.abs(p1.y - p0.y)}" fill="none" stroke="#4f80ff" stroke-dasharray="4 3"/>`);
  }
  // A single artboard is unlabeled unless the Artboard tool is up; several are numbered.
  if (boards.length > 1 || ui.tool === "artboard") {
    boards.forEach((a, i) => {
      const r = a.rect;
      const s = docToScreen({ x: r.x0, y: r.y0 });
      const name = boards.length > 1 ? `${String(i + 1).padStart(2, "0")} - ${a.name || "Artboard"}` : (a.name || "Artboard");
      parts.push(`<text x="${s.x}" y="${s.y - 6}" fill="#b0b0b0" font-size="11" font-family="Inter, sans-serif">${esc(name)}</text>`);
    });
  }
  paintPerspective(parts);
  ov.innerHTML = parts.join("");
}

function paintPerspective(parts) {
  const raw = readGrid(file());
  const geo = raw && gridOverlay(raw);
  if (!geo) return;
  const tol = 1 / (doc().zoom || 1);
  for (const pl of geo.planes) {
    for (const [a, b] of pl.lines) {
      const s0 = docToScreen(a), s1 = docToScreen(b);
      parts.push(`<line x1="${s0.x}" y1="${s0.y}" x2="${s1.x}" y2="${s1.y}" stroke="${pl.color}" stroke-opacity="${pl.opacity}" stroke-width="1"/>`);
    }
    if (pl.outline) {
      const pts = pl.outline.map((p) => docToScreen(p)).map((p) => `${p.x},${p.y}`).join(" ");
      parts.push(`<polygon points="${pts}" fill="none" stroke="${pl.color}" stroke-width="2"/>`);
    }
  }
  const h0 = docToScreen({ x: geo.horizonX0 - 50 * tol, y: geo.horizonY });
  const h1 = docToScreen({ x: geo.horizonX1 + 50 * tol, y: geo.horizonY });
  parts.push(`<line x1="${h0.x}" y1="${h0.y}" x2="${h1.x}" y2="${h1.y}" stroke="#606060" stroke-dasharray="4 3" stroke-width="1"/>`);
  for (const dmd of geo.diamonds) {
    const s = docToScreen(dmd.p);
    const r = 5;
    const pts = [[0, -r], [r, 0], [0, r], [-r, 0]].map(([x, y]) => `${s.x + x},${s.y + y}`).join(" ");
    parts.push(`<polygon points="${pts}" fill="${planeColor(dmd.plane)}" fill-opacity=".86" stroke="#202020" stroke-width="1"/>`);
  }
  if (ui.tool === "perspectiveGrid") {
    for (const h of gridHandles(raw, tol)) {
      const s = docToScreen(h.p);
      const filled = h.id.startsWith("vp") || h.id.startsWith("ground");
      const size = h.id.startsWith("ground") ? 5 : h.id.startsWith("vp") ? 7 : 6;
      parts.push(`<rect x="${s.x - size / 2}" y="${s.y - size / 2}" width="${size}" height="${size}" fill="${filled ? "#202020" : "#fff"}" stroke="#202020"/>`);
    }
  }
  paintPerspSelection(parts);
  const c = $("canvas");
  const w = widgetGeom(c?.clientWidth || 800, c?.clientHeight || 600);
  for (const face of w.faces) {
    const on = face.plane === geo.active;
    const pts = face.quad.map((p) => `${p.x},${p.y}`).join(" ");
    parts.push(`<polygon points="${pts}" fill="${planeColor(face.plane)}" fill-opacity="${on ? ".9" : ".27"}" stroke="#404040" stroke-width="1"/>`);
  }
  parts.push(`<circle cx="${w.dot.c.x}" cy="${w.dot.c.y}" r="${w.dot.r}" fill="none" stroke="${geo.active === "none" ? "#202020" : "#999"}" stroke-width="1.5"/>`);
}

function perspHandlePoints(box) {
  const mx = (box.x0 + box.x1) / 2, my = (box.y0 + box.y1) / 2;
  return [
    [box.x0, box.y0], [mx, box.y0], [box.x1, box.y0], [box.x1, my],
    [box.x1, box.y1], [mx, box.y1], [box.x0, box.y1], [box.x0, my],
  ];
}

function paintPerspSelection(parts) {
  if (ui.tool !== "perspectiveSelection") return;
  const raw = readGrid(file());
  if (!raw) return;
  const { map } = indexNodes(file());
  for (const id of doc().selection) {
    const n = map.get(id);
    const att = n?.perspective;
    if (!att?.plane) continue;
    const box = planeBounds(raw, n, att.plane, att.depth || 0);
    if (!box) continue;
    const corner = (x, y) => pagePoint(raw, att.plane, att.depth || 0, x, y);
    const pts = [corner(box.x0, box.y0), corner(box.x1, box.y0), corner(box.x1, box.y1), corner(box.x0, box.y1)].filter(Boolean);
    if (pts.length < 4) continue;
    const color = planeColor(att.plane);
    const spts = pts.map((p) => docToScreen(p));
    parts.push(`<polygon points="${spts.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${color}" stroke-width="1"/>`);
    const handles = [
      [box.x0, box.y0], [(box.x0 + box.x1) / 2, box.y0], [box.x1, box.y0],
      [box.x1, (box.y0 + box.y1) / 2], [box.x1, box.y1], [(box.x0 + box.x1) / 2, box.y1],
      [box.x0, box.y1], [box.x0, (box.y0 + box.y1) / 2],
    ];
    for (const [x, y] of handles) {
      const q = corner(x, y);
      if (!q) continue;
      const s = docToScreen(q);
      parts.push(`<rect x="${s.x - 3}" y="${s.y - 3}" width="6" height="6" fill="#fff" stroke="${color}"/>`);
    }
  }
}

function pathOutline(node, color) {
  const parts = [];
  const walk = (n) => {
    const k = n?.kind;
    if (!k || n.visible === false) return;
    if (k.type === "path" && k.path && !k.guide) {
      const d = pathD(k.path);
      if (d) parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
    } else if (k.type !== "text") {
      for (const c of childrenOf(n) || []) walk(c);
    }
  };
  walk(node);
  return parts.join("");
}

function samePt(a, b) { return Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3; }

function handles(b) {
  const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
  return [
    { x: b.x0, y: b.y0, id: "nw" }, { x: mx, y: b.y0, id: "n" }, { x: b.x1, y: b.y0, id: "ne" },
    { x: b.x0, y: my, id: "w" }, { x: b.x1, y: my, id: "e" },
    { x: b.x0, y: b.y1, id: "sw" }, { x: mx, y: b.y1, id: "s" }, { x: b.x1, y: b.y1, id: "se" },
  ];
}

function paintRulers() {
  const d = doc();
  const rh = $("ruler-h"), rv = $("ruler-v");
  if (!d || !ui.rulers) { rh.innerHTML = ""; rv.innerHTML = ""; return; }
  const z = d.zoom;
  const step = niceStep(56 / z);
  const w = rh.clientWidth, h = rv.clientHeight;
  const x0 = screenToDoc(0, 0).x, x1 = screenToDoc(w, 0).x;
  const y0 = screenToDoc(0, 0).y, y1 = screenToDoc(0, h).y;
  const ticksH = [], ticksV = [];
  const start = (v, s) => Math.floor(v / s) * s;
  for (let x = start(Math.min(x0, x1), step); x <= Math.max(x0, x1); x += step) {
    const sx = docToScreen({ x, y: 0 }).x;
    ticksH.push(`<line x1="${sx}" y1="10" x2="${sx}" y2="18" stroke="currentColor" stroke-width="1"/>`);
    ticksH.push(`<text x="${sx + 2}" y="9" font-size="9" fill="currentColor">${Math.round(x)}</text>`);
  }
  for (let y = start(Math.min(y0, y1), step); y <= Math.max(y0, y1); y += step) {
    const sy = docToScreen({ x: 0, y }).y;
    ticksV.push(`<line x1="10" y1="${sy}" x2="18" y2="${sy}" stroke="currentColor"/>`);
    ticksV.push(`<text x="2" y="${sy - 2}" font-size="9" fill="currentColor" transform="rotate(-90 8 ${sy})">${Math.round(y)}</text>`);
  }
  rh.innerHTML = `<svg width="100%" height="18">${ticksH.join("")}</svg>`;
  rv.innerHTML = `<svg width="18" height="${h}">${ticksV.join("")}</svg>`;
}
function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-6))));
  const n = v / p;
  const m = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return m * p;
}

/* ---------- hit testing ---------- */

function hitsGeometry(n, p, tol = 5) {
  if (!n || n.locked || n.visible === false) return false;
  const k = n.kind || {};
  if (k.type === "path" && !k.guide) {
    const stroke = primaryStroke(n);
    const w = stroke?.paint?.type && stroke.paint.type !== "none" ? Math.max(tol, stroke.width || 1) : 0;
    if (w && hitStroke(k.path, p, w + tol)) return true;
    const fill = primaryFill(n);
    if (fill?.type && fill.type !== "none" && hitFill(k.path, p, k.rule)) return true;
    if (hitStroke(k.path, p, tol + 2)) return true;
    return false;
  }
  if (k.type === "text" || k.type === "mesh") {
    const b = nodeBounds(n);
    return b && contains(b, p, tol);
  }
  if (k.type === "blend") return blendHit(n, p, tol);
  return false;
}

function hitDeep(nodes, p) {
  if (!nodes) return null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n || n.visible === false || n.locked) continue;
    const kids = childrenOf(n);
    if (kids && n.kind.type !== "path") {
      const inner = hitDeep(kids, p);
      if (inner) return inner;
    }
    if (hitsGeometry(n, p)) return n;
  }
  return null;
}

function hitSelect(nodes, p) {
  if (!nodes) return null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n || n.visible === false || n.locked) continue;
    const t = n.kind?.type;
    if (t === "group" || t === "blend" || t === "repeat" || t === "envelope" || t === "compound") {
      const inner = hitDeep(childrenOf(n), p) || (t === "blend" && blendHit(n, p) ? n : null);
      if (inner) return t === "compound" ? n : (t === "group" ? n : n);
    } else if (hitsGeometry(n, p)) return n;
  }
  return null;
}

function hitAt(p, deep) {
  const f = file();
  if (!f) return null;
  const layers = [...f.document.layers].reverse();
  for (const layer of layers) {
    if (layer.visible === false || layer.locked) continue;
    const hit = (deep ? hitDeep : hitSelect)(layer.kind.children || [], p);
    if (hit) return hit;
  }
  return null;
}

function artboardAt(p) {
  const boards = file()?.document.artboards || [];
  for (let i = boards.length - 1; i >= 0; i--) {
    const r = boards[i].rect;
    if (p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) return i;
  }
  return doc()?.artboard || 0;
}

function snapPoint(p, extra = []) {
  ui.guides = null;
  if (!ui.snap || !file()) return p;
  const tol = 6 / doc().zoom;
  const xs = [], ys = [];
  if (ui.snapPoint !== false) {
    for (const a of file().document.artboards) {
      xs.push(a.rect.x0, a.rect.x1, (a.rect.x0 + a.rect.x1) / 2);
      ys.push(a.rect.y0, a.rect.y1, (a.rect.y0 + a.rect.y1) / 2);
    }
    const { map } = indexNodes(file());
    for (const n of map.values()) {
      if (n.kind?.type === "layer" || doc().selection.includes(n.id)) continue;
      const b = nodeBounds(n);
      if (!b) continue;
      xs.push(b.x0, b.x1, (b.x0 + b.x1) / 2);
      ys.push(b.y0, b.y1, (b.y0 + b.y1) / 2);
    }
    xs.push(...extra.map((q) => q.x));
    ys.push(...extra.map((q) => q.y));
  }
  let x = p.x, y = p.y, gx = null, gy = null;
  for (const v of xs) if (Math.abs(p.x - v) <= tol) { x = v; gx = v; break; }
  for (const v of ys) if (Math.abs(p.y - v) <= tol) { y = v; gy = v; break; }
  if (ui.snapGrid) {
    const g = file().document.grid?.spacing || 72;
    const sx = Math.round(x / g) * g, sy = Math.round(y / g) * g;
    if (Math.abs(p.x - sx) <= tol) { x = sx; gx = sx; }
    if (Math.abs(p.y - sy) <= tol) { y = sy; gy = sy; }
  }
  if ((gx != null || gy != null) && ui.smartGuides !== false) ui.guides = { x: gx, y: gy };
  return { x, y };
}

function handleAt(sx, sy) {
  const d = doc();
  if (!d?.selection.length || ui.tool !== "selection") return null;
  const b = selectionBounds(d.file, d.selection);
  if (!b) return null;
  const top = docToScreen({ x: (b.x0 + b.x1) / 2, y: b.y0 });
  if (Math.hypot(sx - top.x, sy - (top.y - 22)) < 8) return "rotate";
  for (const h of handles(b)) {
    const s = docToScreen(h);
    if (Math.hypot(sx - s.x, sy - s.y) < 7) return h.id;
  }
  return null;
}

function anchorAt(p) {
  const d = doc();
  if (!d) return null;
  const { map } = indexNodes(d.file);
  const tol = 7 / d.zoom;
  const ids = d.selection.length ? d.selection : [...map.keys()];
  for (const id of ids) {
    const n = map.get(id);
    if (n?.kind?.type !== "path") continue;
    for (let si = 0; si < n.kind.path.subpaths.length; si++) {
      const sp = n.kind.path.subpaths[si];
      for (let ai = 0; ai < sp.anchors.length; ai++) {
        const a = sp.anchors[ai];
        if (dist(a.p, p) <= tol) return { node: n, si, ai, which: "p" };
        if (dist(a.in, p) <= tol && !samePt(a.in, a.p)) return { node: n, si, ai, which: "in" };
        if (dist(a.out, p) <= tol && !samePt(a.out, a.p)) return { node: n, si, ai, which: "out" };
      }
    }
  }
  return null;
}

/* ---------- documents ---------- */

function openDoc(f, name) {
  const d = {
    file: f, name, dirty: false, zoom: 1, panX: 40, panY: 40, viewRot: 0,
    selection: [], anchors: [], history: [], future: [], artboard: 0,
  };
  ui.docs.push(d);
  ui.active = ui.docs.length - 1;
  ui.home = false;
  requestAnimationFrame(() => {
    fit("all");
    if (d.selection.length) syncProxyFromSelection();
    refreshChrome();
  });
}

async function openExample(name) {
  const res = await fetch("/examples/" + name);
  if (!res.ok) throw new Error("Could not load " + name);
  const text = await res.text();
  if (name.startsWith("neon-drive")) {
    await Promise.all([
      loadFontMetrics("Source Sans 3", "Bold"),
      loadFontMetrics("Source Sans 3", "Semibold"),
      loadFontMetrics("Source Sans 3", "Regular"),
    ]).catch(() => {});
  }
  openDoc(loadFile(text), name);
  if (name.startsWith("neon-drive")) {
    const d = doc();
    const { map } = indexNodes(d.file);
    const title = [...map.values()].find((n) => n.kind?.type === "text" && (n.kind.runs?.[0]?.text || "").includes("NEON DRIVE"));
    if (title) d.selection = [title.id];
  }
  remember(name, text, "example");
}

function openText(name, text) {
  if (name.endsWith(".svg") || text.trim().startsWith("<")) {
    const f = newFile({ title: name.replace(/\.svg$/i, ""), width: 800, height: 600 });
    const nodes = importSVG(text, f);
    for (const n of nodes) addToLayer(f, n);
    openDoc(f, name.replace(/\.svg$/i, "") || "SVG");
    return;
  }
  openDoc(loadFile(text), name);
  remember(name, text, "file");
}

function remember(name, text, kind) {
  try {
    const rec = JSON.parse(localStorage.getItem("vc-recent") || "[]").filter((r) => r.name !== name);
    rec.unshift({ name, text: text.length < 1_500_000 ? text : "", kind, when: Date.now() });
    localStorage.setItem("vc-recent", JSON.stringify(rec.slice(0, 8)));
  } catch { /* private mode */ }
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function saveJSON() {
  const d = doc();
  if (!d) return;
  const text = JSON.stringify(d.file, null, 2);
  download(d.name.endsWith(".vectorcraft") ? d.name : d.name + ".vectorcraft", text, "application/json");
  d.dirty = false;
  remember(d.name, text, "file");
  refreshChrome();
  toast("Saved " + d.name);
}

function exportSVG() {
  const d = doc();
  if (!d) return;
  const boards = d.file.document.artboards;
  const b = boards[d.artboard]?.rect || artboardBounds(d.file);
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const rendered = renderDocument(d.file);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${b.x0} ${b.y0} ${w} ${h}">\n<rect x="${b.x0}" y="${b.y0}" width="${w}" height="${h}" fill="#fff"/>\n<defs>${rendered.defs}</defs>\n${rendered.body}\n</svg>\n`;
  download(d.name.replace(/\.vectorcraft$/, "") + ".svg", svg, "image/svg+xml");
}

async function exportPNG(scale = 2) {
  const d = doc();
  if (!d) return;
  const b = d.file.document.artboards[d.artboard]?.rect || artboardBounds(d.file);
  const w = Math.max(1, Math.round((b.x1 - b.x0) * scale));
  const h = Math.max(1, Math.round((b.y1 - b.y0) * scale));
  const rendered = renderDocument(d.file, { skipText: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${b.x0} ${b.y0} ${b.x1 - b.x0} ${b.y1 - b.y0}"><rect x="${b.x0}" y="${b.y0}" width="${b.x1 - b.x0}" height="${b.y1 - b.y0}" fill="#fff"/><defs>${rendered.defs}</defs>${rendered.body}</svg>`;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-b.x0, -b.y0);
  drawTextCanvas(ctx, d.file);
  ctx.restore();
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = d.name.replace(/\.vectorcraft$/, "") + ".png";
  a.click();
}

function drawTextCanvas(ctx, f) {
  const walk = (n) => {
    if (!n || n.visible === false) return;
    if (n.kind?.type === "text") {
      const xf = n.kind.xf || ident();
      const run = n.kind.runs?.[0];
      if (!run) return;
      const st = run.style || {};
      const size = st.size || 16;
      ctx.save();
      ctx.transform(xf[0], xf[1], xf[2], xf[3], xf[4], xf[5]);
      ctx.font = `${/italic/i.test(st.font_style || "") ? "italic " : ""}${fontWeight(st.font_style)} ${size}px "${st.font_family || "Source Sans 3"}", sans-serif`;
      ctx.fillStyle = st.fill?.type === "solid" ? rgbCss(st.fill.color) : "#111";
      ctx.textBaseline = "alphabetic";
      const justify = n.kind.para?.justify;
      ctx.textAlign = justify === "Center" ? "center" : justify === "Right" ? "right" : "left";
      ctx.globalAlpha = n.opacity ?? 1;
      ctx.fillText(run.text || "", 0, 0);
      ctx.restore();
    }
    const kids = childrenOf(n);
    if (kids) kids.forEach(walk);
  };
  f.document.layers.forEach(walk);
}
function fontWeight(style) {
  const s = style || "";
  if (/bold/i.test(s)) return 700;
  if (/semibold|semi/i.test(s)) return 600;
  if (/medium/i.test(s)) return 500;
  return 400;
}

/* ---------- commands ---------- */

const commands = {
  new: () => openModal("new"),
  open: () => pickFile(),
  save: () => saveJSON(),
  saveAs: () => saveJSON(),
  exportSVG: () => exportSVG(),
  exportPNG: () => exportPNG(2),
  close: () => closeDoc(),
  undo, redo,
  cut: () => { commands.copy(); commands.delete(); },
  copy: () => {
    const nodes = selectedNodes();
    if (!nodes.length) return;
    ui.clipboard = nodes.map((n) => deepClone(n));
  },
  paste: () => paste(12, 12),
  pasteInPlace: () => paste(0, 0),
  duplicate: () => {
    const d = doc();
    if (!d?.selection.length) return;
    pushHistory();
    d.selection = duplicateNodes(d.file, d.selection);
    paint(); refreshChrome();
  },
  delete: () => {
    const d = doc();
    if (!d?.selection.length) return;
    pushHistory();
    removeNodes(d.file, collectTop(d.file, d.selection));
    d.selection = [];
    paint(); refreshChrome();
  },
  selectAll: () => {
    const d = doc();
    if (!d) return;
    const ids = [];
    for (const layer of d.file.document.layers) for (const c of layer.kind.children || []) if (c.visible !== false && !c.locked) ids.push(c.id);
    d.selection = ids;
    paintOverlay(); refreshChrome();
  },
  deselect: () => { const d = doc(); if (!d) return; d.selection = []; ui.pen = null; paint(); refreshChrome(); },
  group: () => {
    const d = doc();
    if (!d || d.selection.length < 2) return;
    pushHistory();
    const id = groupNodes(d.file, d.selection);
    if (id) d.selection = [id];
    paint(); refreshChrome();
  },
  ungroup: () => {
    const d = doc();
    if (!d) return;
    pushHistory();
    d.selection = ungroup(d.file, d.selection);
    paint(); refreshChrome();
  },
  lock: () => { const d = doc(); if (!d) return; pushHistory(); lockNodes(d.file, d.selection, true); d.selection = []; paint(); refreshChrome(); },
  unlockAll: () => { const d = doc(); if (!d) return; pushHistory(); unlockAll(d.file); paint(); refreshChrome(); },
  hide: () => { const d = doc(); if (!d) return; pushHistory(); hideNodes(d.file, d.selection, true); d.selection = []; paint(); refreshChrome(); },
  showAll: () => { const d = doc(); if (!d) return; pushHistory(); showAll(d.file); paint(); refreshChrome(); },
  bringForward: () => arrange("forward"),
  bringFront: () => arrange("front"),
  sendBackward: () => arrange("backward"),
  sendBack: () => arrange("back"),
  alignLeft: () => align("left", null),
  alignCenter: () => align("center", null),
  alignRight: () => align("right", null),
  alignTop: () => align(null, "top"),
  alignMiddle: () => align(null, "center"),
  alignBottom: () => align(null, "bottom"),
  zoomIn: () => { const c = $("canvas"); zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1.25); },
  zoomOut: () => { const c = $("canvas"); zoomAt(c.clientWidth / 2, c.clientHeight / 2, 0.8); },
  fitArtboard: () => fit("all"),
  fitSelection: () => fit("sel"),
  actualSize: () => { const d = doc(); if (!d) return; const c = $("canvas"); zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1 / d.zoom); },
  toggleRulers: () => { ui.rulers = !ui.rulers; $("ruler-row").style.display = ui.rulers ? "" : "none"; $("ruler-v").style.display = ui.rulers ? "" : "none"; paintRulers(); },
  toggleGrid: () => { ui.grid = !ui.grid; paint(); },
  togglePerspective: () => {
    const f = file();
    if (!f) return;
    f.document.unknown = f.document.unknown || {};
    const g = f.document.unknown.perspectiveGrid;
    if (!g) f.document.unknown.perspectiveGrid = defaultGrid(f.document.artboards?.[0]?.rect);
    else g.visible = g.visible === false;
    paintOverlay();
  },
  toggleSnap: () => { ui.snap = !ui.snap; toast(ui.snap ? "Snap on" : "Snap off"); },
  toggleOutline: () => { ui.outline = !ui.outline; paint(); refreshChrome(); },
  toggleControl: () => { ui.control = !ui.control; $("controlbar").hidden = !ui.control; refreshChrome(); },
  prefs: () => openModal("prefs"),
  about: () => openModal("about"),
  shortcuts: () => openModal("keys"),
  pathfinderUnite: () => pathfinder("union"),
  pathfinderMinus: () => pathfinder("difference"),
  pathfinderIntersect: () => pathfinder("intersect"),
  pathfinderExclude: () => pathfinder("xor"),
  expand: () => expandSelection(),
  makeBlend: () => makeBlendFromSelection(),
  outerGlow: () => addGlow(),
  warpFlag: () => warpSelection("flag", 40),
  warpArc: () => warpSelection("arc", 35),
  warpWave: () => warpSelection("wave", 30),
  offsetPath: () => offsetSelection(),
  simplify: () => simplifySelection(),
  createOutlines: () => toast("Create Outlines keeps the live type — glyph outlines need the font’s raw contours"),
  lockSel: () => commands.lock(),
  sameFill: () => selectSame("fill"),
  sameStroke: () => selectSame("stroke"),
  inverse: () => invertSelection(),
  documentSetup: () => openModal("setup"),
  preferences: () => openModal("prefs"),
  editArtboards: () => { ui.tool = "artboard"; refreshChrome(); paintOverlay(); },
  exitArtboards: () => { ui.tool = "selection"; refreshChrome(); paintOverlay(); },
  newArtboard: () => addArtboard(),
  deleteArtboard: () => deleteArtboard(),
  rearrangeArtboards: () => rearrangeArtboards(),
};

function paste(dx, dy) {
  const d = doc();
  if (!d || !ui.clipboard?.length) return;
  pushHistory();
  const ids = [];
  for (const src of ui.clipboard) {
    const copy = deepClone(src);
    reassign(d.file, copy);
    translateNode(copy, dx, dy);
    addToLayer(d.file, copy);
    ids.push(copy.id);
  }
  d.selection = ids;
  paint(); refreshChrome();
}
function reassign(f, node) {
  node.id = f.document.next_id++;
  const kids = childrenOf(node);
  if (kids) kids.forEach((c) => reassign(f, c));
}
function arrange(dir) {
  const d = doc();
  if (!d) return;
  pushHistory();
  for (const id of collectTop(d.file, d.selection)) reorder(d.file, id, dir);
  paint();
}
function align(h, v) {
  const d = doc();
  if (!d || d.selection.length < 2) return;
  pushHistory();
  alignNodes(d.file, d.selection, h, v);
  paint(); refreshChrome();
}
function closeDoc() {
  if (ui.active < 0) return;
  ui.docs.splice(ui.active, 1);
  ui.active = Math.min(ui.active, ui.docs.length - 1);
  if (ui.active < 0) ui.home = true;
  paint();
  refreshChrome();
}

function pickFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".vectorcraft,.json,.svg,application/json";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    openText(f.name, await f.text());
  };
  input.click();
}

function selectSame(kind) {
  const d = doc();
  const n = selectedNodes()[0];
  if (!d || !n) return;
  const key = kind === "fill" ? JSON.stringify(primaryFill(n)) : JSON.stringify(primaryStroke(n)?.paint);
  const ids = [];
  const { map } = indexNodes(d.file);
  for (const node of map.values()) {
    if (node.kind?.type === "layer") continue;
    const k = kind === "fill" ? JSON.stringify(primaryFill(node)) : JSON.stringify(primaryStroke(node)?.paint);
    if (k === key) ids.push(node.id);
  }
  d.selection = ids;
  paintOverlay(); refreshChrome();
}
function invertSelection() {
  const d = doc();
  if (!d) return;
  const have = new Set(d.selection);
  const ids = [];
  for (const layer of d.file.document.layers) for (const c of layer.kind.children || []) if (!have.has(c.id)) ids.push(c.id);
  d.selection = ids;
  paintOverlay(); refreshChrome();
}

function ringOf(node) {
  if (node?.kind?.type !== "path") return null;
  const flat = flattenPath(node.kind.path, 0.8)[0];
  return flat && flat.pts.length >= 3 ? flat.pts : null;
}
function pathfinder(op) {
  const d = doc();
  const nodes = selectedNodes().filter((n) => n.kind?.type === "path");
  if (!d || nodes.length < 2) { toast("Select two or more paths"); return; }
  let rings = [ringOf(nodes[0])].filter(Boolean);
  for (let i = 1; i < nodes.length; i++) {
    const r = ringOf(nodes[i]);
    if (!r) continue;
    const next = [];
    for (const a of rings) next.push(...polygonBoolean(a, r, op));
    rings = next.length ? next : rings;
    if (op === "difference") {
      rings = polygonBoolean(ringOf(nodes[0]), r, "difference");
      for (let j = 2; j < nodes.length; j++) {
        const rr = ringOf(nodes[j]);
        if (rr) rings = rings.flatMap((a) => polygonBoolean(a, rr, "difference"));
      }
      break;
    }
  }
  if (!rings.length) { toast("Pathfinder produced an empty result"); return; }
  pushHistory();
  const parent = indexNodes(d.file).parent.get(nodes[0].id);
  removeNodes(d.file, nodes.map((n) => n.id));
  const ids = [];
  for (const ring of rings) {
    const node = makePathNode(d.file, pathFromAnchors(ring, true), { ...styleNow(), name: "Path" });
    (childrenOf(parent) || d.file.document.layers[0].kind.children).push(node);
    ids.push(node.id);
  }
  d.selection = ids;
  paint(); refreshChrome();
}

function expandSelection() {
  const d = doc();
  if (!d) return;
  const { map, parent } = indexNodes(d.file);
  let did = false;
  pushHistory();
  for (const id of [...d.selection]) {
    const n = map.get(id);
    if (n?.kind?.type !== "blend") continue;
    const par = parent.get(id);
    const list = childrenOf(par);
    const i = list.indexOf(n);
    const pieces = expandBlend(n);
    pieces.forEach((p) => reassign(d.file, p));
    list.splice(i, 1, ...pieces);
    did = true;
  }
  if (!did) { d.history.pop(); toast("Nothing to expand"); return; }
  d.selection = [];
  paint(); refreshChrome();
}

function makeBlendFromSelection() {
  const d = doc();
  const nodes = selectedNodes();
  if (!d || nodes.length < 2) { toast("Select two objects to blend"); return; }
  const { parent } = indexNodes(d.file);
  const par = parent.get(nodes[0].id);
  const list = childrenOf(par);
  if (!list || nodes.some((n) => parent.get(n.id)?.id !== par.id)) { toast("Objects must share a parent"); return; }
  pushHistory();
  const indexes = nodes.map((n) => list.indexOf(n)).sort((a, b) => a - b);
  const picked = indexes.map((i) => list[i]);
  for (const i of indexes.slice().reverse()) list.splice(i, 1);
  const g = blankNode(d.file.document.next_id++, {
    type: "blend",
    children: picked,
    spec: { spacing: { steps: 16 }, alignToPage: true },
  }, { items: [] });
  g.name = "Blend";
  g.opacity = 1;
  list.splice(indexes[0], 0, g);
  d.selection = [g.id];
  paint(); refreshChrome();
}

function addGlow() {
  const d = doc();
  if (!d?.selection.length) return;
  pushHistory();
  const { map } = indexNodes(d.file);
  for (const id of d.selection) {
    const n = map.get(id);
    if (!n) continue;
    n.appearance = n.appearance || { items: [] };
    n.appearance.effects = n.appearance.effects || [];
    n.appearance.effects.push({ id: "stylize.outerGlow", visible: true, params: { blur: 12, color: "#ff4fa0", mode: "screen", opacity: 70 } });
  }
  paint();
}
function offsetSelection() {
  const d = doc();
  const nodes = selectedNodes().filter((n) => n.kind?.type === "path");
  if (!d || !nodes.length) { toast("Select a path to offset"); return; }
  const delta = Number(prompt("Offset distance (pt)", "10"));
  if (!delta) return;
  pushHistory();
  for (const n of nodes) {
    const ring = ringOf(n);
    if (!ring) continue;
    const grown = offsetRing(ring, delta);
    n.kind.path = pathFromAnchors(grown, true);
    if (n.kind.live) delete n.kind.live;
  }
  paint();
}
function simplifySelection() {
  const d = doc();
  const nodes = selectedNodes().filter((n) => n.kind?.type === "path");
  if (!d || !nodes.length) return;
  pushHistory();
  for (const n of nodes) {
    for (const sp of n.kind.path.subpaths || []) {
      const pts = simplify(sp.anchors.map((a) => a.p), 2.5);
      if (pts.length >= 2) sp.anchors = pathFromAnchors(pts, sp.closed).subpaths[0].anchors;
    }
  }
  paint();
}
function warpSelection(style, bend) {
  const d = doc();
  const nodes = selectedNodes();
  if (!d || !nodes.length) return;
  const { parent } = indexNodes(d.file);
  const par = parent.get(nodes[0].id);
  const list = childrenOf(par);
  if (!list) return;
  pushHistory();
  const indexes = nodes.map((n) => list.indexOf(n)).filter((i) => i >= 0).sort((a, b) => a - b);
  const picked = indexes.map((i) => list[i]);
  for (const i of indexes.slice().reverse()) list.splice(i, 1);
  const env = blankNode(d.file.document.next_id++, {
    type: "envelope",
    content: picked,
    kind: { type: "warp", style, bend, h: 0, v: 0, horizontal: true },
    fidelity: 40,
  }, { items: [] });
  env.name = "Envelope";
  list.splice(indexes[0], 0, env);
  d.selection = [env.id];
  paint(); refreshChrome();
}

/* ---------- tools / pointer ---------- */

function setTool(id) {
  ui.tool = id;
  for (const slot of TOOL_DEFS.flatMap((c) => c.slots)) {
    if (slot.id === id || slot.flyout?.some((t) => t.id === id)) ui.slotChoice[slot.id] = id;
  }
  ui.pen = null;
  ui.blendPick = null;
  if ((id === "perspectiveGrid" || id === "perspectiveSelection") && file()) {
    const f = file();
    f.document.unknown = f.document.unknown || {};
    if (!f.document.unknown.perspectiveGrid) f.document.unknown.perspectiveGrid = defaultGrid(f.document.artboards?.[0]?.rect);
    else if (f.document.unknown.perspectiveGrid.visible === false) f.document.unknown.perspectiveGrid.visible = true;
  }
  const c = $("canvas");
  c.classList.remove("hand", "cross", "zoom", "text");
  if (id === "hand" || ui.space) c.classList.add("hand");
  else if (id === "zoom") c.classList.add("zoom");
  else if (id === "type" || id === "areaType") c.classList.add("text");
  else if (["pen", "pencil", "paintbrush", "curvature", "addAnchor", "eraser", "lasso"].includes(id) || id.includes("ectangle") || ["ellipse", "polygon", "star", "lineSegment", "roundedRectangle"].includes(id)) c.classList.add("cross");
  drawToolbar();
  paintOverlay();
  drawHint();
  status();
}

function onDown(e) {
  if (e.button === 2) return;
  if (e.target.closest(".taskbar, .home, input, button, .appear-float")) return;
  closePops();
  const d = doc();
  if (!d) return;
  const screen = local(e);
  const p0 = screenToDoc(screen.x, screen.y);
  const p = snapPoint(p0);
  const tool = ui.space ? "hand" : ui.tool;
  gesture.on = true;
  gesture.tool = tool;
  gesture.start = p;
  gesture.startScreen = screen;
  gesture.last = p;
  gesture.shift = e.shiftKey;
  gesture.alt = e.altKey;
  gesture.ids = [...d.selection];
  $("canvas").setPointerCapture?.(e.pointerId);

  const grid = readGrid(d.file);
  if (grid && grid.visible !== false) {
    const cnv = $("canvas");
    const picked = widgetHit(screen.x, screen.y, cnv.clientWidth, cnv.clientHeight);
    if (picked) { grid.plane = picked; gesture.on = false; paintOverlay(); return; }
  }
  if (tool === "perspectiveGrid" && grid && !grid.locked) {
    const tol = 6 / d.zoom;
    const handles = gridHandles(grid, 1 / d.zoom);
    const h = handles.filter((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) <= tol).sort((a, b) => Math.hypot(a.p.x - p.x, a.p.y - p.y) - Math.hypot(b.p.x - p.x, b.p.y - p.y))[0];
    if (h) {
      gesture.mode = "perspGrid";
      gesture.handle = h.id;
      gesture.grid0 = structuredClone(grid);
      gesture.steps = h.steps;
      return;
    }
    const diamond = (gridOverlay(grid)?.diamonds || []).find((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) <= tol);
    if (diamond) {
      gesture.mode = "perspPlane";
      gesture.plane = diamond.plane;
      gesture.anchor = diamond.p;
      gesture.grid0 = structuredClone(grid);
      gesture.offset0 = diamond.plane === "left" ? grid.leftOffset || 0 : diamond.plane === "right" ? grid.rightOffset || 0 : grid.groundOffset || 0;
      return;
    }
    gesture.on = false;
    return;
  }
  if (tool === "perspectiveSelection") {
    const raw = readGrid(d.file);
    if (raw && d.selection.length === 1) {
      const n = indexNodes(d.file).map.get(d.selection[0]);
      const att = n?.perspective;
      const box = att?.plane ? planeBounds(raw, n, att.plane, att.depth || 0) : null;
      if (box) {
        const hs = perspHandlePoints(box);
        const tol = 6 / d.zoom;
        const hi = hs.findIndex(([x, y]) => {
          const q = pagePoint(raw, att.plane, att.depth || 0, x, y);
          return q && Math.hypot(q.x - p.x, q.y - p.y) <= tol;
        });
        if (hi >= 0) {
          gesture.mode = "perspScale";
          gesture.nodeId = n.id;
          gesture.plane = att.plane;
          gesture.depth = att.depth || 0;
          gesture.box = box;
          gesture.handle = hi;
          gesture.node0 = deepClone(n);
          return;
        }
      }
    }
    const hit = hitAt(p, false);
    if (hit) {
      const root = hit;
      if (e.shiftKey) d.selection = d.selection.includes(root.id) ? d.selection.filter((id) => id !== root.id) : [...d.selection, root.id];
      else if (!d.selection.includes(root.id)) d.selection = [root.id];
      if (root.perspective?.plane) {
        gesture.mode = "perspMove";
        gesture.plane = root.perspective.plane;
        gesture.nodeId = root.id;
        gesture.copy = e.altKey;
      } else {
        gesture.mode = "move";
        gesture.ids = collectTop(d.file, d.selection);
      }
      refreshChrome();
      paintOverlay();
      return;
    }
    d.selection = [];
    gesture.mode = "marquee";
    gesture.marquee = { a: screen, b: screen };
    refreshChrome();
    paintOverlay();
    return;
  }

  if (tool === "hand") { gesture.mode = "pan"; $("canvas").classList.add("panning"); return; }
  if (tool === "zoom") {
    if (e.altKey) zoomAt(screen.x, screen.y, 0.8);
    else { gesture.mode = "zoomrect"; gesture.marquee = { a: screen, b: screen }; }
    return;
  }
  if (tool === "rotateView") { gesture.mode = "viewrot"; gesture.base = d.viewRot || 0; return; }
  if (tool === "artboard") {
    const boards = d.file.document.artboards || [];
    let hit = -1;
    for (let i = boards.length - 1; i >= 0; i--) {
      const r = boards[i].rect;
      if (p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) { hit = i; break; }
    }
    if (hit >= 0) { d.artboard = hit; gesture.mode = "artboard"; }
    refreshChrome();
    paintOverlay();
    return;
  }

  if (tool === "selection") {
    const h = handleAt(screen.x, screen.y);
    if (h && d.selection.length) {
      gesture.mode = h === "rotate" ? "rotate" : "scale";
      gesture.handle = h;
      gesture.origin = center(selectionBounds(d.file, d.selection));
      gesture.bounds = selectionBounds(d.file, d.selection);
      return;
    }
    const hit = hitAt(p, false);
    if (hit) {
      if (e.shiftKey) d.selection = d.selection.includes(hit.id) ? d.selection.filter((id) => id !== hit.id) : [...d.selection, hit.id];
      else if (!d.selection.includes(hit.id)) d.selection = [hit.id];
      gesture.mode = "move";
      gesture.ids = collectTop(d.file, d.selection);
      if (e.altKey) {
        pushHistory();
        gesture.ids = duplicateNodes(d.file, gesture.ids);
        d.selection = gesture.ids;
        paint();
        gesture.duplicated = true;
      }
      syncProxyFromSelection();
      refreshChrome();
      paintOverlay();
      return;
    }
    d.selection = [];
    gesture.mode = "marquee";
    gesture.marquee = { a: screen, b: screen };
    refreshChrome();
    paintOverlay();
    return;
  }

  if (tool === "directSelection" || tool === "groupSelection") {
    const a = anchorAt(p);
    if (a && tool === "directSelection") {
      d.selection = [a.node.id];
      gesture.mode = "anchor";
      gesture.anchor = a;
      gesture.originPt = { ...a.node.kind.path.subpaths[a.si].anchors[a.ai][a.which] };
      paintOverlay();
      return;
    }
    const hit = hitAt(p, true);
    if (hit) {
      if (tool === "groupSelection") {
        const { parent } = indexNodes(d.file);
        let node = hit;
        if (d.selection.length === 1 && d.selection[0] === hit.id) {
          const par = parent.get(hit.id);
          if (par && par.kind?.type !== "layer") node = par;
        }
        d.selection = [node.id];
      } else d.selection = [hit.id];
      gesture.mode = "move";
      gesture.ids = [...d.selection];
      refreshChrome();
      paintOverlay();
      return;
    }
    d.selection = [];
    gesture.mode = "marquee";
    gesture.marquee = { a: screen, b: screen };
    paintOverlay();
    return;
  }

  if (["rectangle", "roundedRectangle", "ellipse", "polygon", "star", "lineSegment"].includes(tool)) {
    gesture.mode = "shape";
    return;
  }
  if (tool === "pen") { penClick(p, e); return; }
  if (tool === "curvature") { curveClick(p, e); return; }
  if (tool === "pencil" || tool === "paintbrush" || tool === "eraser") {
    gesture.mode = "freehand";
    gesture.pts = [p];
    return;
  }
  if (tool === "type" || tool === "areaType") { typeAt(p, e); return; }
  if (tool === "lasso") { gesture.mode = "lasso"; gesture.lasso = [screen]; return; }
  if (tool === "magicWand") { wand(p); return; }
  if (tool === "eyedropper") { sample(p); return; }
  if (tool === "rotate" || tool === "scale" || tool === "reflect" || tool === "shear") {
    if (!d.selection.length) { toast("Select an object first"); gesture.on = false; return; }
    gesture.mode = tool;
    gesture.origin = e.altKey ? p : center(selectionBounds(d.file, d.selection));
    return;
  }
  if (tool === "shapeBuilder" || tool === "shaper") { gesture.mode = "builder"; gesture.pts = [p]; return; }
  if (tool === "blend") { blendClick(p); return; }
  if (tool === "addAnchor") { addAnchorAt(p); return; }
  if (tool === "deleteAnchor") { deleteAnchorAt(p); return; }
  if (tool === "anchorPoint") { convertAnchor(p); return; }
  if (tool === "smooth") { gesture.mode = "smooth"; return; }
  if (tool === "width") { gesture.mode = "width"; return; }
  if (tool === "gradient") { gesture.mode = "gradient"; return; }
  if (tool === "mesh") { toast("Gradient mesh is shown for documents that contain one. Use the Gradient tool to recolor a fill."); gesture.on = false; }
}

function onMove(e) {
  const d = doc();
  if (!d) return;
  const screen = local(e);
  const raw = screenToDoc(screen.x, screen.y);
  const p = snapPoint(raw);
  statusXY(raw);
  if (ui.pen?.anchors?.length && gesture.mode !== "penhandle") {
    gesture.cursor = raw;
    if (!gesture.on) { paintOverlay(); return; }
  }
  if (!gesture.on) return;
  if (gesture.mode === "pan") {
    d.panX += e.movementX;
    d.panY += e.movementY;
    const view = $("art").querySelector("#view");
    if (view) view.setAttribute("transform", viewTransform());
    paintOverlay();
    paintRulers();
    return;
  }
  if (gesture.mode === "viewrot") {
    const c = centerScreen();
    const a0 = Math.atan2(gesture.startScreen.y - c.y, gesture.startScreen.x - c.x);
    const a1 = Math.atan2(screen.y - c.y, screen.x - c.x);
    d.viewRot = gesture.base + (a1 - a0) * 180 / Math.PI;
    const view = $("art").querySelector("#view");
    if (view) view.setAttribute("transform", viewTransform());
    paintOverlay();
    return;
  }
  if (gesture.mode === "perspGrid") {
    const raw = readGrid(d.file);
    if (raw && !gesture.gridHist) { pushHistory(); gesture.gridHist = true; }
    const next = dragHandle(gesture.grid0, gesture.handle, p, { shift: e.shiftKey, alt: e.altKey, from: gesture.start }, gesture.steps);
    if (raw) Object.assign(raw, next || gesture.grid0);
    paintOverlay();
    return;
  }
  if (gesture.mode === "perspPlane") {
    const raw = readGrid(d.file);
    if (raw && !gesture.gridHist) { pushHistory(); gesture.gridHist = true; }
    const moved = { x: gesture.anchor.x + (p.x - gesture.start.x), y: gesture.anchor.y + (p.y - gesture.start.y) };
    const depth = depthAt(gesture.grid0, gesture.plane, gesture.offset0 || 0, gesture.anchor, moved);
    if (raw && depth != null) setOffset(raw, gesture.plane, depth);
    paintOverlay();
    return;
  }
  if (gesture.mode === "perspScale") {
    const raw = readGrid(d.file);
    const live = indexNodes(d.file).map.get(gesture.nodeId);
    if (raw && live && gesture.node0) {
      if (!gesture.gridHist) { pushHistory(); gesture.gridHist = true; }
      live.kind = deepClone(gesture.node0.kind);
      const hs = perspHandlePoints(gesture.box);
      const src = hs[gesture.handle];
      const opp = hs[(gesture.handle + 4) % 8];
      const q = unproject(raw, gesture.plane, p) || { x: src[0], y: src[1] };
      let sx = Math.abs(src[0] - opp[0]) < 1e-6 ? 1 : (q.x - opp[0]) / (src[0] - opp[0]);
      let sy = Math.abs(src[1] - opp[1]) < 1e-6 ? 1 : (q.y - opp[1]) / (src[1] - opp[1]);
      if (gesture.handle % 2 === 1) {
        if (gesture.handle % 4 === 1) sx = 1;
        else sy = 1;
      } else if (e.shiftKey) {
        const s = Math.max(Math.abs(sx), Math.abs(sy)) || 1;
        sx = (sx < 0 ? -s : s);
        sy = (sy < 0 ? -s : s);
      }
      walkPoints(live, (pt) => {
        const u = unproject(raw, gesture.plane, pt);
        if (!u) return pt;
        return pagePoint(raw, gesture.plane, gesture.depth, opp[0] + (u.x - opp[0]) * sx, opp[1] + (u.y - opp[1]) * sy) || pt;
      });
    }
    paint();
    return;
  }
  if (gesture.mode === "perspMove") {
    const raw = readGrid(d.file);
    if (!raw) return;
    if (!gesture.gridHist) {
      pushHistory();
      gesture.gridHist = true;
      if (gesture.copy) {
        const ids = duplicateNodes(d.file, [gesture.nodeId]);
        if (ids[0] != null) { gesture.nodeId = ids[0]; d.selection = [ids[0]]; }
        gesture.copy = false;
      }
    }
    const node = indexNodes(d.file).map.get(gesture.nodeId);
    const mapPt = moveMap(raw, gesture.plane, gesture.last, p);
    if (node && mapPt) walkPoints(node, mapPt);
    gesture.last = p;
    paint();
    return;
  }
  if (gesture.mode === "artboard") {
    const dx = p.x - gesture.last.x, dy = p.y - gesture.last.y;
    if (!dx && !dy) return;
    if (!gesture.abHist) {
      pushHistory();
      gesture.abHist = true;
      gesture.abNodes = ui.moveArt ? artOnBoard(d.file, d.file.document.artboards[d.artboard].rect) : [];
    }
    const ab = d.file.document.artboards[d.artboard];
    ab.rect.x0 += dx; ab.rect.x1 += dx; ab.rect.y0 += dy; ab.rect.y1 += dy;
    for (const n of gesture.abNodes || []) translateNode(n, dx, dy);
    gesture.last = p;
    paint();
    return;
  }
  if (gesture.mode === "marquee" || gesture.mode === "zoomrect") {
    gesture.marquee.b = screen;
    paintOverlay();
    return;
  }
  if (gesture.mode === "lasso") { gesture.lasso.push(screen); paintOverlay(); return; }
  if (gesture.mode === "move") {
    gesture.dx = p.x - gesture.start.x;
    gesture.dy = p.y - gesture.start.y;
    gesture.moved = Math.hypot(gesture.dx, gesture.dy) > 0.2;
    for (const id of gesture.ids) {
      const el = $("art").querySelector(`[data-id="${id}"]`);
      if (el) el.setAttribute("transform", `translate(${gesture.dx} ${gesture.dy})`);
    }
    paintOverlay();
    return;
  }
  if (gesture.mode === "anchor") {
    if (!gesture.moved) { pushHistory(); gesture.moved = true; }
    const a = gesture.anchor;
    const an = a.node.kind.path.subpaths[a.si].anchors[a.ai];
    const dx = p.x - an[a.which].x, dy = p.y - an[a.which].y;
    an[a.which] = { x: p.x, y: p.y };
    if (a.which === "p") { an.in.x += dx; an.in.y += dy; an.out.x += dx; an.out.y += dy; }
    if (a.which === "out" && !e.altKey) {
      an.in = { x: an.p.x - (p.x - an.p.x), y: an.p.y - (p.y - an.p.y) };
      an.kind = "Smooth";
    }
    if (a.which === "in" && !e.altKey) {
      an.out = { x: an.p.x - (p.x - an.p.x), y: an.p.y - (p.y - an.p.y) };
      an.kind = "Smooth";
    }
    paint();
    return;
  }
  if (gesture.mode === "shape") { previewShape(p, e.shiftKey, e.altKey); return; }
  if (gesture.mode === "freehand") { gesture.pts.push(raw); previewPolyline(gesture.pts); return; }
  if (gesture.mode === "scale" || gesture.mode === "rotate" || gesture.mode === "reflect" || gesture.mode === "shear") {
    liveXf(gestureTransform(p, e.shiftKey));
    return;
  }
  if (gesture.mode === "builder") { gesture.pts.push(raw); previewPolyline(gesture.pts); return; }
  if (gesture.mode === "gradient") {
    const ang = Math.atan2(-(p.y - gesture.start.y), p.x - gesture.start.x) * 180 / Math.PI;
    setGradient(ang, gesture.start, p, false);
  }
}

function onUp(e) {
  if (!gesture.on) return;
  const d = doc();
  const screen = local(e);
  const p = screenToDoc(screen.x, screen.y);
  const mode = gesture.mode;
  gesture.on = false;
  $("canvas").classList.remove("panning");
  ui.guides = null;
  if (!d) return;
  if (mode === "artboard") { gesture.abHist = false; gesture.abNodes = null; refreshChrome(); paintOverlay(); return; }
  if (mode === "perspGrid" || mode === "perspPlane" || mode === "perspMove" || mode === "perspScale") {
    gesture.gridHist = false;
    gesture.grid0 = null;
    gesture.node0 = null;
    refreshChrome();
    paint();
    return;
  }
  if (mode === "marquee") {
    const a = screenToDoc(gesture.marquee.a.x, gesture.marquee.a.y);
    const b = screenToDoc(gesture.marquee.b.x, gesture.marquee.b.y);
    const box = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
    const ids = [];
    const { map } = indexNodes(d.file);
    for (const n of map.values()) {
      if (n.kind?.type === "layer" || n.visible === false || n.locked) continue;
      const nb = nodeBounds(n);
      if (nb && nb.x0 >= box.x0 && nb.x1 <= box.x1 && nb.y0 >= box.y0 && nb.y1 <= box.y1) ids.push(n.id);
    }
    d.selection = e.shiftKey ? [...new Set([...d.selection, ...ids])] : ids;
    gesture.marquee = null;
    paintOverlay();
    refreshChrome();
    return;
  }
  if (mode === "zoomrect") {
    const a = gesture.marquee.a, b = gesture.marquee.b;
    gesture.marquee = null;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 8) {
      const p1 = screenToDoc(Math.min(a.x, b.x), Math.min(a.y, b.y));
      const p2 = screenToDoc(Math.max(a.x, b.x), Math.max(a.y, b.y));
      const c = $("canvas");
      const bw = Math.max(1, p2.x - p1.x), bh = Math.max(1, p2.y - p1.y);
      d.zoom = clamp(Math.min(c.clientWidth / bw, c.clientHeight / bh) * 0.92, 0.02, 64);
      d.panX = (c.clientWidth - bw * d.zoom) / 2 - p1.x * d.zoom;
      d.panY = (c.clientHeight - bh * d.zoom) / 2 - p1.y * d.zoom;
    }
    paint(); refreshChrome();
    return;
  }
  if (mode === "lasso") {
    const ring = gesture.lasso.map((s) => screenToDoc(s.x, s.y));
    gesture.lasso = null;
    const ids = [];
    const { map } = indexNodes(d.file);
    for (const n of map.values()) {
      const nb = nodeBounds(n);
      if (!nb || n.kind?.type === "layer") continue;
      const c = center(nb);
      if (pointInPoly(c, ring)) ids.push(n.id);
    }
    d.selection = ids;
    paintOverlay(); refreshChrome();
    return;
  }
  if (mode === "shape") {
    commitShape(p, e.shiftKey, e.altKey);
    return;
  }
  if (mode === "freehand") {
    commitFreehand();
    return;
  }
  if (mode === "move") {
    if (gesture.moved) {
      pushHistory();
      const { map } = indexNodes(d.file);
      for (const id of gesture.ids) {
        const n = map.get(id);
        if (n) translateNode(n, gesture.dx || 0, gesture.dy || 0);
      }
    }
    gesture.dx = 0; gesture.dy = 0; gesture.moved = false;
    paint(); refreshChrome();
    return;
  }
  if (mode === "anchor") {
    gesture.moved = false;
    paint(); refreshChrome();
    return;
  }
  if (mode === "scale" || mode === "rotate" || mode === "reflect" || mode === "shear") {
    const xf = gestureTransform(p, e.shiftKey);
    if (xf) {
      pushHistory();
      const { map } = indexNodes(d.file);
      for (const id of d.selection) {
        const n = map.get(id);
        if (n) transformNode(n, xf);
      }
    }
    paint(); refreshChrome();
    return;
  }
  if (mode === "builder") {
    commitBuilder();
    return;
  }
  if (mode === "smooth") { smoothHit(p); return; }
  if (mode === "width") {
    const hit = hitAt(gesture.start, true);
    if (hit) {
      pushHistory();
      const s = primaryStroke(hit);
      const w = Math.max(0.25, dist(gesture.start, p));
      if (s) s.width = w;
      else setPaint(hit, "stroke", solid(0, 0, 0));
      ui.strokeWidth = w;
      paint(); refreshChrome();
    }
    return;
  }
  if (mode === "gradient") {
    const ang = Math.atan2(-(p.y - gesture.start.y), p.x - gesture.start.x) * 180 / Math.PI;
    setGradient(ang, gesture.start, p, true);
    return;
  }
  if (mode === "pan" || mode === "viewrot") { paintOverlay(); paintRulers(); status(); }
}

function local(e) {
  const r = $("canvas").getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function centerScreen() {
  const c = $("canvas");
  return { x: c.clientWidth / 2, y: c.clientHeight / 2 };
}
function pointInPoly(p, ring) {
  let w = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a.y > p.y) !== (b.y > p.y)) {
      const x = a.x + (b.x - a.x) * (p.y - a.y) / ((b.y - a.y) || 1e-9);
      if (p.x < x) w++;
    }
  }
  return w % 2 === 1;
}

function liveTranslate(ids, dx, dy) {
  // model already translated; just repaint selection chrome. Full paint is ok for modest docs.
  if ((file() && JSON.stringify(file()).length > 250000) || ids.length > 30) {
    paintOverlay();
    return;
  }
  paint();
}

function gestureTransform(p, shift) {
  const o = gesture.origin;
  if (!o) return null;
  if (gesture.mode === "rotate" || gesture.tool === "rotate") {
    const a0 = Math.atan2(gesture.start.y - o.y, gesture.start.x - o.x);
    const a1 = Math.atan2(p.y - o.y, p.x - o.x);
    let ang = a1 - a0;
    if (shift) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
    return rotateXf(ang, o.x, o.y);
  }
  if (gesture.mode === "scale" || gesture.tool === "scale" || gesture.mode === "scale") {
    const b = gesture.bounds;
    if (gesture.mode === "scale" && gesture.handle && b) return scaleFromHandle(b, gesture.handle, p, shift);
    const d0 = Math.max(1, dist(gesture.start, o));
    const d1 = Math.max(0.01, dist(p, o));
    let s = d1 / d0;
    return scaleXf(s, s, o.x, o.y);
  }
  if (gesture.mode === "reflect") {
    const ang = Math.atan2(p.y - o.y, p.x - o.x);
    return mulXf(translateXf(o.x, o.y), mulXf(rotateXf(ang), mulXf([1, 0, 0, -1, 0, 0], mulXf(rotateXf(-ang), translateXf(-o.x, -o.y)))));
  }
  if (gesture.mode === "shear") {
    const shx = (p.x - gesture.start.x) / 120;
    return mulXf(translateXf(o.x, o.y), mulXf([1, 0, shx, 1, 0, 0], translateXf(-o.x, -o.y)));
  }
  return null;
}

function scaleFromHandle(b, handle, p, shift) {
  let x0 = b.x0, y0 = b.y0, x1 = b.x1, y1 = b.y1;
  if (handle.includes("w")) x0 = p.x;
  if (handle.includes("e")) x1 = p.x;
  if (handle.includes("n")) y0 = p.y;
  if (handle.includes("s")) y1 = p.y;
  if (handle === "n" || handle === "s") { /* keep x */ }
  const ow = b.x1 - b.x0 || 1, oh = b.y1 - b.y0 || 1;
  let sx = (x1 - x0) / ow, sy = (y1 - y0) / oh;
  if (shift) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
  const ox = handle.includes("w") ? b.x1 : handle.includes("e") ? b.x0 : (b.x0 + b.x1) / 2;
  const oy = handle.includes("n") ? b.y1 : handle.includes("s") ? b.y0 : (b.y0 + b.y1) / 2;
  if (handle === "n" || handle === "s") sx = 1;
  if (handle === "e" || handle === "w") sy = 1;
  return scaleXf(sx, sy, ox, oy);
}

function liveXf(xf) {
  if (!xf) return;
  const [a, b, c, d, e, f] = xf;
  const { map } = indexNodes(file());
  for (const id of doc().selection) {
    const n = map.get(id);
    const el = $("art").querySelector(`g[data-id="${id}"], path[data-id="${id}"]`);
    if (el) el.setAttribute("transform", `matrix(${a} ${b} ${c} ${d} ${e} ${f})`);
    void n;
  }
  paintOverlay();
}

/** New art respects Draw Normal / Behind / Inside (Shift+D). */
function placeArt(file, node) {
  if (ui.drawMode === "inside" && ui.drawInside != null) {
    if (placeInside(file, node, ui.drawInside)) return node;
  }
  if (ui.drawMode === "behind") {
    const { map, parent } = indexNodes(file);
    const sel = doc()?.file === file ? doc().selection : [];
    const anchor = sel.map((id) => map.get(id)).find(Boolean);
    const list = anchor ? parent.get(anchor.id)?.kind?.children : null;
    if (list) {
      const idx = list.findIndex((c) => c.id === anchor.id);
      list.splice(Math.max(0, idx), 0, node);
      return node;
    }
    activeLayer(file, doc()?.currentLayer).kind.children.unshift(node);
    return node;
  }
  addToLayer(file, node, doc()?.currentLayer);
  return node;
}
function placeInside(file, node, targetId) {
  const { map, parent } = indexNodes(file);
  const target = map.get(targetId);
  if (!target) return false;
  const par = parent.get(target.id);
  if (par?.kind?.type === "group" && par.kind.clip && par.kind.children?.[1]?.id === target.id) {
    par.kind.children.push(node);
    return true;
  }
  const list = par?.kind?.children;
  if (!list) return false;
  const idx = list.findIndex((c) => c.id === target.id);
  if (idx < 0) return false;
  const mask = deepClone(target);
  mask.id = allocId(file);
  mask.name = null;
  mask.appearance = defaultAppearance(nonePaint(), nonePaint(), 0);
  if (mask.kind?.type === "path") mask.kind.clipping = true;
  if (mask.kind?.type === "compound") mask.kind.clipping = true;
  const group = blankNode(allocId(file), { type: "group", clip: true, children: [mask, target] }, defaultAppearance(nonePaint(), nonePaint(), 0));
  list.splice(idx, 1, group);
  group.kind.children.push(node);
  return true;
}
function setDrawMode(mode) {
  if (mode === "inside") {
    const nodes = selectedNodes();
    const n = nodes[0];
    if (nodes.length !== 1 || !["path", "compound", "text"].includes(n?.kind?.type)) {
      toast("Draw Inside needs exactly one selected path, compound path or text");
      return;
    }
    ui.drawInside = n.id;
  } else ui.drawInside = null;
  ui.drawMode = mode;
  drawToolbar();
}
function cycleDrawMode() {
  if (ui.drawMode === "normal") setDrawMode("behind");
  else if (ui.drawMode === "behind") {
    const nodes = selectedNodes();
    const ok = nodes.length === 1 && ["path", "compound", "text"].includes(nodes[0]?.kind?.type);
    setDrawMode(ok ? "inside" : "normal");
  } else setDrawMode("normal");
}
function toggleScreen() {
  ui.screen = !ui.screen;
  document.getElementById("app").classList.toggle("screen", ui.screen);
  drawToolbar();
  requestAnimationFrame(() => { if (doc()) fit("art"); });
}

function shapePath(p, shift, alt) {
  let x0 = gesture.start.x, y0 = gesture.start.y, x1 = p.x, y1 = p.y;
  if (alt) { x0 = gesture.start.x - (x1 - gesture.start.x); y0 = gesture.start.y - (y1 - gesture.start.y); }
  let w = x1 - x0, h = y1 - y0;
  if (shift && gesture.tool !== "lineSegment") {
    const s = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s;
  }
  const tool = gesture.tool;
  if (tool === "rectangle") return pathFromAnchors([{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }], true);
  if (tool === "roundedRectangle") return roundedRectPath(x0, y0, w, h, Math.min(Math.abs(w), Math.abs(h)) * 0.2);
  if (tool === "ellipse") return ellipsePath(x0 + w / 2, y0 + h / 2, Math.abs(w) / 2, Math.abs(h) / 2);
  if (tool === "polygon") return polygonPath(x0 + w / 2, y0 + h / 2, Math.max(Math.abs(w), Math.abs(h)) / 2, gesture.sides || 6);
  if (tool === "star") return starPath(x0 + w / 2, y0 + h / 2, Math.max(Math.abs(w), Math.abs(h)) / 2, gesture.sides || 5, 0.4);
  if (tool === "lineSegment") return linePath(gesture.start.x, gesture.start.y, p.x, p.y);
  return null;
}
function previewShape(p, shift, alt) {
  const path = shapePath(p, shift, alt);
  const g = $("art").querySelector("#live-preview");
  if (!g || !path) return;
  const fill = ui.fill?.type === "solid" ? rgbCss(ui.fill.color) : "none";
  const stroke = ui.stroke?.type === "solid" ? rgbCss(ui.stroke.color) : "none";
  g.innerHTML = `<path d="${pathD(path)}" fill="${fill}" stroke="${stroke}" stroke-width="${ui.strokeWidth}"/>`;
}
function commitShape(p, shift, alt) {
  const path = shapePath(p, shift, alt);
  const g = $("art").querySelector("#live-preview");
  if (g) g.innerHTML = "";
  if (!path) return;
  const b = pathBounds(path);
  if (b && b.x1 - b.x0 < 1 && b.y1 - b.y0 < 1 && gesture.tool !== "lineSegment") return;
  const d = doc();
  pushHistory();
  const names = { rectangle: "Rectangle", roundedRectangle: "Rounded Rectangle", ellipse: "Ellipse", polygon: "Polygon", star: "Star", lineSegment: "Line" };
  const node = makePathNode(d.file, path, { ...styleNow(), name: names[gesture.tool] || "Path" });
  if (gesture.tool === "lineSegment") setPaint(node, "fill", nonePaint());
  placeArt(d.file, node);
  d.selection = [node.id];
  d.artboard = artboardAt(p);
  paint(); refreshChrome();
}
function previewPolyline(pts) {
  const g = $("art").querySelector("#live-preview");
  if (!g || pts.length < 2) return;
  g.innerHTML = `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${ui.stroke?.type === "solid" ? rgbCss(ui.stroke.color) : "#111"}" stroke-width="${gesture.tool === "paintbrush" ? Math.max(ui.strokeWidth, 6) : ui.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function commitFreehand() {
  const g = $("art").querySelector("#live-preview");
  if (g) g.innerHTML = "";
  const pts = simplify(gesture.pts || [], 1.4);
  if (pts.length < 2) return;
  const d = doc();
  if (gesture.tool === "eraser") { eraseAlong(pts); return; }
  pushHistory();
  const path = pathFromAnchors(pts, false);
  const node = makePathNode(d.file, path, {
    fill: nonePaint(),
    stroke: ui.stroke?.type === "none" ? solid(0, 0, 0) : ui.stroke,
    strokeWidth: gesture.tool === "paintbrush" ? Math.max(8, ui.strokeWidth) : Math.max(1, ui.strokeWidth),
    name: gesture.tool === "paintbrush" ? "Brush" : "Pencil",
  });
  placeArt(d.file, node);
  d.selection = [node.id];
  paint(); refreshChrome();
}
function eraseAlong(pts) {
  const d = doc();
  const width = 14;
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    const t = { x: next.x - prev.x, y: next.y - prev.y };
    const l = Math.hypot(t.x, t.y) || 1;
    const nx = -t.y / l * width / 2, ny = t.x / l * width / 2;
    left.push({ x: pts[i].x + nx, y: pts[i].y + ny });
    right.push({ x: pts[i].x - nx, y: pts[i].y - ny });
  }
  const cutter = [...left, ...right.reverse()];
  const { map } = indexNodes(d.file);
  const hits = [];
  for (const n of map.values()) {
    if (n.kind?.type !== "path") continue;
    if (pts.some((p) => hitsGeometry(n, p, width))) hits.push(n);
  }
  if (!hits.length) return;
  pushHistory();
  for (const n of hits) {
    const ring = ringOf(n);
    if (!ring) { removeNodes(d.file, [n.id]); continue; }
    const remain = polygonBoolean(ring, cutter, "difference");
    const par = indexNodes(d.file).parent.get(n.id);
    const list = childrenOf(par);
    const i = list?.indexOf(n) ?? -1;
    if (i < 0) continue;
    if (!remain.length) { list.splice(i, 1); continue; }
    const made = remain.map((r) => {
      const node = makePathNode(d.file, pathFromAnchors(r, true), {
        fill: primaryFill(n), stroke: primaryStroke(n)?.paint || nonePaint(), strokeWidth: primaryStroke(n)?.width || 1, name: n.name,
      });
      return node;
    });
    list.splice(i, 1, ...made);
  }
  d.selection = [];
  paint(); refreshChrome();
}

function penClick(p, e) {
  const d = doc();
  if (!ui.pen) ui.pen = { anchors: [] };
  const anchors = ui.pen.anchors;
  if (anchors.length >= 3 && dist(p, anchors[0].p) < 8 / d.zoom) {
    finishPen(true);
    return;
  }
  anchors.push({ p: { ...p }, in: { ...p }, out: { ...p }, kind: "Corner" });
  gesture.mode = "penhandle";
  gesture.penIndex = anchors.length - 1;
  paintOverlay();
  if (e.detail === 2) finishPen(false);
}
function onPenDrag(e) {
  if (gesture.mode !== "penhandle" || !ui.pen) return;
  const p = screenToDoc(local(e).x, local(e).y);
  const a = ui.pen.anchors[gesture.penIndex];
  a.out = { ...p };
  a.in = { x: a.p.x * 2 - p.x, y: a.p.y * 2 - p.y };
  a.kind = "Smooth";
  paintOverlay();
}
function finishPen(closed) {
  const d = doc();
  const anchors = ui.pen?.anchors || [];
  ui.pen = null;
  gesture.cursor = null;
  gesture.mode = null;
  if (anchors.length < 2) { paintOverlay(); return; }
  pushHistory();
  const node = makePathNode(d.file, { subpaths: [{ anchors, closed }] }, { ...styleNow(), name: "Path" });
  placeArt(d.file, node);
  d.selection = [node.id];
  paint(); refreshChrome();
}
function curveClick(p, e) {
  if (!ui.pen) ui.pen = { anchors: [], curve: true };
  ui.pen.anchors.push({ p: { ...p }, in: { ...p }, out: { ...p }, kind: "Smooth" });
  if (e.detail === 2) finishCurve();
  else paintOverlay();
}
function finishCurve() {
  const d = doc();
  const pts = (ui.pen?.anchors || []).map((a) => a.p);
  ui.pen = null;
  gesture.cursor = null;
  if (pts.length < 2) return;
  pushHistory();
  const node = makePathNode(d.file, smoothThrough(pts, false), { ...styleNow(), name: "Curve" });
  placeArt(d.file, node);
  d.selection = [node.id];
  paint(); refreshChrome();
}
function smoothThrough(pts, closed) {
  const n = pts.length;
  const anchors = pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
    if (!closed && (i === 0 || i === n - 1)) return { p: { ...p }, in: { ...p }, out: { ...p }, kind: "Corner" };
    return {
      p: { ...p },
      in: { x: p.x - (next.x - prev.x) / 6, y: p.y - (next.y - prev.y) / 6 },
      out: { x: p.x + (next.x - prev.x) / 6, y: p.y + (next.y - prev.y) / 6 },
      kind: "Smooth",
    };
  });
  return { subpaths: [{ anchors, closed }] };
}

function typeAt(p) {
  const d = doc();
  const hit = hitAt(p, true);
  if (hit?.kind?.type === "text") { d.selection = [hit.id]; beginTextEdit(hit); return; }
  pushHistory();
  const node = makeText(d.file, p.x, p.y, "", { size: 32, fill: ui.fill?.type === "solid" ? ui.fill : solid(0.1, 0.1, 0.12) });
  placeArt(d.file, node);
  d.selection = [node.id];
  paint();
  beginTextEdit(node);
}
function beginTextEdit(node) {
  const xf = node.kind.xf || ident();
  const o = applyXf(xf, { x: 0, y: 0 });
  const s = docToScreen(o);
  const size = (node.kind.runs?.[0]?.style?.size || 24) * doc().zoom;
  let input = $("textedit");
  if (!input) {
    input = document.createElement("input");
    input.id = "textedit";
    input.className = "textedit";
    $("canvas").appendChild(input);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commitText(); }
      if (e.key === "Escape") { input.remove(); }
      e.stopPropagation();
    });
    input.addEventListener("blur", () => commitText());
  }
  input.dataset.id = node.id;
  input.value = textOf(node);
  input.style.left = s.x + "px";
  input.style.top = (s.y - size) + "px";
  input.style.fontSize = size + "px";
  input.style.width = Math.max(80, input.value.length * size * 0.6 + 24) + "px";
  input.focus();
  input.select();
}
function commitText() {
  const input = $("textedit");
  if (!input) return;
  const d = doc();
  const { map } = indexNodes(d.file);
  const n = map.get(+input.dataset.id);
  if (n) {
    if (!input.value) { pushHistory(); removeNodes(d.file, [n.id]); d.selection = []; }
    else setText(n, input.value);
  }
  input.remove();
  paint(); refreshChrome();
}

function wand(p) {
  const hit = hitAt(p, true);
  if (!hit) return;
  doc().selection = [hit.id];
  selectSame("fill");
}
function sample(p) {
  const hit = hitAt(p, true);
  if (!hit) return;
  const f = primaryFill(hit), s = primaryStroke(hit);
  if (f) ui.fill = deepClone(f);
  if (s?.paint) { ui.stroke = deepClone(s.paint); ui.strokeWidth = s.width || 1; }
  if (doc().selection.length) {
    pushHistory();
    const { map } = indexNodes(file());
    for (const id of doc().selection) {
      const n = map.get(id);
      if (!n || n.id === hit.id) continue;
      if (f) setPaint(n, "fill", deepClone(f));
      if (s?.paint) setPaint(n, "stroke", deepClone(s.paint));
    }
    paint();
  }
  drawToolbar();
  refreshChrome();
  toast("Sampled appearance");
}
function blendClick(p) {
  const hit = hitAt(p, true);
  if (!hit) return;
  if (!ui.blendPick) { ui.blendPick = hit.id; toast("Now click the second object"); return; }
  doc().selection = [ui.blendPick, hit.id];
  ui.blendPick = null;
  makeBlendFromSelection();
}
function addAnchorAt(p) {
  const hit = hitAt(p, true);
  if (hit?.kind?.type !== "path") return;
  const sp = hit.kind.path.subpaths[0];
  if (!sp) return;
  let best = Infinity, idx = 0;
  for (let i = 0; i < sp.anchors.length; i++) {
    const a = sp.anchors[i].p, b = sp.anchors[(i + 1) % sp.anchors.length].p;
    const dd = dist(p, a) + dist(p, b);
    if (dd < best) { best = dd; idx = i; }
  }
  pushHistory();
  sp.anchors.splice(idx + 1, 0, { p: { ...p }, in: { ...p }, out: { ...p }, kind: "Corner" });
  doc().selection = [hit.id];
  paint();
}
function deleteAnchorAt(p) {
  const a = anchorAt(p);
  if (!a) return;
  const sp = a.node.kind.path.subpaths[a.si];
  pushHistory();
  sp.anchors.splice(a.ai, 1);
  if (sp.anchors.length < 2) removeNodes(file(), [a.node.id]);
  paint();
}
function convertAnchor(p) {
  const a = anchorAt(p);
  if (!a) return;
  const an = a.node.kind.path.subpaths[a.si].anchors[a.ai];
  const sp = a.node.kind.path.subpaths[a.si];
  pushHistory();
  if (an.kind === "Smooth") {
    an.kind = "Corner"; an.in = { ...an.p }; an.out = { ...an.p };
  } else {
    const prev = sp.anchors[(a.ai - 1 + sp.anchors.length) % sp.anchors.length].p;
    const next = sp.anchors[(a.ai + 1) % sp.anchors.length].p;
    an.kind = "Smooth";
    an.in = { x: an.p.x - (next.x - prev.x) / 6, y: an.p.y - (next.y - prev.y) / 6 };
    an.out = { x: an.p.x + (next.x - prev.x) / 6, y: an.p.y + (next.y - prev.y) / 6 };
  }
  doc().selection = [a.node.id];
  paint();
}
function smoothHit(p) {
  const hit = hitAt(p, true);
  if (hit?.kind?.type !== "path") return;
  pushHistory();
  for (const sp of hit.kind.path.subpaths) {
    const pts = sp.anchors.map((a) => a.p);
    const sm = simplify(pts, 4);
    const rebuilt = smoothThrough(sm, sp.closed);
    sp.anchors = rebuilt.subpaths[0].anchors;
  }
  paint();
}
function setGradient(angle, a, b, commit) {
  const d = doc();
  if (!d?.selection.length) return;
  if (commit) pushHistory();
  const { map } = indexNodes(d.file);
  for (const id of d.selection) {
    const n = map.get(id);
    if (!n) continue;
    let fill = primaryFill(n);
    if (!fill || fill.type !== "gradient") {
      const c = fill?.type === "solid" ? fill.color : { model: "rgb", r: 0.2, g: 0.45, b: 0.95 };
      fill = { type: "gradient", angle, gradient: { kind: "Linear", stops: [
        { offset: 0, color: c, opacity: 1, midpoint: 0.5 },
        { offset: 1, color: { model: "rgb", r: 1, g: 1, b: 1 }, opacity: 1, midpoint: 0.5 },
      ] } };
      setPaint(n, "fill", fill);
    } else fill.angle = angle;
  }
  if (commit) { paint(); toast(`Gradient ${Math.round(angle)}°`); }
}
function commitBuilder() {
  const d = doc();
  const pts = gesture.pts || [];
  const g = $("art").querySelector("#live-preview");
  if (g) g.innerHTML = "";
  const { map } = indexNodes(d.file);
  const hitIds = [];
  for (const n of map.values()) {
    if (n.kind?.type !== "path") continue;
    if (pts.some((p) => hitsGeometry(n, p, 4))) hitIds.push(n.id);
  }
  if (hitIds.length < 2) { toast("Drag across two or more shapes"); return; }
  d.selection = hitIds;
  pathfinder("union");
}

/* ---------- chrome ---------- */

function refreshChrome() {
  drawHint();
  drawAppearanceFloat();
  drawTabs();
  drawControl();
  drawTaskbar();
  drawPanel();
  status();
  const d = doc();
  document.title = d ? `${d.name} — VectorCraft` : "VectorCraft";
}

function drawAppbar() {
  $("appbar").innerHTML = `
    <img class="brand" src="/assets/app-icon/hicolor/32x32/apps/ai.storyteller.vectorcraft.png" alt=""/>
    <span class="wordmark">VectorCraft</span>
    <button class="home-btn ${ui.home ? "on" : ""}" id="home-btn" title="Home">${icon("home", 14)}</button>
    <nav class="menus">${["File", "Edit", "Object", "Type", "Select", "Effect", "View", "Window", "Help"].map((m) => `<button class="menu-btn" data-menu="${m}">${m}</button>`).join("")}</nav>
    <div class="spacer"></div>
    <a class="discord" href="https://discord.gg/artcraft" target="_blank" rel="noreferrer">${icon("discord", 12)} Discord</a>
    <label class="search">${icon("search", 12)}<input id="search" placeholder="Search commands and tools" value="${esc(ui.query)}"/></label>
    <button class="workspace" id="ws-btn"><span>Essentials</span>${icon("chevron", 12)}</button>
    <div class="wins">
      <button class="win-btn" id="win-min" title="Minimize">${icon("minus", 12)}</button>
      <button class="win-btn" id="win-max" title="Focus canvas">${icon("square", 11)}</button>
      <button class="win-btn close" id="win-close" title="Close">${icon("close", 12)}</button>
    </div>`;
  $("appbar").querySelectorAll(".menu-btn").forEach((b) => b.onclick = (e) => openMenu(b.dataset.menu, b.getBoundingClientRect()));
  $("home-btn").onclick = () => { ui.home = !ui.home; drawHome(); drawAppbar(); };
  $("ws-btn").onclick = (e) => openWorkspace(e.currentTarget.getBoundingClientRect());
  $("win-close").onclick = () => commands.close();
  $("win-min").onclick = () => toast("VectorCraft is running in the browser");
  $("win-max").onclick = () => { ui.panels = !ui.panels; $("dock").style.display = ui.panels ? "" : "none"; $("toolbar").style.display = ui.panels ? "" : "none"; };
  const search = $("search");
  search.addEventListener("focus", () => openPalette());
  search.addEventListener("input", () => { ui.query = search.value; openPalette(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closePops(); search.blur(); }
    if (e.key === "Enter") {
      const hit = paletteItems().find((i) => i.label.toLowerCase().includes(search.value.toLowerCase()));
      if (hit) { closePops(); runItem(hit); }
    }
    e.stopPropagation();
  });
}

function menuItems(name) {
  const recent = (() => { try { return JSON.parse(localStorage.getItem("vc-recent") || "[]"); } catch { return []; } })();
  const tables = {
    File: [
      { label: "New…", cmd: "new", sc: "Ctrl+N" },
      { label: "Open…", cmd: "open", sc: "Ctrl+O" },
      { label: "Open Example", items: EXAMPLES.map((ex) => ({ label: ex.title, run: () => openExample(ex.file).catch((e) => toast(e.message)) })) },
      { label: "Open Recent", items: recent.length ? recent.map((r) => ({ label: r.name, run: () => r.text ? openText(r.name, r.text) : openExample(r.name) })) : [{ label: "None", disabled: true }] },
      { sep: true },
      { label: "Save", cmd: "save", sc: "Ctrl+S" },
      { label: "Save As…", cmd: "saveAs", sc: "Ctrl+Shift+S" },
      { sep: true },
      { label: "Export SVG", cmd: "exportSVG", sc: "Ctrl+E" },
      { label: "Export PNG", cmd: "exportPNG" },
      { sep: true },
      { label: "Document Setup…", cmd: "documentSetup" },
      { label: "Close", cmd: "close", sc: "Ctrl+W" },
    ],
    Edit: [
      { label: "Undo", cmd: "undo", sc: "Ctrl+Z" },
      { label: "Redo", cmd: "redo", sc: "Ctrl+Shift+Z" },
      { sep: true },
      { label: "Cut", cmd: "cut", sc: "Ctrl+X" },
      { label: "Copy", cmd: "copy", sc: "Ctrl+C" },
      { label: "Paste", cmd: "paste", sc: "Ctrl+V" },
      { label: "Paste in Place", cmd: "pasteInPlace", sc: "Ctrl+Shift+V" },
      { label: "Duplicate", cmd: "duplicate", sc: "Ctrl+D" },
      { label: "Delete", cmd: "delete", sc: "Del" },
      { sep: true },
      { label: "Select All", cmd: "selectAll", sc: "Ctrl+A" },
      { label: "Deselect", cmd: "deselect", sc: "Ctrl+Shift+A" },
      { sep: true },
      { label: "Preferences…", cmd: "prefs" },
    ],
    Object: [
      { label: "Transform", items: [
        { label: "Rotate 90°", run: () => rotateSel(Math.PI / 2) },
        { label: "Rotate 180°", run: () => rotateSel(Math.PI) },
        { label: "Flip Horizontal", run: () => flipSel(-1, 1) },
        { label: "Flip Vertical", run: () => flipSel(1, -1) },
      ] },
      { label: "Arrange", items: [
        { label: "Bring to Front", cmd: "bringFront", sc: "Ctrl+Shift+]" },
        { label: "Bring Forward", cmd: "bringForward", sc: "Ctrl+]" },
        { label: "Send Backward", cmd: "sendBackward", sc: "Ctrl+[" },
        { label: "Send to Back", cmd: "sendBack", sc: "Ctrl+Shift+[" },
      ] },
      { sep: true },
      { label: "Group", cmd: "group", sc: "Ctrl+G" },
      { label: "Ungroup", cmd: "ungroup", sc: "Ctrl+Shift+G" },
      { label: "Lock", cmd: "lock", sc: "Ctrl+2" },
      { label: "Unlock All", cmd: "unlockAll" },
      { label: "Hide", cmd: "hide", sc: "Ctrl+3" },
      { label: "Show All", cmd: "showAll" },
      { sep: true },
      { label: "Blend", items: [
        { label: "Make", cmd: "makeBlend" },
        { label: "Expand", cmd: "expand" },
      ] },
      { label: "Pathfinder", items: [
        { label: "Unite", cmd: "pathfinderUnite" },
        { label: "Minus Front", cmd: "pathfinderMinus" },
        { label: "Intersect", cmd: "pathfinderIntersect" },
        { label: "Exclude", cmd: "pathfinderExclude" },
      ] },
    ],
    Type: [
      { label: "Size +", run: () => bumpSize(2) },
      { label: "Size −", run: () => bumpSize(-2) },
      { label: "Bold", run: () => setFontStyle("Bold") },
      { label: "Italic", run: () => setFontStyle("Italic") },
      { label: "Align Left", run: () => setJustify("Left") },
      { label: "Align Center", run: () => setJustify("Center") },
      { label: "Align Right", run: () => setJustify("Right") },
    ],
    Select: [
      { label: "All", cmd: "selectAll", sc: "Ctrl+A" },
      { label: "Deselect", cmd: "deselect" },
      { label: "Inverse", cmd: "inverse" },
      { sep: true },
      { label: "Same Fill Color", cmd: "sameFill" },
      { label: "Same Stroke Color", cmd: "sameStroke" },
    ],
    Effect: [
      { label: "Warp", items: [
        { label: "Flag", cmd: "warpFlag" },
        { label: "Arc", cmd: "warpArc" },
        { label: "Wave", cmd: "warpWave" },
      ] },
      { label: "Stylize", items: [{ label: "Outer Glow", cmd: "outerGlow" }] },
    ],
    View: [
      { label: ui.outline ? "Preview" : "Outline", cmd: "toggleOutline", sc: "Ctrl+Y" },
      { sep: true },
      { label: "Zoom In", cmd: "zoomIn", sc: "Ctrl++" },
      { label: "Zoom Out", cmd: "zoomOut", sc: "Ctrl+-" },
      { label: "Fit Artboard in Window", cmd: "fitArtboard", sc: "Ctrl+0" },
      { label: "Fit Selection", cmd: "fitSelection" },
      { label: "Actual Size", cmd: "actualSize", sc: "Ctrl+1" },
      { sep: true },
      { label: (ui.rulers ? "✓ " : "") + "Rulers", cmd: "toggleRulers", sc: "Ctrl+R" },
      { label: (ui.grid ? "✓ " : "") + "Grid", cmd: "toggleGrid", sc: "Ctrl+'" },
      { label: ((readGrid(file()) && readGrid(file()).visible !== false) ? "✓ " : "") + "Perspective Grid", cmd: "togglePerspective" },
      { label: (ui.snap ? "✓ " : "") + "Snap", cmd: "toggleSnap" },
      { label: (ui.control ? "✓ " : "") + "Control Bar", cmd: "toggleControl" },
    ],
    Window: [
      ...RAIL.map((r) => ({ label: r.label, run: () => { ui.panel = r.id; ui.panels = true; $("dock").style.display = ""; drawPanel(); } })),
      { sep: true },
      { label: "Command Palette", run: () => { $("search")?.focus(); openPalette(); }, sc: "Ctrl+K" },
    ],
    Help: [
      { label: "Keyboard Shortcuts", cmd: "shortcuts" },
      { label: "VectorCraft on GitHub", run: () => window.open("https://github.com/Ulyanique/vectorcraft", "_blank") },
      { sep: true },
      { label: "About VectorCraft", cmd: "about" },
    ],
  };
  return tables[name] || [];
}

function openMenu(name, rect, parent) {
  if (!parent) closePops();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.style.left = (parent ? rect.right - 4 : rect.left) + "px";
  menu.style.top = (parent ? rect.top : rect.bottom) + "px";
  menu.innerHTML = menuItems(name).map((it, i) => it.sep ? `<div class="sep-line"></div>` : `<button class="mi" data-i="${i}" ${it.disabled ? "disabled" : ""}><span class="ck"></span><span>${esc(it.label)}</span>${it.sc ? `<span class="sc">${it.sc}</span>` : ""}${it.items ? `<span class="submark">›</span>` : ""}</button>`).join("");
  document.body.appendChild(menu);
  const items = menuItems(name);
  menu.querySelectorAll(".mi").forEach((btn) => {
    const it = items[+btn.dataset.i];
    btn.onmouseenter = () => {
      menu.querySelectorAll(".menu").forEach((n) => n.remove());
      if (it.items) openSub(it.items, btn.getBoundingClientRect());
    };
    btn.onclick = () => {
      if (it.items) return;
      closePops();
      runItem(it);
    };
  });
}
function openSub(items, rect) {
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.style.left = rect.right + "px";
  menu.style.top = rect.top + "px";
  menu.innerHTML = items.map((it, i) => `<button class="mi" data-i="${i}"><span class="ck"></span><span>${esc(it.label)}</span></button>`).join("");
  document.body.appendChild(menu);
  const box = menu.getBoundingClientRect();
  if (box.right > innerWidth) menu.style.left = (rect.left - box.width) + "px";
  menu.querySelectorAll(".mi").forEach((btn) => btn.onclick = () => { closePops(); runItem(items[+btn.dataset.i]); });
}
function runItem(it) {
  if (it.cmd && commands[it.cmd]) commands[it.cmd]();
  else if (it.run) it.run();
  else if (it.tool) setTool(it.tool);
}

function rotateSel(rad) {
  const d = doc();
  const b = selectionBounds(d.file, d.selection);
  if (!b) return;
  const c = center(b);
  pushHistory();
  const { map } = indexNodes(d.file);
  for (const id of d.selection) transformNode(map.get(id), rotateXf(rad, c.x, c.y));
  paint();
}
function flipSel(sx, sy) {
  const d = doc();
  const b = selectionBounds(d.file, d.selection);
  if (!b) return;
  const c = center(b);
  pushHistory();
  const { map } = indexNodes(d.file);
  for (const id of d.selection) transformNode(map.get(id), scaleXf(sx, sy, c.x, c.y));
  paint();
}
function bumpSize(delta) {
  const n = selectedNodes().find((x) => x.kind?.type === "text");
  if (!n) return;
  pushHistory();
  const st = n.kind.runs[0].style;
  st.size = Math.max(1, (st.size || 16) + delta);
  paint(); refreshChrome();
}
function setFontStyle(style) {
  const n = selectedNodes().find((x) => x.kind?.type === "text");
  if (!n) return;
  pushHistory();
  n.kind.runs[0].style.font_style = style;
  paint();
}
function setJustify(j) {
  const n = selectedNodes().find((x) => x.kind?.type === "text");
  if (!n) return;
  pushHistory();
  n.kind.para = n.kind.para || {};
  n.kind.para.justify = j;
  paint();
}

function drawTabs() {
  const el = $("tabstrip");
  if (!ui.docs.length) { el.innerHTML = ""; return; }
  el.innerHTML = ui.docs.map((d, i) => {
    const z = Math.round(d.zoom * 100);
    const mode = String(d.file.document.color_mode || "RGB").toUpperCase();
    const label = `${d.name}${d.dirty ? " *" : ""} @ ${z} % (${mode}/${ui.outline ? "Outline" : "Preview"})`;
    return `<div class="tab ${i === ui.active ? "active" : ""}" data-i="${i}"><span class="name">${esc(label)}</span><button class="x" data-x="${i}" title="Close">×</button></div>`;
  }).join("");
  el.querySelectorAll(".tab").forEach((t) => t.onclick = (e) => {
    if (e.target.closest(".x")) return;
    ui.active = +t.dataset.i;
    ui.home = false;
    paint(); refreshChrome(); drawHome();
  });
  el.querySelectorAll(".x").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    ui.active = +b.dataset.x;
    commands.close();
  });
}

function drawToolbar() {
  const tb = $("toolbar");
  const parts = [`<button class="tb-collapse" id="tb-collapse" title="Labels">${ui.labels ? "▴" : "▾"}</button>`];
  for (const cat of TOOL_DEFS) {
    if (ui.labels) parts.push(`<div class="tb-cat">${cat.cat}</div>`);
    for (const slot of cat.slots) {
      const chosen = ui.slotChoice[slot.id] || slot.id;
      const tool = toolById(chosen) || slot;
      const on = ui.tool === tool.id;
      parts.push(`<button class="tool ${on ? "on" : ""}" data-tool="${tool.id}" data-slot="${slot.id}" title="${esc(tool.label)}${tool.key ? " (" + tool.key + ")" : ""}">${icon(tool.icon)}${slot.flyout ? `<i class="fly"></i>` : ""}</button>`);
    }
  }
  const fill = ui.fill?.type === "solid" ? rgbCss(ui.fill.color) : ui.fill?.type === "gradient" ? "linear-gradient(90deg,#378ef0,#fff)" : "transparent";
  const stroke = ui.stroke?.type === "solid" ? rgbCss(ui.stroke.color) : "transparent";
  const strokeNone = !ui.stroke || ui.stroke.type === "none";
  const proxy = `<div class="proxy">
    <div class="proxy-squares">
      <button class="sq fill ${ui.paintTarget === "fill" ? "active" : ""}" id="proxy-fill" style="background:${fill}" title="Fill"></button>
      <button class="sq stroke ${strokeNone ? "none" : ""} ${ui.paintTarget === "stroke" ? "active" : ""}" id="proxy-stroke" style="border-color:${strokeNone ? "#111" : stroke};background:${strokeNone ? "" : "transparent"}" title="Stroke"></button>
    </div>
    <div class="proxy-chips">
      <button class="chiplet" id="proxy-color" title="Color (,)" style="background:${ui.paintTarget === "fill" ? fill : stroke}"></button>
      <button class="chiplet grad" id="proxy-grad" title="Gradient (.)"></button>
      <button class="chiplet none" id="proxy-none" title="None (/)"></button>
    </div>
    <div class="proxy-row">
      <button class="mini ${ui.drawMode !== "normal" ? "on" : ""}" id="proxy-mode" title="${ui.drawMode === "behind" ? "Draw Behind" : ui.drawMode === "inside" ? "Draw Inside" : "Draw Normal"} (Shift+D)">${icon(ui.drawMode === "behind" ? "drawBehind" : ui.drawMode === "inside" ? "drawInside" : "drawNormal", 14)}</button>
      <button class="mini ${ui.screen ? "on" : ""}" id="proxy-screen" title="Change Screen Mode (F)">${icon("screenMode", 14)}</button>
      <button class="mini" id="proxy-more" title="More">${icon("ellipsis", 14)}</button>
    </div>
  </div>`;
  tb.innerHTML = `<div class="tb-scroll">${parts.join("")}</div>${proxy}`;
  tb.querySelectorAll(".tool").forEach((btn) => {
    btn.onclick = (e) => {
      const slot = TOOL_DEFS.flatMap((c) => c.slots).find((s) => s.id === btn.dataset.slot);
      const r = btn.getBoundingClientRect();
      if (slot?.flyout && e.clientX > r.right - 12 && e.clientY > r.bottom - 12) openFlyout(slot, r);
      else if (slot?.flyout && ui.tool === btn.dataset.tool) openFlyout(slot, r);
      else setTool(btn.dataset.tool);
    };
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      const slot = TOOL_DEFS.flatMap((c) => c.slots).find((s) => s.id === btn.dataset.slot);
      if (slot?.flyout) openFlyout(slot, btn.getBoundingClientRect());
    };
  });
  $("tb-collapse").onclick = () => { ui.labels = !ui.labels; drawToolbar(); };
  $("proxy-fill").onclick = () => { ui.paintTarget = "fill"; ui.panel = "color"; drawToolbar(); drawPanel(); };
  $("proxy-stroke").onclick = () => { ui.paintTarget = "stroke"; ui.panel = "color"; drawToolbar(); drawPanel(); };
  $("proxy-none").onclick = () => applyPaint(ui.paintTarget, nonePaint());
  $("proxy-mode").onclick = () => cycleDrawMode();
  $("proxy-screen").onclick = () => toggleScreen();
  $("proxy-more").onclick = (e) => openProxyMenu(e.currentTarget.getBoundingClientRect());
  $("proxy-color").onclick = () => {
    const paint = ui.paintTarget === "fill" ? ui.fill : ui.stroke;
    if (!paint || paint.type === "none" || paint.type === "gradient") applyPaint(ui.paintTarget, solid(0, 0, 0));
    else { ui.panel = "color"; drawPanel(); }
  };
  $("proxy-grad").onclick = () => setGradient(0, { x: 0, y: 0 }, { x: 1, y: 0 }, true);
}

function openProxyMenu(rect) {
  closePops();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.style.left = rect.right + 4 + "px";
  menu.style.top = rect.top + "px";
  const modes = [["normal", "Draw Normal"], ["behind", "Draw Behind"], ["inside", "Draw Inside"]];
  menu.innerHTML = modes.map(([id, label]) => `<button class="mi" data-mode="${id}"><span class="ck">${ui.drawMode === id ? "✓" : ""}</span><span>${label}</span></button>`).join("")
    + `<div class="sep-line"></div><button class="mi" data-swap="1"><span class="ck"></span><span>Swap Fill and Stroke</span><span class="sc">Shift+X</span></button>`;
  document.body.appendChild(menu);
  menu.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => { closePops(); setDrawMode(b.dataset.mode); });
  menu.querySelector("[data-swap]").onclick = () => { closePops(); swapPaint(); };
}
function swapPaint() {
  const f = ui.fill; ui.fill = ui.stroke; ui.stroke = f;
  if (doc()?.selection.length) {
    pushHistory();
    const { map } = indexNodes(file());
    for (const id of doc().selection) {
      const n = map.get(id);
      if (!n) continue;
      setPaint(n, "fill", deepClone(ui.fill));
      setPaint(n, "stroke", deepClone(ui.stroke));
    }
    paint();
  }
  drawToolbar();
}

function openFlyout(slot, rect) {
  closePops();
  const items = [slot, ...(slot.flyout || [])];
  const menu = document.createElement("div");
  menu.className = "flyout";
  menu.style.left = rect.right + 4 + "px";
  menu.style.top = rect.top + "px";
  menu.innerHTML = items.map((t) => `<button class="mi" data-id="${t.id}"><span class="ck">${ui.tool === t.id ? "•" : ""}</span>${icon(t.icon, 14)}<span>${esc(t.label)}</span>${t.key ? `<span class="sc">${t.key}</span>` : ""}</button>`).join("");
  document.body.appendChild(menu);
  menu.querySelectorAll(".mi").forEach((b) => b.onclick = () => {
    ui.slotChoice[slot.id] = b.dataset.id;
    setTool(b.dataset.id);
    closePops();
    drawToolbar();
  });
}

function openWorkspace(rect) {
  closePops();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.style.left = rect.left + "px";
  menu.style.top = rect.bottom + 4 + "px";
  menu.style.minWidth = "160px";
  const themes = [["mediumDark", "Medium Dark"], ["dark", "Dark"], ["mediumLight", "Medium Light"], ["light", "Light"]];
  menu.innerHTML = `<div class="mi" style="color:var(--text-dim)">Workspace</div>
    <button class="mi" data-ws="essentials"><span class="ck">✓</span>Essentials</button>
    <div class="sep-line"></div>
    <div class="mi" style="color:var(--text-dim)">Brightness</div>
    ${themes.map(([id, label]) => `<button class="mi" data-theme="${id}"><span class="ck">${ui.theme === id ? "✓" : ""}</span>${label}</button>`).join("")}`;
  document.body.appendChild(menu);
  menu.querySelectorAll("[data-theme]").forEach((b) => b.onclick = () => { setTheme(b.dataset.theme); closePops(); });
}

function setTheme(id) {
  ui.theme = id;
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem("vc-theme", id); } catch { /* ignore */ }
}

function drawControl() {
  const el = $("controlbar");
  el.hidden = !ui.control;
  if (!ui.control) return;
  const n = selectedNodes()[0];
  const fill = primaryFill(n);
  const stroke = primaryStroke(n);
  el.innerHTML = `<span class="cb-label">${n ? esc(objectLabel(n)) : "No selection"}</span>
    <span class="sep"></span>
    <span class="chip" style="background:${fill?.type === "solid" ? rgbCss(fill.color) : "#888"}"></span>
    <span class="chip" style="background:${stroke?.paint?.type === "solid" ? rgbCss(stroke.paint.color) : "transparent"};box-shadow:inset 0 0 0 2px ${stroke?.paint?.type === "solid" ? rgbCss(stroke.paint.color) : "#888"}"></span>
    <span class="sep"></span>
    <span class="cb-label">W</span><span>${stroke?.width ?? ui.strokeWidth} pt</span>
    <span class="sep"></span>
    <span class="cb-label">Op</span><span>${Math.round((n?.opacity ?? 1) * 100)}%</span>`;
}

function drawTaskbar() {
  const el = $("taskbar");
  const d = doc();
  const n = d ? selectedNodes() : [];
  if (!d || !n.length || ui.home) { el.hidden = true; return; }
  el.hidden = false;
  const fill = shownFill(n[0]);
  const b = selectionBounds(d.file, d.selection);
  const screen = b ? docToScreen({ x: (b.x0 + b.x1) / 2, y: b.y1 }) : { x: 200, y: 80 };
  const canvas = $("canvas").getBoundingClientRect();
  const left = ui.taskShift ? screen.x + ui.taskShift.x : screen.x;
  el.style.left = Math.max(160, Math.min(canvas.width - 160, left)) + "px";
  el.style.top = Math.max(8, screen.y + (ui.taskShift?.y || 18)) + "px";
  el.style.transform = "translateX(-50%)";
  el.style.bottom = "auto";
  const isText = n[0].kind?.type === "text";
  const isPath = n[0].kind?.type === "path" || n[0].kind?.type === "compound";
  const fillNone = !fill || fill.type === "none";
  el.innerHTML = `
    <i class="grip" id="task-grip" title="Drag"></i>
    ${isText ? `<button class="act" data-cmd="createOutlines">${icon("type", 14)} Create Outlines</button>` : ""}
    ${isPath && n.length === 1 ? `<button class="act" data-cmd="offsetPath">${icon("rectangle", 14)} Offset Path</button><button class="act" data-cmd="simplify">${icon("curvature", 14)} Simplify</button>` : ""}
    <button class="act" data-cmd="duplicate">${icon("copy", 14)} Duplicate</button>
    <button data-cmd="panel" data-arg="color" title="Fill"><i class="chip ${fillNone ? "none" : ""}" style="background:${fill?.type === "solid" ? rgbCss(fill.color) : ""}"></i></button>
    <button data-cmd="lockSel" title="Lock">${icon("lock", 14)}</button>
    <button id="task-more" title="More">···</button>`;
  el.querySelectorAll("button").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    if (b.dataset.cmd === "panel") { ui.panel = b.dataset.arg; drawPanel(); }
    else if (commands[b.dataset.cmd]) commands[b.dataset.cmd]();
  });
  const more = $("task-more");
  if (more) more.onclick = (e) => { e.stopPropagation(); openMenu("Object", more.getBoundingClientRect()); };
  const grip = $("task-grip");
  if (grip) grip.onpointerdown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const origin = { x: e.clientX, y: e.clientY, shift: { ...(ui.taskShift || { x: 0, y: 18 }) } };
    const move = (ev) => {
      ui.taskShift = { x: origin.shift.x + ev.clientX - origin.x, y: origin.shift.y + ev.clientY - origin.y };
      const bnow = selectionBounds(d.file, d.selection);
      const sc = bnow ? docToScreen({ x: (bnow.x0 + bnow.x1) / 2, y: bnow.y1 }) : screen;
      el.style.left = Math.max(160, Math.min(canvas.width - 160, sc.x + ui.taskShift.x)) + "px";
      el.style.top = Math.max(8, sc.y + ui.taskShift.y) + "px";
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

function drawPanel() {
  const keepSearch = document.activeElement?.id === "layer-search";
  const caret = keepSearch ? document.activeElement.selectionStart : 0;
  const scroll = document.querySelector(".llist")?.scrollTop || 0;
  const rail = $("rail");
  rail.innerHTML = ICON_GROUPS.map((group) => group.map((id) => {
    const [label, ic] = PANEL_META[id];
    return `<button class="${ui.panel === id ? "on" : ""}" data-p="${id}" title="${label}">${icon(ic, 15)}</button>`;
  }).join("") + `<div class="rail-gap"></div>`).join("");
  rail.querySelectorAll("button").forEach((b) => b.onclick = () => {
    if (ui.panel === b.dataset.p && ui.panels) { ui.panels = false; }
    else { ui.panel = b.dataset.p; ui.panels = true; }
    $("panel").classList.toggle("collapsed", !ui.panels);
    drawPanel();
  });
  $("panel").classList.toggle("collapsed", !ui.panels);
  const tabs = ["properties", "layers", "libraries"];
  $("ptabs").innerHTML = tabs.map((id) => `<button class="ptab ${ui.panel === id ? "on" : ""}" data-p="${id}">${id[0].toUpperCase() + id.slice(1)}</button>`).join("") + `<span class="grow"></span><button class="ptab" id="panel-menu">☰</button>`;
  $("ptabs").querySelectorAll("[data-p]").forEach((b) => b.onclick = () => { ui.panel = b.dataset.p; drawPanel(); });
  $("panel-menu").onclick = (e) => {
    closePops();
    const menu = document.createElement("div");
    menu.className = "menu";
    const r = e.currentTarget.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.top = r.bottom + "px";
    menu.innerHTML = RAIL.map((x) => `<button class="mi" data-p="${x.id}">${x.label}</button>`).join("");
    document.body.appendChild(menu);
    menu.querySelectorAll(".mi").forEach((b) => b.onclick = () => { ui.panel = b.dataset.p; closePops(); drawPanel(); });
  };
  $("pbody").classList.toggle("layers", ui.panel === "layers");
  $("pbody").innerHTML = panelHTML(ui.panel);
  const list = document.querySelector(".llist");
  if (list) list.scrollTop = scroll;
  wirePanel();
  if (ui.panel === "layers") layersApi().wire();
  if (keepSearch) {
    const input = $("layer-search");
    if (input) {
      input.focus();
      const c = Math.min(caret ?? 0, input.value.length);
      input.setSelectionRange(c, c);
    }
  }
}

function panelHTML(id) {
  const d = doc();
  const nodes = d ? selectedNodes() : [];
  const n = nodes[0];
  if (id === "properties") return propertiesHTML(n, nodes);
  if (id === "layers") return layersHTML();
  if (id === "libraries") return librariesHTML();
  if (id === "color") return colorHTML();
  if (id === "swatches") return `<div class="psec"><h3>Swatches</h3>${swatchGrid()}</div>`;
  if (id === "stroke") return strokeHTML(n);
  if (id === "pathfinder") return `<div class="psec"><h3>Pathfinder</h3>
    <div class="row"><button class="btn" data-cmd="pathfinderUnite">Unite</button><button class="btn" data-cmd="pathfinderMinus">Minus</button></div>
    <div class="row"><button class="btn" data-cmd="pathfinderIntersect">Intersect</button><button class="btn" data-cmd="pathfinderExclude">Exclude</button></div>
    <p class="hint">Select two or more filled paths. Curves are flattened to polygons.</p></div>`;
  if (id === "align") return `<div class="psec"><h3>Align</h3>
    <div class="row">
      <button class="btn" data-cmd="alignLeft">${icon("alignL", 14)}</button>
      <button class="btn" data-cmd="alignCenter">${icon("alignC", 14)}</button>
      <button class="btn" data-cmd="alignRight">${icon("alignR", 14)}</button>
      <button class="btn" data-cmd="alignTop">${icon("alignT", 14)}</button>
      <button class="btn" data-cmd="alignMiddle">${icon("alignM", 14)}</button>
      <button class="btn" data-cmd="alignBottom">${icon("alignB", 14)}</button>
    </div></div>`;
  if (id === "gradient") return gradientHTML(n);
  if (id === "transparency") return transparencyHTML(n);
  if (id === "appearance") return appearancePanelHTML(n);
  if (id === "character" || id === "paragraph" || id === "transform") return propertiesHTML(n, nodes);
  if (id === "graphicStyles") return librariesHTML();
  const title = PANEL_META[id]?.[0] || id;
  return `<div class="psec"><h3>${esc(title)}</h3><p class="hint">Open from the icon column. The controls that apply to the selection are in Properties.</p></div>`;
}
function appearancePanelHTML(n) {
  if (!n) return `<div class="psec"><h3>Appearance</h3><p class="hint">No selection.</p></div>`;
  const fill = primaryFill(n);
  const effects = n.appearance?.effects || [];
  return `<div class="psec"><h3>Appearance</h3>
    <div class="row"><span class="chip" style="background:${fillChip(fill)}"></span><span>${esc(objectLabel(n))}</span></div>
    ${effects.map((e) => `<div class="row"><span>${esc(e.id)}</span></div>`).join("") || `<p class="hint">No effects.</p>`}
    <button class="btn" data-cmd="outerGlow">Add Outer Glow</button>
  </div>`;
}

const UNIT_TABLE = {
  Points: ["pt", 1], Pixels: ["px", 1], Picas: ["p", 12], Inches: ["in", 72],
  Millimeters: ["mm", 72 / 25.4], Centimeters: ["cm", 72 / 2.54],
  Meters: ["m", 72 / 0.0254], Yards: ["yd", 72 * 36], Feet: ["ft", 72 * 12],
  "Feet & Inches": ["ft", 72 * 12],
};
const UNIT_LABELS = Object.keys(UNIT_TABLE);
function unitName(raw) {
  if (!raw) return "Points";
  if (raw === "FeetInches") return "Feet & Inches";
  return UNIT_TABLE[raw] ? raw : "Points";
}
function unitSpec() {
  const name = unitName(file()?.document.units);
  const [suffix, per] = UNIT_TABLE[name];
  return { name, suffix, per };
}
function artOnBoard(file, rect) {
  const nodes = [];
  for (const layer of file.document.layers || []) {
    for (const c of childrenOf(layer) || []) {
      const b = nodeBounds(c);
      if (!b) continue;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      if (cx >= rect.x0 && cx <= rect.x1 && cy >= rect.y0 && cy <= rect.y1) nodes.push(c);
    }
  }
  return nodes;
}
function addArtboard() {
  const d = doc();
  if (!d) return;
  pushHistory();
  const boards = d.file.document.artboards;
  const last = boards[boards.length - 1];
  const w = last.rect.x1 - last.rect.x0, h = last.rect.y1 - last.rect.y0;
  const id = Math.max(0, ...boards.map((a) => a.id || 0)) + 1;
  boards.push({
    id, name: "Artboard " + (boards.length + 1),
    rect: { x0: last.rect.x1 + 60, y0: last.rect.y0, x1: last.rect.x1 + 60 + w, y1: last.rect.y0 + h },
    show_center_mark: false, show_cross_hairs: false,
  });
  d.artboard = boards.length - 1;
  paint(); refreshChrome();
}
function deleteArtboard() {
  const d = doc();
  if (!d || d.file.document.artboards.length < 2) { toast("A document needs at least one artboard"); return; }
  pushHistory();
  d.file.document.artboards.splice(d.artboard, 1);
  d.artboard = Math.min(d.artboard, d.file.document.artboards.length - 1);
  paint(); refreshChrome();
}
function rearrangeArtboards() {
  const d = doc();
  const boards = d?.file.document.artboards || [];
  if (boards.length < 2) return;
  pushHistory();
  const gap = 60;
  const cols = Math.ceil(Math.sqrt(boards.length));
  const plans = [];
  let x = 0, y = 0, rowH = 0, col = 0;
  for (const a of boards) {
    const w = a.rect.x1 - a.rect.x0, h = a.rect.y1 - a.rect.y0;
    plans.push({ a, dx: x - a.rect.x0, dy: y - a.rect.y0, old: { ...a.rect } });
    rowH = Math.max(rowH, h);
    col++;
    if (col >= cols) { col = 0; x = 0; y += rowH + gap; rowH = 0; }
    else x += w + gap;
  }
  for (const p of plans) {
    if (ui.moveArt) for (const n of artOnBoard(d.file, p.old)) translateNode(n, p.dx, p.dy);
    p.a.rect = { x0: p.old.x0 + p.dx, y0: p.old.y0 + p.dy, x1: p.old.x1 + p.dx, y1: p.old.y1 + p.dy };
  }
  paint(); refreshChrome();
}
function commitArtboard(field, value) {
  const d = doc();
  const ab = d?.file.document.artboards?.[d.artboard];
  if (!ab) return;
  pushHistory();
  if (field === "name") { ab.name = value; paintOverlay(); drawPanel(); return; }
  const v = (+value || 0) * unitSpec().per;
  const r = ab.rect;
  if (field === "x") { const w = r.x1 - r.x0; r.x0 = v; r.x1 = v + w; }
  if (field === "y") { const h = r.y1 - r.y0; r.y0 = v; r.y1 = v + h; }
  if (field === "w") r.x1 = r.x0 + Math.max(1, v);
  if (field === "h") r.y1 = r.y0 + Math.max(1, v);
  paint(); paintOverlay();
}
function documentHTML() {
  const f = file();
  const u = unitSpec();
  const nArt = f?.document.artboards?.length || 0;
  const viewBtn = (id, on, title, ic) => `<button class="ibtn ${on ? "on" : ""}" data-view="${id}" title="${title}">${icon(ic, 15)}</button>`;
  return `<div class="kind-label">Document</div>
    <div class="docprops">
      <div class="psec">
        <h3>Document</h3>
        <div class="metric-row"><label>Units</label>
          <select data-units>${UNIT_LABELS.map((l) => `<option ${l === u.name ? "selected" : ""}>${l}</option>`).join("")}</select>
        </div>
        <div class="qa">
          <button class="btn" data-cmd="documentSetup">Document Setup</button>
          <button class="btn" data-cmd="editArtboards">Edit Artboards</button>
          ${nArt > 1 ? `<button class="btn wide" data-cmd="rearrangeArtboards">Rearrange All</button>` : ""}
        </div>
      </div>
      <div class="psec">
        <h3>Rulers &amp; Grids</h3>
        <div class="iconrow">
          ${viewBtn("rulers", ui.rulers, "Show Rulers (Ctrl+R)", "ruler")}
          ${viewBtn("grid", ui.grid, "Show Grid", "grid-3x3")}
          ${viewBtn("trans", ui.transGrid, "Show Transparency Grid", "square-dashed")}
        </div>
      </div>
      <div class="psec">
        <h3>Guides</h3>
        <div class="iconrow">
          ${viewBtn("guides", ui.showGuides !== false, "Show Guides", "layout-grid")}
          ${viewBtn("smart", ui.smartGuides !== false, "Smart Guides", "sparkles")}
        </div>
      </div>
      <div class="psec">
        <h3>Snap Options</h3>
        <button class="check ${ui.snapPoint !== false ? "on" : ""}" data-snap="point"><span class="mark">${ui.snapPoint !== false ? "✓" : ""}</span>Snap to Point</button>
        <button class="check ${ui.snapGrid ? "on" : ""}" data-snap="grid"><span class="mark">${ui.snapGrid ? "✓" : ""}</span>Snap to Grid</button>
      </div>
      <div class="psec">
        <h3>Preferences</h3>
        <div class="metric-row"><label>Keyboard Increment</label>${numField("", ui.keyInc ?? 1, "keyInc", u.suffix)}</div>
        <button class="check ${ui.scaleStrokes ? "on" : ""}" data-pref="scale"><span class="mark">${ui.scaleStrokes ? "✓" : ""}</span>Scale Strokes &amp; Effects</button>
      </div>
      <div class="psec">
        <h3>Quick Actions</h3>
        <div class="qa">
          <button class="btn" data-cmd="documentSetup">Document Setup</button>
          <button class="btn" data-cmd="preferences">Preferences</button>
        </div>
      </div>
    </div>`;
}
function artboardHTML() {
  const d = doc();
  const boards = d?.file.document.artboards || [];
  const i = Math.min(d?.artboard || 0, Math.max(0, boards.length - 1));
  const ab = boards[i];
  if (!ab) return documentHTML();
  const u = unitSpec();
  const r = ab.rect;
  const disp = (v) => v / u.per;
  return `<div class="kind-label">Artboard</div>
    <div class="docprops">
      <div class="psec">
        <input class="full" data-ab="name" value="${esc(ab.name || "Artboard")}"/>
        <div class="grid2" style="margin-top:6px">
          ${numField("X:", disp(r.x0), "abx", u.suffix)}${numField("W:", disp(r.x1 - r.x0), "abw", u.suffix)}
          ${numField("Y:", disp(r.y0), "aby", u.suffix)}${numField("H:", disp(r.y1 - r.y0), "abh", u.suffix)}
        </div>
        <button class="check ${ui.moveArt ? "on" : ""}" data-moveart><span class="mark">${ui.moveArt ? "✓" : ""}</span>Move Artwork with Artboard</button>
        <div class="qa">
          <button class="btn" data-cmd="newArtboard">New Artboard</button>
          <button class="btn" data-cmd="deleteArtboard" ${boards.length < 2 ? "disabled" : ""}>Delete Artboard</button>
        </div>
      </div>
      <div class="psec">
        <h3>Quick Actions</h3>
        <div class="qa">
          <button class="btn" data-cmd="rearrangeArtboards" ${boards.length < 2 ? "disabled" : ""}>Rearrange All</button>
          <button class="btn" data-cmd="exitArtboards">Exit</button>
        </div>
      </div>
    </div>`;
}
function propertiesHTML(n, nodes) {
  if (ui.tool === "artboard") return artboardHTML();
  if (!n) return documentHTML();
  const b = selectionBounds(file(), doc().selection) || { x0: 0, y0: 0, x1: 0, y1: 0 };
  const rp = refPointOf(b, ui.refPoint ?? 4);
  const u = unitSpec();
  const disp = (v) => v / u.per;
  const fill = shownFill(n);
  const stroke = shownStroke(n);
  const text = n.kind?.type === "text" ? n.kind.runs?.[0]?.style : null;
  const kind = nodes.length > 1 ? `${nodes.length} Objects` : objectLabel(n);
  const justify = n.kind?.para?.justify || "Left";
  const strokeNone = !stroke?.paint || stroke.paint.type === "none" || !(stroke.width > 0);
  const angle = nodeAngleDeg(n);
  return `<div class="kind-label">${esc(kind)}</div>
  <div class="psec">
    <h3>Transform</h3>
    <div class="xf-row">
      ${refPointHTML()}
      <div class="grid2 grow">
        ${numField("X:", disp(rp.x), "x", u.suffix)}${numField("W:", disp(b.x1 - b.x0), "w", u.suffix)}
        ${numField("Y:", disp(rp.y), "y", u.suffix)}${numField("H:", disp(b.y1 - b.y0), "h", u.suffix)}
      </div>
    </div>
    <div class="row xf-rot">
      <span class="xf-ico" title="Rotate">${icon("rotate", 14)}</span>
      ${numField("", angle, "rot", "°")}
      <button class="mini" data-flip="h" title="Flip Horizontal">${icon("flipH", 14)}</button>
      <button class="mini" data-flip="v" title="Flip Vertical">${icon("flipV", 14)}</button>
    </div>
  </div>
  ${text ? `<div class="psec"><h3>Character</h3>
    <select class="full" data-field="family">${["Source Sans 3", "Source Serif 4", "Inter", "JetBrains Mono"].map((f) => `<option ${text.font_family === f ? "selected" : ""}>${f}</option>`).join("")}</select>
    <div class="metric-row">
      <label>Size</label>${numField("", text.size || 16, "size", "pt")}
      <label>Leading</label>${numField("", text.leading ?? Math.round((text.size || 16) * 1.2 * 10) / 10, "leading", "pt")}
    </div>
    <div class="metric-row"><label>Tracking</label>${numField("", text.tracking || 0, "track")}</div>
    <h3>Paragraph</h3>
    <div class="row para">
      <button class="mini ${justify === "Left" ? "on" : ""}" data-justify="Left" title="Align Left">${icon("paraLeft", 16)}</button>
      <button class="mini ${justify === "Center" ? "on" : ""}" data-justify="Center" title="Align Center">${icon("paraCenter", 16)}</button>
      <button class="mini ${justify === "Right" ? "on" : ""}" data-justify="Right" title="Align Right">${icon("paraRight", 16)}</button>
      <button class="mini ${justify === "Justify" ? "on" : ""}" data-justify="Justify" title="Justify">${icon("paraJustify", 16)}</button>
    </div>
    <input class="full" data-field="text" value="${esc(textOf(n))}" style="margin-top:6px"/>
  </div>` : ""}
  <div class="psec"><h3>Appearance</h3>
    <div class="row"><span class="chip ${fill?.type === "none" ? "none" : ""}" data-target="fill" style="background:${fillChip(fill)}"></span><span>Fill</span></div>
    <div class="row"><span class="chip ${strokeNone ? "none" : ""}" data-target="stroke" style="background:${stroke?.paint?.type === "solid" ? rgbCss(stroke.paint.color) : ""}"></span><span>Stroke</span>
      <input class="full" data-field="sw" type="number" min="0" step="0.5" value="${stroke?.width ?? 0}" style="width:64px"/> <span class="unit">pt</span></div>
    <div class="row"><label style="width:54px;color:var(--text-dim)">Opacity</label><input class="full" data-field="opacity" type="number" min="0" max="100" value="${Math.round((n.opacity ?? 1) * 100)}" style="width:64px"/> <span class="unit">%</span></div>
    <div class="row"><button class="btn fx" data-cmd="outerGlow" title="Add New Effect">fx</button></div>
  </div>
  <div class="psec"><h3>Align</h3>
    <div class="row">
      <button class="btn" data-cmd="alignLeft">${icon("alignL", 14)}</button>
      <button class="btn" data-cmd="alignCenter">${icon("alignC", 14)}</button>
      <button class="btn" data-cmd="alignRight">${icon("alignR", 14)}</button>
      <button class="btn" data-cmd="alignTop">${icon("alignT", 14)}</button>
      <button class="btn" data-cmd="alignMiddle">${icon("alignM", 14)}</button>
      <button class="btn" data-cmd="alignBottom">${icon("alignB", 14)}</button>
    </div>
  </div>
  <div class="psec"><h3>Quick Actions</h3>
    <div class="qa">
      <button class="btn" data-cmd="offsetPath">Offset Path</button>
      <button class="btn" data-cmd="simplify">Simplify</button>
      <button class="btn" data-cmd="bringFront">Arrange: Bring to Front</button>
      <button class="btn" data-cmd="lock">Lock</button>
    </div>
  </div>`;
}
function numField(label, value, field, unit) {
  const v = Math.round((+value || 0) * 1000) / 1000;
  return `<div class="field">${label ? `<label>${label}</label>` : ""}<input data-field="${field}" type="number" step="0.1" value="${v}"/>${unit ? `<span class="unit">${unit}</span>` : ""}</div>`;
}
function refPointHTML() {
  const cur = ui.refPoint ?? 4;
  return `<div class="refpt" title="Reference point">${Array.from({ length: 9 }, (_, i) => `<button type="button" data-ref="${i}" class="${i === cur ? "on" : ""}"></button>`).join("")}</div>`;
}
function refPointOf(b, i = 4) {
  const xs = [b.x0, (b.x0 + b.x1) / 2, b.x1];
  const ys = [b.y0, (b.y0 + b.y1) / 2, b.y1];
  return { x: xs[i % 3], y: ys[Math.floor(i / 3)] };
}
function nodeAngleDeg(n) {
  const xf = n?.kind?.xf;
  if (!xf) return 0;
  const deg = Math.atan2(xf[1], xf[0]) * 180 / Math.PI;
  return Math.round(deg * 100) / 100;
}
function fillChip(fill) {
  if (!fill || fill.type === "none") return "transparent";
  if (fill.type === "solid") return rgbCss(fill.color);
  return "#888";
}
function colorHTML() {
  const paint = ui.paintTarget === "fill" ? ui.fill : ui.stroke;
  const c = paint?.type === "solid" ? paint.color : { r: 1, g: 1, b: 1 };
  const rgb = c.model === "rgb" ? c : { r: 1, g: 1, b: 1 };
  return `<div class="psec"><h3>${ui.paintTarget === "fill" ? "Fill" : "Stroke"}</h3>
    <input class="full" data-field="hex" value="${rgbToHex(rgb)}"/>
    ${["r", "g", "b"].map((ch) => `<div class="row"><label style="width:12px">${ch.toUpperCase()}</label><input class="slider" data-ch="${ch}" type="range" min="0" max="255" value="${Math.round(rgb[ch] * 255)}"/><span>${Math.round(rgb[ch] * 255)}</span></div>`).join("")}
    <div class="row"><button class="btn" data-cmd="nonePaint">None</button><button class="btn" data-cmd="black">Black</button><button class="btn" data-cmd="white">White</button></div>
  </div><div class="psec"><h3>Swatches</h3>${swatchGrid()}</div>`;
}
function swatchGrid() {
  const sw = file()?.document.swatches || [];
  const basics = ["#111111", "#ffffff", "#e23d3d", "#378ef0", "#3cbf6e", "#f0b429", "#9b59b6", "#ff4fa3"];
  const chips = basics.map((h) => `<button class="swatch" data-hex="${h}" style="background:${h}" title="${h}"></button>`).join("");
  const extra = sw.slice(0, 48).map((s) => {
    const col = s.paint?.color;
    const bg = col ? rgbCss(col) : "#888";
    return `<button class="swatch" data-name="${esc(s.name)}" style="background:${bg}" title="${esc(s.name)}"></button>`;
  }).join("");
  return `<div class="swatches">${chips}${extra}</div>`;
}
function strokeHTML(n) {
  const s = n ? primaryStroke(n) : null;
  return `<div class="psec"><h3>Stroke</h3>
    <div class="row"><label style="width:48px;color:var(--text-dim)">Weight</label><input class="full" data-field="sw" type="number" min="0" step="0.25" value="${s?.width ?? ui.strokeWidth}"/></div>
    <div class="row"><select class="full" data-field="cap">${["Butt", "Round", "Square"].map((c) => `<option ${s?.cap === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
    <div class="row"><select class="full" data-field="join">${["Miter", "Round", "Bevel"].map((c) => `<option ${s?.join === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
  </div>`;
}
function gradientHTML(n) {
  const fill = n ? primaryFill(n) : null;
  const angle = fill?.angle ?? 0;
  return `<div class="psec"><h3>Gradient</h3>
    <div class="row"><button class="btn" data-cmd="applyGrad">Apply linear</button></div>
    <div class="row"><label style="width:48px;color:var(--text-dim)">Angle</label><input class="full" data-field="angle" type="number" value="${Math.round(angle)}"/></div>
    <p class="hint">Or drag with the Gradient tool (G).</p></div>`;
}
function transparencyHTML(n) {
  return `<div class="psec"><h3>Transparency</h3>
    <div class="row"><input class="slider" data-field="opacity" type="range" min="0" max="100" value="${Math.round((n?.opacity ?? 1) * 100)}"/></div>
    <div class="row"><select class="full" data-field="blend">${["Normal", "Multiply", "Screen", "Overlay", "Darken", "Lighten", "Difference"].map((m) => `<option ${(n?.blend || "Normal") === m ? "selected" : ""}>${m}</option>`).join("")}</select></div>
  </div>`;
}
function librariesHTML() {
  const f = file();
  const styles = f?.document.graphic_styles || f?.document.graphicStyles || [];
  return `<div class="psec"><h3>Swatches</h3>${swatchGrid()}</div>
    <div class="psec"><h3>Graphic styles</h3>
      ${styles.length ? styles.map((s, i) => `<button class="mi" data-style="${i}"><span>${esc(s.name || "Style " + (i + 1))}</span></button>`).join("") : `<p class="hint">This document has no graphic styles.</p>`}
    </div>`;
}
function layersHTML() {
  return layersApi().html();
}

function wirePanel() {
  const body = $("pbody");
  body.querySelectorAll("[data-cmd]").forEach((b) => b.onclick = () => {
    if (b.disabled) return;
    const cmd = b.dataset.cmd;
    if (cmd === "nonePaint") applyPaint(ui.paintTarget, nonePaint());
    else if (cmd === "black") applyPaint(ui.paintTarget, solid(0, 0, 0));
    else if (cmd === "white") applyPaint(ui.paintTarget, solid(1, 1, 1));
    else if (cmd === "applyGrad") setGradient(0, { x: 0, y: 0 }, { x: 1, y: 0 }, true);
    else if (commands[cmd]) commands[cmd]();
  });
  body.querySelectorAll("[data-hex]").forEach((b) => b.onclick = () => {
    const c = hexToRgb(b.dataset.hex);
    if (c) applyPaint(ui.paintTarget, { type: "solid", color: c });
  });
  body.querySelectorAll("[data-name]").forEach((b) => b.onclick = () => {
    const sw = (file()?.document.swatches || []).find((s) => s.name === b.dataset.name);
    if (sw?.paint) applyPaint(ui.paintTarget, sw.paint.type ? sw.paint : { type: "solid", color: sw.paint.color || sw.paint });
  });
  body.querySelectorAll("[data-style]").forEach((b) => b.onclick = () => applyStyle(+b.dataset.style));
  body.querySelectorAll("[data-eye]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const { map } = indexNodes(file());
    const n = map.get(+b.dataset.eye);
    if (!n) return;
    pushHistory();
    n.visible = n.visible === false;
    paint(); drawPanel();
  });
  body.querySelectorAll("[data-lock]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const { map } = indexNodes(file());
    const n = map.get(+b.dataset.lock);
    if (!n) return;
    pushHistory();
    n.locked = !n.locked;
    drawPanel();
  });
  body.querySelectorAll(".layer").forEach((row) => row.onclick = () => {
    const id = +row.dataset.id;
    const { map } = indexNodes(file());
    const n = map.get(id);
    if (!n || n.kind?.type === "layer") {
      doc().selection = (n?.kind?.children || []).map((c) => c.id);
    } else doc().selection = [id];
    syncProxyFromSelection();
    paintOverlay();
    drawPanel();
    drawTaskbar();
    status();
  });
  body.querySelectorAll("[data-justify]").forEach((b) => b.onclick = () => setJustify(b.dataset.justify));
  body.querySelectorAll("[data-ref]").forEach((b) => b.onclick = () => { ui.refPoint = +b.dataset.ref; drawPanel(); });
  body.querySelectorAll("[data-flip]").forEach((b) => b.onclick = () => flipSel(b.dataset.flip === "h" ? -1 : 1, b.dataset.flip === "h" ? 1 : -1));
  body.querySelectorAll("[data-target]").forEach((b) => b.onclick = () => { ui.paintTarget = b.dataset.target; ui.panel = "color"; drawPanel(); drawToolbar(); });
  body.querySelectorAll("[data-ch]").forEach((sl) => sl.oninput = () => {
    const rgb = { model: "rgb", r: 0, g: 0, b: 0 };
    body.querySelectorAll("[data-ch]").forEach((s) => { rgb[s.dataset.ch] = (+s.value) / 255; });
    ui[ui.paintTarget === "fill" ? "fill" : "stroke"] = { type: "solid", color: rgb };
    drawToolbar();
  });
  body.querySelectorAll("[data-ch]").forEach((sl) => sl.onchange = () => {
    const paint = ui.paintTarget === "fill" ? ui.fill : ui.stroke;
    applyPaint(ui.paintTarget, paint);
  });
  body.querySelectorAll("input,select").forEach((input) => {
    const commit = () => commitField(input.dataset.field, input.value);
    if (input.dataset.field && input.dataset.field !== "opacity") input.onchange = commit;
    if (input.dataset.field === "opacity") input.oninput = () => commitField("opacity", input.value, true);
    if (input.dataset.field === "text") input.oninput = () => commitField("text", input.value, true);
    input.onkeydown = (e) => e.stopPropagation();
  });
  body.querySelectorAll("[data-units]").forEach((sel) => sel.onchange = () => {
    const d = doc();
    if (!d) return;
    pushHistory();
    d.file.document.units = sel.value === "Feet & Inches" ? "FeetInches" : sel.value;
    drawPanel();
  });
  body.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => {
    const k = b.dataset.view;
    if (k === "rulers") commands.toggleRulers();
    else if (k === "grid") commands.toggleGrid();
    else if (k === "trans") { ui.transGrid = !ui.transGrid; paint(); }
    else if (k === "guides") ui.showGuides = ui.showGuides === false;
    else if (k === "smart") ui.smartGuides = ui.smartGuides === false;
    drawPanel();
    paintOverlay();
  });
  body.querySelectorAll("[data-snap]").forEach((b) => b.onclick = () => {
    if (b.dataset.snap === "point") ui.snapPoint = ui.snapPoint === false;
    else ui.snapGrid = !ui.snapGrid;
    drawPanel();
  });
  body.querySelectorAll("[data-pref]").forEach((b) => b.onclick = () => { ui.scaleStrokes = !ui.scaleStrokes; drawPanel(); });
  body.querySelectorAll("[data-moveart]").forEach((b) => b.onclick = () => { ui.moveArt = !ui.moveArt; drawPanel(); });
  body.querySelectorAll("[data-ab]").forEach((input) => input.onchange = () => commitArtboard(input.dataset.ab, input.value));
}
function commitField(field, value, live) {
  const d = doc();
  if (!d) return;
  if (!live) pushHistory();
  const { map } = indexNodes(d.file);
  const nodes = d.selection.map((id) => map.get(id)).filter(Boolean);
  if (field === "hex") {
    const c = hexToRgb(value);
    if (c) applyPaint(ui.paintTarget, { type: "solid", color: c });
    return;
  }
  if (field === "keyInc") { ui.keyInc = Math.max(0.001, +value || 1); return; }
  if (field === "abx" || field === "aby" || field === "abw" || field === "abh") {
    commitArtboard({ abx: "x", aby: "y", abw: "w", abh: "h" }[field], value);
    return;
  }
  if (field === "opacity") {
    for (const n of nodes) setOpacity(n, clamp(+value / 100, 0, 1));
    if (!live) return;
    paint();
    return;
  }
  if (field === "blend") { for (const n of nodes) setBlend(n, value); paint(); return; }
  if (field === "sw") {
    ui.strokeWidth = Math.max(0, +value || 0);
    for (const n of nodes) {
      const s = primaryStroke(n);
      if (s) s.width = ui.strokeWidth;
    }
    paint(); return;
  }
  if (field === "cap" || field === "join") {
    for (const n of nodes) {
      const s = primaryStroke(n);
      if (s) s[field] = value;
    }
    paint(); return;
  }
  if (field === "text") { for (const n of nodes) if (n.kind?.type === "text") setText(n, value); paint(); return; }
  if (field === "family") {
    for (const n of nodes) if (n.kind?.type === "text") n.kind.runs[0].style.font_family = value;
    paint(); return;
  }
  if (field === "size" || field === "track") {
    for (const n of nodes) if (n.kind?.type === "text") {
      if (field === "size") n.kind.runs[0].style.size = +value;
      else n.kind.runs[0].style.tracking = +value;
    }
    paint(); return;
  }
  if (field === "angle") { setGradient(+value, { x: 0, y: 0 }, { x: 1, y: 0 }, false); paint(); return; }
  if (field === "rot") {
    const b = selectionBounds(d.file, d.selection);
    if (!b) return;
    const c = refPointOf(b, ui.refPoint ?? 4);
    const delta = (+value) - nodeAngleDeg(nodes[0]);
    for (const n of nodes) transformNode(n, rotateXf(delta * Math.PI / 180, c.x, c.y));
    paint();
    return;
  }
  if (field === "leading") {
    for (const n of nodes) if (n.kind?.type === "text") n.kind.runs[0].style.leading = +value;
    return;
  }
  const b = selectionBounds(d.file, d.selection);
  if (!b || !nodes.length) return;
  const v = (+value) * (field === "x" || field === "y" || field === "w" || field === "h" ? unitSpec().per : 1);
  const rp = refPointOf(b, ui.refPoint ?? 4);
  if (field === "x") nodes.forEach((n) => translateNode(n, v - rp.x, 0));
  if (field === "y") nodes.forEach((n) => translateNode(n, 0, v - rp.y));
  if (field === "w" && b.x1 !== b.x0) {
    const s = v / (b.x1 - b.x0);
    nodes.forEach((n) => transformNode(n, scaleXf(s, 1, rp.x, rp.y)));
  }
  if (field === "h" && b.y1 !== b.y0) {
    const s = v / (b.y1 - b.y0);
    nodes.forEach((n) => transformNode(n, scaleXf(1, s, rp.x, rp.y)));
  }
  paint();
}
function applyStyle(i) {
  const styles = file()?.document.graphic_styles || file()?.document.graphicStyles || [];
  const s = styles[i];
  if (!s || !doc()?.selection.length) return;
  pushHistory();
  const { map } = indexNodes(file());
  for (const id of doc().selection) {
    const n = map.get(id);
    if (n) n.appearance = deepClone(s.appearance || { items: s.items || [] });
  }
  paint();
}

const HINTS = {
  selection: [["Click", 1], [" the object to select  |  ", 0], ["Shift+Click", 1], [" to select multiple objects  |  ", 0], ["Alt+Drag", 1], [" the object to duplicate", 0]],
  directSelection: [["Click", 1], [" an anchor or path segment to select it  |  ", 0], ["Drag", 1], [" to move  |  ", 0], ["Shift+Click", 1], [" to add", 0]],
  pen: [["Click", 1], [" to add a corner point  |  ", 0], ["Drag", 1], [" to add a smooth point  |  ", 0], ["Click the first point", 1], [" to close  |  ", 0], ["Enter", 1], [" to finish", 0]],
  type: [["Click", 1], [" to create point type  |  ", 0], ["Esc", 1], [" to exit editing", 0]],
  areaType: [["Click", 1], [" to create point type  |  ", 0], ["Drag", 1], [" to create area type", 0]],
  rectangle: [["Drag", 1], [" to draw  |  ", 0], ["Shift+Drag", 1], [" to constrain  |  ", 0], ["Alt+Drag", 1], [" from center", 0]],
  zoom: [["Click", 1], [" to zoom in  |  ", 0], ["Alt+Click", 1], [" to zoom out  |  ", 0], ["Drag", 1], [" to zoom into an area", 0]],
  hand: [["Drag", 1], [" to pan the view", 0]],
  eyedropper: [["Click", 1], [" an object to copy its attributes", 0]],
  gradient: [["Drag", 1], [" across a selected object to set the gradient direction", 0]],
  rotate: [["Drag", 1], [" to transform  |  ", 0], ["Alt+Click", 1], [" to set the reference point", 0]],
  artboard: [["Click", 1], [" an artboard to edit it  |  ", 0], ["Drag", 1], [" to move it", 0]],
  perspectiveSelection: [["Drag", 1], [" to move in perspective  |  ", 0], ["Alt+Drag", 1], [" to copy  |  ", 0], ["Drag a handle", 1], [" to scale in perspective", 0]],
  perspectiveGrid: [["Drag", 1], [" a handle to reshape the grid  |  ", 0], ["1–4", 1], [" pick a plane", 0]],
};
function drawHint() {
  const segs = HINTS[ui.tool] || HINTS[ui.tool === "ellipse" || ui.tool === "polygon" || ui.tool === "star" || ui.tool === "roundedRectangle" ? "rectangle" : ""] || [["Search", 1], [" commands and tools for this tool", 0]];
  $("hintbar").innerHTML = `<span class="mark">?</span>` + segs.map(([t, b]) => b ? `<b>${esc(t)}</b>` : esc(t)).join("");
}

function status() {
  const d = doc();
  const tool = toolById(ui.tool);
  const nab = d?.file.document.artboards?.length || 0;
  const cur = d ? Math.min(d.artboard, Math.max(0, nab - 1)) : 0;
  const shown = tool ? tool.label.replace(/ Tool$/, "") : (ui.tool === "artboard" ? "Artboard" : "");
  $("statusbar").innerHTML = `
    <button class="zoom" id="zoom-label">${d ? Math.round(d.zoom * 100) + "%" : ""} ${icon("chevron", 10)}</button>
    <button class="rot" id="rot-label">${d ? Math.round(d.viewRot || 0) + "°" : "0°"} ${icon("chevron", 10)}</button>
    <span class="sep"></span>
    <button id="ab-first" ${cur > 0 ? "" : "disabled"}>${icon("chevronsLeft", 12)}</button>
    <button id="ab-prev" ${cur > 0 ? "" : "disabled"}>${icon("chevronLeft", 12)}</button>
    <span>${nab ? cur + 1 : "–"}</span>
    <button id="ab-next" ${cur + 1 < nab ? "" : "disabled"}>${icon("chevronRight", 12)}</button>
    <button id="ab-last" ${cur + 1 < nab ? "" : "disabled"}>${icon("chevronsRight", 12)}</button>
    <span class="sep"></span>
    <span>${esc(shown)}</span>
    <span class="grow"></span>
    <span class="xy" id="xy">X: —  Y: —</span>
    <span class="perf" id="perf"></span>`;
  if (!d) return;
  $("zoom-label").onclick = (e) => openZoomMenu(e.currentTarget.getBoundingClientRect());
  $("rot-label").onclick = (e) => openRotMenu(e.currentTarget.getBoundingClientRect());
  const go = (i) => { d.artboard = i; fit("art"); };
  $("ab-first").onclick = () => go(0);
  $("ab-prev").onclick = () => go(Math.max(0, cur - 1));
  $("ab-next").onclick = () => go(Math.min(nab - 1, cur + 1));
  $("ab-last").onclick = () => go(nab - 1);
}
function openZoomMenu(rect) {
  closePops();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.style.left = rect.left + "px";
  menu.style.bottom = "28px";
  menu.style.top = "auto";
  const stops = [3200, 1600, 800, 400, 200, 100, 50, 25, 12.5];
  menu.innerHTML = stops.map((z) => `<button class="mi" data-z="${z}">${z}%</button>`).join("") + `<div class="sep-line"></div><button class="mi" data-z="fit">Fit Artboard in Window</button>`;
  document.body.appendChild(menu);
  menu.querySelectorAll(".mi").forEach((b) => b.onclick = () => {
    closePops();
    if (b.dataset.z === "fit") commands.fitArtboard();
    else {
      const c = $("canvas");
      zoomAt(c.clientWidth / 2, c.clientHeight / 2, (+b.dataset.z / 100) / doc().zoom);
    }
  });
}
function openRotMenu(rect) {
  closePops();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.style.left = rect.left + "px";
  menu.style.bottom = "28px";
  menu.style.top = "auto";
  menu.innerHTML = [0, 15, 30, 45, 90, 180, -15, -45, -90].map((a) => `<button class="mi" data-a="${a}">${a}°</button>`).join("");
  document.body.appendChild(menu);
  menu.querySelectorAll(".mi").forEach((b) => b.onclick = () => {
    doc().viewRot = +b.dataset.a;
    closePops();
    paint();
    status();
  });
}
function statusXY(p) {
  const el = $("xy");
  if (!el || !p) return;
  const u = unitSpec();
  const x = p.x / u.per, y = p.y / u.per;
  el.textContent = `X: ${x.toFixed(2)} ${u.suffix}  Y: ${y.toFixed(2)} ${u.suffix}`;
}

function paletteItems() {
  const items = [];
  for (const name of ["File", "Edit", "Object", "Type", "Select", "Effect", "View", "Window", "Help"]) {
    for (const it of menuItems(name)) {
      if (it.sep || it.items) {
        for (const sub of it.items || []) items.push({ ...sub, label: `${name}  ${sub.label}` });
        continue;
      }
      items.push({ ...it, label: `${name}  ${it.label}` });
    }
  }
  for (const t of ALL_TOOLS) items.push({ label: `Tool  ${t.label}`, tool: t.id, sc: t.key || "" });
  const q = ui.query.trim().toLowerCase();
  return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items.slice(0, 12);
}
function openPalette() {
  document.querySelectorAll(".palette").forEach((n) => n.remove());
  const search = $("search");
  if (!search) return;
  const box = document.createElement("div");
  box.className = "palette";
  const r = search.parentElement.getBoundingClientRect();
  box.style.left = r.left + "px";
  box.style.top = r.bottom + 6 + "px";
  box.style.transform = "none";
  box.style.width = Math.max(260, r.width) + "px";
  const items = paletteItems().slice(0, 14);
  box.innerHTML = `<div class="list">${items.map((it, i) => `<button class="hit ${i === 0 ? "on" : ""}" data-i="${i}">${esc(it.label.replace(/^.*?  /, ""))}${it.sc ? `<span class="sc" style="margin-left:auto">${it.sc}</span>` : ""}</button>`).join("") || `<div class="hit">No commands</div>`}</div>`;
  document.body.appendChild(box);
  box.querySelectorAll(".hit").forEach((b) => b.onclick = () => { closePops(); runItem(items[+b.dataset.i]); ui.query = ""; });
}

function openModal(kind) {
  closePops();
  const back = document.createElement("div");
  back.className = "modal-back";
  const d = doc();
  let inner = "";
  if (kind === "new") inner = `<h2>New Document</h2>
    <div class="grid2">${numField("W", 800, "nw")}${numField("H", 600, "nh")}</div>
    <div class="row"><label style="width:70px;color:var(--text-dim)">Name</label><input class="full" id="nd-name" value="Untitled-${ui.docs.length + 1}"/></div>
    <div class="row"><label style="width:70px;color:var(--text-dim)">Color</label><select class="full" id="nd-mode"><option>Rgb</option><option>Cmyk</option></select></div>
    <div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="nd-ok">Create</button></div>`;
  else if (kind === "about") inner = `<h2>About VectorCraft</h2>
    <div class="row"><img class="about-mark" src="/assets/app-icon/hicolor/64x64/apps/ai.storyteller.vectorcraft.png" alt=""/><div><b>VectorCraft</b><div class="hint">Browser edition · document format 4<br/>A clean-room vector editor. Native files open, edit, and save as .vectorcraft JSON.</div></div></div>
    <div class="actions"><button class="btn primary" data-x>OK</button></div>`;
  else if (kind === "prefs") inner = `<h2>Preferences</h2>
    <div class="row"><label style="width:90px">Brightness</label><select class="full" id="pf-theme">${["mediumDark", "dark", "mediumLight", "light"].map((t) => `<option ${ui.theme === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    <div class="row"><label><input type="checkbox" id="pf-snap" ${ui.snap ? "checked" : ""}/> Snap to artboard and objects</label></div>
    <div class="row"><label><input type="checkbox" id="pf-rulers" ${ui.rulers ? "checked" : ""}/> Show rulers</label></div>
    <div class="actions"><button class="btn primary" id="pf-ok">OK</button></div>`;
  else if (kind === "keys") inner = `<h2>Keyboard Shortcuts</h2>
    <p class="hint">V select · A direct select · P pen · T type · M rectangle · L ellipse · N pencil · B brush<br/>
    Z zoom · H hand · R rotate · I eyedropper · G gradient · Space pan<br/>
    Ctrl+Z undo · Ctrl+S save · Ctrl+E export SVG · Ctrl+0 fit · Ctrl+G group · Del delete<br/>
    Arrows nudge · Shift+arrows nudge 10 · [ ] arrange · Ctrl+K search</p>
    <div class="actions"><button class="btn primary" data-x>Close</button></div>`;
  else if (kind === "setup") {
    const ab = d?.file.document.artboards?.[0]?.rect;
    inner = `<h2>Document Setup</h2>
      <div class="row"><label style="width:70px">Title</label><input class="full" id="ds-title" value="${esc(d?.file.document.title || "")}"/></div>
      <div class="grid2">${numField("W", ab ? ab.x1 - ab.x0 : 800, "dw")}${numField("H", ab ? ab.y1 - ab.y0 : 600, "dh")}</div>
      <div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="ds-ok">OK</button></div>`;
  }
  back.innerHTML = `<div class="modal">${inner}</div>`;
  document.body.appendChild(back);
  back.addEventListener("mousedown", (e) => { if (e.target === back) back.remove(); });
  back.querySelectorAll("[data-x]").forEach((b) => b.onclick = () => back.remove());
  back.querySelector("#nd-ok")?.addEventListener("click", () => {
    const w = +back.querySelector("[data-field=nw]").value || 800;
    const h = +back.querySelector("[data-field=nh]").value || 600;
    const f = newFile({ title: back.querySelector("#nd-name").value || "Untitled", width: w, height: h, colorMode: back.querySelector("#nd-mode").value });
    openDoc(f, f.document.title);
    back.remove();
  });
  back.querySelector("#pf-ok")?.addEventListener("click", () => {
    setTheme(back.querySelector("#pf-theme").value);
    ui.snap = back.querySelector("#pf-snap").checked;
    ui.rulers = back.querySelector("#pf-rulers").checked;
    $("ruler-row").style.display = ui.rulers ? "" : "none";
    $("ruler-v").style.display = ui.rulers ? "" : "none";
    paintRulers();
    back.remove();
  });
  back.querySelector("#ds-ok")?.addEventListener("click", () => {
    if (!d) return;
    pushHistory();
    d.file.document.title = back.querySelector("#ds-title").value;
    const w = +back.querySelector("[data-field=dw]").value, h = +back.querySelector("[data-field=dh]").value;
    const ab = d.file.document.artboards[0];
    if (ab) ab.rect = { x0: ab.rect.x0, y0: ab.rect.y0, x1: ab.rect.x0 + w, y1: ab.rect.y0 + h };
    d.name = d.file.document.title;
    back.remove();
    paint(); refreshChrome();
  });
}

function drawHome() {
  let home = $("home");
  if (!ui.home) { home?.remove(); return; }
  if (!home) {
    home = document.createElement("div");
    home.id = "home";
    home.className = "home";
    $("stage").appendChild(home);
  }
  home.innerHTML = `<h1>VectorCraft</h1><p class="sub">Open a document or start from an example. Files stay in the native .vectorcraft format.</p>
    <div class="cards">
      <button class="card" id="home-new"><div class="thumb">＋</div><div class="meta"><b>New document</b><span>Blank artboard</span></div></button>
      <button class="card" id="home-open"><div class="thumb">↥</div><div class="meta"><b>Open…</b><span>.vectorcraft or SVG</span></div></button>
      ${EXAMPLES.map((ex) => `<button class="card" data-ex="${ex.file}"><div class="thumb" style="background:${thumb(ex.file)}"></div><div class="meta"><b>${ex.title}</b><span>${ex.note}</span></div></button>`).join("")}
    </div>`;
  home.querySelector("#home-new").onclick = () => commands.new();
  home.querySelector("#home-open").onclick = () => commands.open();
  home.querySelectorAll("[data-ex]").forEach((b) => b.onclick = () => openExample(b.dataset.ex).catch((e) => toast(e.message)));
}
function thumb(file) {
  const map = {
    "ribbons.vectorcraft": "linear-gradient(135deg,#ff4d6d,#ffb703 40%,#4cc9f0)",
    "neon-drive.vectorcraft": "linear-gradient(160deg,#120814,#ff2d95 70%,#7b2cff)",
    "dusk-poster.vectorcraft": "linear-gradient(180deg,#f4a261,#6d597a 55%,#1d3557)",
    "feature-sheet.vectorcraft": "linear-gradient(90deg,#264653,#2a9d8f 40%,#e9c46a 70%,#e76f51)",
    "perspective-city.vectorcraft": "linear-gradient(180deg,#8ecae6,#023047)",
  };
  return map[file] || "#333";
}

function onKey(e) {
  const typing = e.target.matches("input, textarea, select");
  if (e.key === "Escape") {
    closePops();
    $("textedit")?.remove();
    if (ui.pen) { if (ui.pen.curve) finishCurve(); else finishPen(false); }
    else commands.deselect();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey) {
    const k = e.key.toLowerCase();
    const map = {
      z: e.shiftKey ? "redo" : "undo", y: "redo", s: "save", o: "open", n: "new", e: "exportSVG",
      a: e.shiftKey ? "deselect" : "selectAll", c: "copy", x: "cut", v: e.shiftKey ? "pasteInPlace" : "paste",
      d: "duplicate", g: e.shiftKey ? "ungroup" : "group", w: "close",
      "0": "fitArtboard", "1": "actualSize", "=": "zoomIn", "+": "zoomIn", "-": "zoomOut",
      k: "palette", y: e.shiftKey ? null : "toggleOutline", r: "toggleRulers",
    };
    // Ctrl+Y outline takes the second assignment — handle explicitly
    if (k === "y" && !e.shiftKey) { e.preventDefault(); commands.toggleOutline(); return; }
    const cmd = map[k] || (e.key === "]" ? (e.shiftKey ? "bringFront" : "bringForward") : e.key === "[" ? (e.shiftKey ? "sendBack" : "sendBackward") : null);
    if (cmd === "palette") { e.preventDefault(); $("search")?.focus(); openPalette(); return; }
    if (cmd && commands[cmd]) { e.preventDefault(); commands[cmd](); return; }
  }
  if (typing) return;
  if (e.code === "Space") { ui.space = true; $("canvas").classList.add("hand"); e.preventDefault(); return; }
  if (e.key === "Delete" || e.key === "Backspace") { commands.delete(); return; }
  if (e.key === "Enter" && ui.pen) { ui.pen.curve ? finishCurve() : finishPen(false); return; }
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) && doc()?.selection.length) {
    const n = (ui.keyInc ?? 1) * unitSpec().per * (e.shiftKey ? 10 : 1);
    const dx = e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0;
    const dy = e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
    pushHistory();
    const { map } = indexNodes(file());
    for (const id of doc().selection) translateNode(map.get(id), dx, dy);
    paint();
    return;
  }
  if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && ["1", "2", "3", "4"].includes(e.key)) {
    const g = readGrid(file());
    if (g && g.visible !== false) {
      g.plane = { 1: "left", 2: "ground", 3: "right", 4: "none" }[e.key];
      paintOverlay();
      e.preventDefault();
      return;
    }
  }
  if (!typing && e.shiftKey && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "v") { e.preventDefault(); setTool("perspectiveSelection"); return; }
  if (!typing && e.shiftKey && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "p") { e.preventDefault(); setTool("perspectiveGrid"); return; }
  if (!typing && e.shiftKey && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "d") { e.preventDefault(); cycleDrawMode(); return; }
  if (!typing && e.shiftKey && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "x") { e.preventDefault(); swapPaint(); return; }
  if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); toggleScreen(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const byKey = {
    v: "selection", a: "directSelection", q: "lasso", y: "magicWand", p: "pen", t: "type",
    m: "rectangle", l: "ellipse", n: "pencil", b: "paintbrush", z: "zoom", h: "hand",
    r: "rotate", i: "eyedropper", g: "gradient", w: "blend", o: "reflect", s: "scale", u: "mesh",
    "\\": "lineSegment",
  };
  if (byKey[e.key.toLowerCase()]) { setTool(byKey[e.key.toLowerCase()]); e.preventDefault(); }
}
function onKeyUp(e) {
  if (e.code === "Space") { ui.space = false; if (ui.tool !== "hand") $("canvas").classList.remove("hand"); }
}

function drawAppearanceFloat() {
  let el = $("appear-float");
  if (!el) {
    el = document.createElement("div");
    el.id = "appear-float";
    el.className = "appear-float";
    $("stage").appendChild(el);
  }
  const n = selectedNodes()[0];
  const effects = (n?.appearance?.effects || []).filter((e) => e.visible !== false);
  const show = n && (n.kind?.type === "text" || effects.length) && !ui.home;
  el.hidden = !show;
  if (!show) return;
  const charFill = n.kind?.type === "text" ? n.kind.runs?.[0]?.style?.fill : shownFill(n);
  const stackFill = (n.appearance?.items || []).find((it) => it.kind === "fill")?.paint;
  const glow = effects.find((e) => e.id === "stylize.outerGlow");
  placeAppearanceFloat(el, n);
  const objectChip = stackFill ? fillChip(stackFill) : "";
  el.innerHTML = `<h3 id="appear-title"><span>Appearance</span><span class="grow"></span>${icon("ellipsis", 12)}</h3>
    <div class="appear-row"><span class="chip ${stackFill ? "" : "none"}" style="background:${objectChip}"></span><span>${esc(objectLabel(n))}</span>
      <span class="grow"></span><span class="chip" style="background:#fff"></span><span class="chip none"></span></div>
    ${n.kind?.type === "text" ? `<div class="appear-row sub"><span class="eye">${icon("eye", 12)}</span><span class="chip" style="background:${charFill?.type === "solid" ? rgbCss(charFill.color) : "#fff"}"></span><span class="chip none"></span><span>Characters</span></div>` : ""}
    ${glow ? `<div class="appear-row"><span class="eye">${icon("eye", 12)}</span><span>▾</span><span class="grow">Outer Glow</span><span class="fxmark">fx</span></div>
      <div class="appear-sub">
        <span>Blur</span><span class="unit-field"><input class="full" data-glow="blur" type="number" value="${glow.params?.blur ?? 8}"/><span>pt</span></span>
        <span>Color</span><input class="full" data-glow="color" value="${esc(glow.params?.color || "#ffffff")}"/>
        <span>Mode</span><select class="full" data-glow="mode">${["Screen", "Normal", "Multiply", "Overlay"].map((m) => `<option ${(glow.params?.mode || "screen").toLowerCase() === m.toLowerCase() ? "selected" : ""}>${m}</option>`).join("")}</select>
        <span>Opacity</span><input class="full" data-glow="opacity" type="number" min="0" max="100" value="${glow.params?.opacity ?? 75}"/>
      </div>` : `<div class="appear-row"><button class="btn" id="add-glow">Add Outer Glow</button></div>`}
    <div class="appear-row dim"><span class="eye">${icon("eye", 12)}</span><span class="grow">Opacity</span><span>${Math.round((n.opacity ?? 1) * 100) === 100 ? "Default" : Math.round((n.opacity ?? 1) * 100) + "%"}</span></div>`;
  el.querySelectorAll("[data-glow]").forEach((input) => {
    input.onkeydown = (e) => e.stopPropagation();
    input.onchange = () => {
      pushHistory();
      const key = input.dataset.glow;
      glow.params = glow.params || {};
      glow.params[key] = key === "color" || key === "mode" ? input.value : +input.value;
      if (key === "mode") glow.params.mode = input.value.toLowerCase();
      paint();
    };
  });
  el.querySelector("#add-glow")?.addEventListener("click", () => commands.outerGlow());
  const title = el.querySelector("#appear-title");
  if (title) title.onpointerdown = (e) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY, pin: { ...(ui.appearPin || pinFrom(el)) } };
    const move = (ev) => {
      ui.appearPin = { x: start.pin.x + ev.clientX - start.x, y: start.pin.y + ev.clientY - start.y };
      el.style.left = ui.appearPin.x + "px";
      el.style.top = ui.appearPin.y + "px";
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

function pinFrom(el) {
  return { x: parseFloat(el.style.left) || 12, y: parseFloat(el.style.top) || 48 };
}
function placeAppearanceFloat(el, node) {
  if (ui.appearPin) {
    el.style.left = ui.appearPin.x + "px";
    el.style.top = ui.appearPin.y + "px";
    el.style.right = "auto";
    return;
  }
  const d = doc();
  const stage = $("stage").getBoundingClientRect();
  const canvas = $("canvas").getBoundingClientRect();
  const ox = canvas.left - stage.left;
  const oy = canvas.top - stage.top;
  const b = selectionBounds(d.file, d.selection);
  const art = d.file.document.artboards?.[d.artboard]?.rect;
  const artRight = art ? docToScreen({ x: art.x1, y: 0 }).x + ox : stage.width - 260;
  const selTop = b ? docToScreen({ x: 0, y: b.y0 }).y + oy : 36;
  const w = 248;
  let left = artRight + 14;
  if (left + w > stage.width - 8) left = Math.max(8, stage.width - w - 8);
  const top = Math.max(8, Math.min(selTop - 8, stage.height - 280));
  el.style.left = left + "px";
  el.style.top = top + "px";
  el.style.right = "auto";
  void node;
}

function boot() {
  try { const t = localStorage.getItem("vc-theme"); if (t) setTheme(t); } catch { /* ignore */ }
  $("ruler-row").style.display = "none";
  $("ruler-v").style.display = "none";
  drawAppbar();
  drawToolbar();
  drawPanel();
  drawHint();
  status();
  const canvas = $("canvas");
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", (e) => { onMove(e); if (gesture.mode === "penhandle") onPenDrag(e); });
  window.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("wheel", (e) => {
    if (!doc()) return;
    e.preventDefault();
    const s = local(e);
    if (e.ctrlKey || e.metaKey) zoomAt(s.x, s.y, e.deltaY > 0 ? 0.92 : 1.08);
    else { doc().panX -= e.deltaX; doc().panY -= e.deltaY; const view = $("art").querySelector("#view"); if (view) view.setAttribute("transform", viewTransform()); paintOverlay(); paintRulers(); }
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => {
    if (ui.tool === "zoom") fit("all");
    if (ui.tool === "selection") {
      const hit = hitAt(screenToDoc(local(e).x, local(e).y), true);
      if (hit?.kind?.type === "text") { doc().selection = [hit.id]; beginTextEdit(hit); }
      else if (hit) { doc().selection = [hit.id]; setTool("directSelection"); }
    }
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const p = screenToDoc(local(e).x, local(e).y);
    const hit = hitAt(p, false);
    if (hit && !doc().selection.includes(hit.id)) doc().selection = [hit.id];
    openMenu("Object", { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
  });
  canvas.addEventListener("dragover", (e) => e.preventDefault());
  canvas.addEventListener("drop", async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) openText(f.name, await f.text());
  });
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", () => { paintRulers(); paintOverlay(); });
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest(".menu,.flyout,.pop,.palette,.menu-btn,.search,.workspace")) closePops();
  });
  const loading = document.createElement("div");
  loading.className = "toast";
  loading.style.display = "block";
  loading.textContent = "Opening neon-drive…";
  document.body.appendChild(loading);
  openExample("neon-drive.vectorcraft").catch(() => {
    openDoc(newFile({ title: "Untitled-1" }), "Untitled-1");
    toast("Could not load the sample. Start from File → New.");
  }).finally(() => loading.remove());
}

boot();
