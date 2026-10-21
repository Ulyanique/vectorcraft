/** Layers panel: search, nested rows, thumbnails, target circles, footer. */

import {
  allocId, blankNode, childrenOf, indexNodes, nodeBounds, nonePaint, objectLabel, removeNodes, textOf,
} from "./model.js";
import { rgbCss } from "./geom.js";
import { thumbnailSVG } from "./render.js";
import { icon } from "./icons.js";

const LAYER_COLORS = [
  [0x4f, 0x80, 0xff], [0xff, 0x4f, 0x4f], [0x4f, 0xff, 0x4f], [0x4f, 0x4f, 0xff],
  [0xff, 0xff, 0x4f], [0xff, 0x4f, 0xff], [0x4f, 0xff, 0xff], [0x80, 0x80, 0x80],
  [0x00, 0x00, 0x00], [0xff, 0x66, 0x00], [0x00, 0x80, 0x00], [0x00, 0x80, 0x80],
  [0xcc, 0x99, 0x66], [0x99, 0x33, 0x00], [0x99, 0x33, 0xff], [0xff, 0x99, 0x00],
  [0x00, 0x00, 0x80], [0xff, 0x99, 0xcc], [0x99, 0x99, 0xff], [0x99, 0x00, 0x00],
  [0x66, 0x66, 0x00], [0xff, 0x99, 0x99], [0x99, 0x00, 0x33], [0x99, 0xcc, 0x00],
  [0x99, 0x66, 0x00], [0x66, 0x00, 0x99], [0xbb, 0xbb, 0xbb],
];
const THUMB_HEAVY = new Set(["layer", "group", "blend", "envelope", "repeat", "mesh"]);

export function layerColorCss(n) {
  const c = n?.kind?.color;
  let rgb = LAYER_COLORS[0];
  if (c && typeof c === "object") {
    if (c.Preset != null) rgb = LAYER_COLORS[(c.Preset >>> 0) % LAYER_COLORS.length];
    else if (Array.isArray(c.Custom)) rgb = c.Custom;
  } else if (typeof c === "number") rgb = LAYER_COLORS[c % LAYER_COLORS.length];
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

export function layerDisplayName(n) {
  if (n.name) return n.name;
  if (n.kind?.type === "text") {
    const s = textOf(n).slice(0, 32);
    return s || "<Text>";
  }
  return `<${objectLabel(n)}>`;
}

export function styledTarget(n) {
  const items = n.appearance?.items || [];
  const fills = items.filter((i) => i.kind === "fill").length;
  const strokes = items.filter((i) => i.kind === "stroke").length;
  const basic = !(n.appearance?.effects || []).length
    && fills <= 1 && strokes <= 1
    && items.every((i) => i.visible !== false && (i.opacity ?? 1) === 1 && (i.blend || "Normal") === "Normal");
  const ko = n.knockout;
  const knockout = ko === true || ko === "On" || ko === "Knockout";
  const plain = (n.opacity ?? 1) >= 1 && (n.blend || "Normal") === "Normal" && !n.isolate && !knockout && !n.extras?.mask;
  const groupPaint = (n.kind?.type === "group" || n.kind?.type === "layer") && items.length > 0;
  return !basic || groupPaint || !plain;
}

function collectLayerRows(n, depth, color, clipPath, shown, out, q, state) {
  const colour = n.kind?.type === "layer" ? layerColorCss(n) : color;
  const kids = childrenOf(n) || [];
  const canOpen = kids.length > 0 && n.kind?.type !== "compound";
  const name = layerDisplayName(n);
  const searching = !!q;
  const open = canOpen && (searching || state.layersOpen.has(n.id));
  const at = out.length;
  out.push({ n, depth, colour, clipPath, canOpen, open, name, dim: !shown || n.visible === false });
  if (open) {
    const childShown = shown && n.visible !== false;
    for (let i = kids.length - 1; i >= 0; i--) {
      collectLayerRows(kids[i], depth + 1, colour, i === 0 && !!n.kind?.clip, childShown, out, q, state);
    }
  }
  if (searching) {
    const own = name.toLowerCase().includes(q);
    if (!own && out.length === at + 1) out.splice(at, 1);
  }
}

export function listLayerRows(file, state) {
  const q = (state.layersQuery || "").trim().toLowerCase();
  const rows = [];
  const layers = file.document.layers || [];
  for (let i = layers.length - 1; i >= 0; i--) {
    collectLayerRows(layers[i], 0, layerColorCss(layers[i]), false, true, rows, q, state);
  }
  return rows;
}

function svgDataUrl(svg) {
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return "data:image/svg+xml;base64," + btoa(bin);
}

export function createLayers(api) {
  const { $, esc, toast, doc, file, ui } = api;
  let layerRowIds = [];
  let thumbQueue = [];

  function ensure() {
    const d = doc();
    if (!d || d.layersReady) return d;
    d.layersOpen = new Set(d.file.document.layers.map((l) => l.id));
    d.layerRows = [];
    d.layersQuery = "";
    d.currentLayer = d.file.document.layers.at(-1)?.id ?? null;
    d.layerTarget = null;
    d.thumbs = new Map();
    d.thumbPending = new Set();
    d.thumbGen = 0;
    d.layersReady = true;
    return d;
  }
  function clearThumbs() {
    const d = doc();
    if (!d) return;
    d.thumbs = new Map();
    d.thumbPending = new Set();
    d.thumbGen = (d.thumbGen || 0) + 1;
  }
  function containing(id) {
    const f = file();
    if (!f) return null;
    const { map, parent } = indexNodes(f);
    let n = map.get(id);
    while (n) {
      if (n.kind?.type === "layer") return n.id;
      n = parent.get(n.id);
    }
    return doc()?.currentLayer ?? null;
  }
  function syncSelection() {
    const d = doc();
    if (!d) return;
    const key = d.selection.join(",");
    if (d._layerSelKey === key) return;
    d._layerSelKey = key;
    if (!d.selection.length) return;
    const { parent } = indexNodes(d.file);
    for (const id of d.selection) {
      let p = parent.get(id);
      while (p) { d.layersOpen.add(p.id); p = parent.get(p.id); }
    }
    d.layerRows = [...d.selection];
    d.currentLayer = containing(d.selection[0]) || d.currentLayer;
  }
  function ancestorsOf(ids) {
    const { parent } = indexNodes(file());
    const s = new Set();
    for (const id of ids) {
      let p = parent.get(id);
      while (p) { s.add(p.id); p = parent.get(p.id); }
    }
    return s;
  }
  function thumbCost(n) {
    if (n.kind?.type === "blend") return (n.kind.spec?.spacing?.steps || 20) + 2;
    const kids = childrenOf(n);
    if (!kids) return 1;
    return 1 + kids.reduce((s, c) => s + thumbCost(c), 0);
  }
  function firstPaintColor(n) {
    for (const it of n.appearance?.items || []) {
      if (it.paint?.type === "solid") return rgbCss(it.paint.color);
    }
    for (const c of childrenOf(n) || []) {
      const hit = firstPaintColor(c);
      if (hit) return hit;
    }
    return null;
  }
  function inlineThumb(n) {
    const b = nodeBounds(n);
    const span = b ? Math.max(b.x1 - b.x0, b.y1 - b.y0, 1) : 10;
    const hasFill = (n.appearance?.items || []).some((it) => it.kind === "fill" && it.paint?.type && it.paint.type !== "none");
    const minStroke = (n.kind?.type === "path" || n.kind?.type === "compound") && !hasFill ? span * 0.07 : 0;
    let { svg } = thumbnailSVG(n, 48, { minStroke });
    if (n.kind?.type === "text") {
      const c = n.kind.runs?.[0]?.style?.fill?.color;
      if (c && (c.r ?? 0) * 0.3 + (c.g ?? 0) * 0.59 + (c.b ?? 0) * 0.11 > 0.82) {
        svg = svg.replace(/(<text\b[^>]*?)fill="[^"]*"/, "$1fill=\"#8a8a8a\"");
      }
    }
    return svg;
  }
  function thumbMarkup(n) {
    const t = n.kind?.type;
    if (!THUMB_HEAVY.has(t)) return inlineThumb(n);
    const cached = doc().thumbs?.get(n.id);
    if (cached) return `<img alt="" draggable="false" src="${cached}"/>`;
    if (thumbCost(n) > 900) {
      const color = firstPaintColor(n) || "#bbb";
      return `<svg viewBox="0 0 16 16"><rect width="16" height="16" fill="#fff"/><rect x="3" y="3" width="10" height="10" fill="${color}"/></svg>`;
    }
    thumbQueue.push(n);
    return `<img alt="" draggable="false" class="pending"/>`;
  }
  function scheduleThumbs(nodes) {
    const d = doc();
    if (!d || !nodes?.length || typeof Image === "undefined") return;
    if (!d.thumbs) d.thumbs = new Map();
    if (!d.thumbPending) d.thumbPending = new Set();
    const gen = d.thumbGen || 0;
    for (const n of nodes) {
      if (d.thumbs.has(n.id) || d.thumbPending.has(n.id)) continue;
      d.thumbPending.add(n.id);
      let spec;
      try { spec = thumbnailSVG(n, 720); }
      catch { d.thumbPending.delete(n.id); continue; }
      const img = new Image();
      const id = n.id;
      img.onload = () => {
        d.thumbPending.delete(id);
        if (d.thumbGen !== gen || doc() !== d) return;
        const c = document.createElement("canvas");
        c.width = 36;
        c.height = 36;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, 36, 36);
        const iw = img.naturalWidth || 36, ih = img.naturalHeight || 36;
        const fit = Math.min(32 / iw, 32 / ih);
        const dw = iw * fit, dh = ih * fit;
        ctx.drawImage(img, (36 - dw) / 2, (36 - dh) / 2, dw, dh);
        let url = "";
        try { url = c.toDataURL("image/png"); } catch { return; }
        d.thumbs.set(id, url);
        const el = document.querySelector(`.lthumb[data-nid="${id}"] img`);
        if (el && doc() === d) {
          el.src = url;
          el.classList.remove("pending");
        }
      };
      img.onerror = () => d.thumbPending.delete(id);
      img.src = svgDataUrl(spec.svg);
    }
  }
  function rowsHTML() {
    const f = file();
    const d = doc();
    thumbQueue = [];
    layerRowIds = [];
    if (!f || !d) return "";
    const rows = listLayerRows(f, d);
    const sel = new Set(d.selection);
    const hi = new Set(d.layerRows || []);
    const ancestors = ancestorsOf(d.selection);
    const current = d.currentLayer;
    return rows.map((r) => {
      const n = r.n;
      layerRowIds.push(n.id);
      const highlighted = hi.has(n.id) || (n.kind?.type === "layer" && n.id === current);
      const sq = sel.has(n.id) ? "on" : ancestors.has(n.id) ? "child" : "";
      const tgt = [d.layerTarget === n.id ? "on" : "", styledTarget(n) ? "styled" : ""].filter(Boolean).join(" ");
      const disc = r.canOpen ? icon(r.open ? "chevron" : "chevron-right", 11) : "";
      const name = d.renaming === n.id
        ? `<input class="lrename" value="${esc(n.name || r.name)}" spellcheck="false"/>`
        : `<span class="lnm ${r.clipPath ? "clip" : ""}" title="${esc(r.name)}">${esc(r.name)}</span>`;
      return `<div class="lrow${highlighted ? " hi" : ""}${r.dim ? " dim" : ""}" data-id="${n.id}" style="--lc:${r.colour}">
        ${n.kind?.type === "layer" && n.id === current ? `<i class="lcur"></i>` : ""}
        <button class="leye" data-leye="${n.id}" title="${n.visible === false ? "Show" : "Hide"}">${n.visible === false ? "" : icon("eye", 13)}</button>
        <button class="llock${n.locked ? " on" : ""}" data-llock="${n.id}" title="${n.locked ? "Unlock" : "Lock"}">${icon("lock", 12)}</button>
        <i class="lbar${n.kind?.type === "layer" ? " wide" : ""}"></i>
        <button class="ldisc" data-ldisc="${n.id}" style="margin-left:${r.depth * 14}px">${disc}</button>
        <span class="lthumb" data-nid="${n.id}">${thumbMarkup(n)}</span>
        ${name}
        <button class="ltgt ${tgt}" data-ltgt="${n.id}" title="Target"><i class="ring"></i><i class="dot"></i><i class="inner"></i></button>
        <button class="lsq ${sq}" data-lsq="${n.id}" title="Select art"><i></i></button>
      </div>`;
    }).join("");
  }
  function html() {
    const f = file();
    if (!f) return `<p class="hint">No document.</p>`;
    ensure();
    syncSelection();
    const n = f.document.layers.length;
    return `<label class="lsearch"><input id="layer-search" placeholder="Search All" value="${esc(doc().layersQuery || "")}" spellcheck="false" autocomplete="off"/></label>
      <div class="llist">${rowsHTML()}</div>
      <div class="lfoot">
        <span class="lcount">${n} Layer${n === 1 ? "" : "s"}</span>
        <span class="grow"></span>
        <button data-lcmd="locate" title="Locate Object">${icon("search", 14)}</button>
        <button data-lcmd="clip" title="Make/Release Clipping Mask">${icon("frame", 14)}</button>
        <button data-lcmd="sublayer" title="Create New Sublayer">${icon("plus", 14)}</button>
        <button data-lcmd="newlayer" title="Create New Layer">${icon("file-plus", 14)}</button>
        <button data-lcmd="delete" title="Delete Selection">${icon("trash-2", 14)}</button>
      </div>`;
  }
  function countLayers(f) {
    let n = 0;
    const walk = (node) => {
      if (node.kind?.type === "layer") n++;
      for (const c of childrenOf(node) || []) walk(c);
    };
    for (const l of f.document.layers) walk(l);
    return n;
  }
  function currentLayerNode() {
    const d = doc();
    const { map } = indexNodes(d.file);
    const n = map.get(d.currentLayer);
    if (n?.kind?.type === "layer") return n;
    return d.file.document.layers.at(-1) || null;
  }
  function createLayer(sub) {
    const d = doc();
    if (!d) return;
    const f = d.file;
    const parent = sub ? currentLayerNode() : null;
    if (sub && !parent) { toast("No layer to add a sublayer to"); return; }
    api.pushHistory();
    const id = allocId(f);
    const nLayers = countLayers(f);
    const layer = blankNode(id, {
      type: "layer", color: { Preset: nLayers % LAYER_COLORS.length },
      template: false, printable: true, preview: true, children: [],
    });
    layer.name = "Layer " + (nLayers + 1);
    if (sub) {
      parent.kind.children.push(layer);
      d.layersOpen.add(parent.id);
    } else {
      const idx = f.document.layers.findIndex((l) => l.id === d.currentLayer);
      f.document.layers.splice(idx < 0 ? f.document.layers.length : idx + 1, 0, layer);
    }
    d.layersOpen.add(id);
    d.layerRows = [id];
    d.layerAnchor = id;
    d.currentLayer = id;
    api.paint();
    api.refreshChrome();
  }
  function deleteRows() {
    const d = doc();
    if (!d) return;
    const ids = (d.layerRows?.length ? d.layerRows : d.selection).slice();
    if (!ids.length) { toast("Nothing selected"); return; }
    const top = d.file.document.layers;
    if (top.length && top.every((l) => ids.includes(l.id))) {
      toast("A document needs at least one layer");
      return;
    }
    api.pushHistory();
    removeNodes(d.file, ids);
    const { map } = indexNodes(d.file);
    d.selection = d.selection.filter((id) => map.has(id));
    d.layerRows = (d.layerRows || []).filter((id) => map.has(id));
    if (!map.has(d.currentLayer)) d.currentLayer = d.file.document.layers.at(-1)?.id ?? null;
    d._layerSelKey = d.selection.join(",");
    api.paint();
    api.refreshChrome();
  }
  function locate() {
    const d = doc();
    ui.panel = "layers";
    ui.panels = true;
    $("panel")?.classList.remove("collapsed");
    if (!d?.selection.length) { api.drawPanel(); toast("Nothing selected"); return; }
    ensure();
    const { parent } = indexNodes(d.file);
    for (const id of d.selection) {
      let p = parent.get(id);
      while (p) { d.layersOpen.add(p.id); p = parent.get(p.id); }
    }
    d.layerRows = [...d.selection];
    d._layerSelKey = d.selection.join(",");
    api.drawPanel();
    document.querySelector(`.lrow[data-id="${d.selection[0]}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function clipHost() {
    const d = doc();
    const { map } = indexNodes(d.file);
    const rows = d.layerRows || [];
    if (rows.length === 1) {
      const n = map.get(rows[0]);
      if (n && (n.kind?.type === "layer" || n.kind?.type === "group")) return n;
    }
    if (d.selection.length === 1) {
      const n = map.get(d.selection[0]);
      if (n?.kind?.type === "group") return n;
    }
    return map.get(d.currentLayer) || d.file.document.layers.at(-1) || null;
  }
  function stripToClip(n) {
    n.appearance = {
      items: [
        { kind: "fill", paint: nonePaint(), opacity: 1, blend: "Normal", visible: true },
        { kind: "stroke", paint: nonePaint(), width: 0, cap: "Butt", join: "Miter", miter_limit: 10, align: "Center", arrow_scale: [100, 100], opacity: 1, blend: "Normal", visible: true },
      ],
    };
    if (n.kind && (n.kind.type === "path" || n.kind.type === "compound")) n.kind.clipping = true;
    if (n.kind?.type === "text") {
      for (const r of n.kind.runs || []) {
        if (!r.style) continue;
        r.style.fill = nonePaint();
        r.style.stroke = nonePaint();
        r.style.stroke_width = 0;
      }
    }
  }
  function toggleClip() {
    const d = doc();
    if (!d) return;
    const container = clipHost();
    if (!container || (container.kind?.type !== "layer" && container.kind?.type !== "group")) {
      toast("No layer to clip");
      return;
    }
    if (container.kind.clip) {
      api.pushHistory();
      container.kind.clip = false;
      const first = (childrenOf(container) || [])[0];
      if (first?.kind && "clipping" in first.kind) first.kind.clipping = false;
      api.paint();
      api.refreshChrome();
      return;
    }
    const kids = childrenOf(container) || [];
    const top = kids[kids.length - 1];
    if (!top) { toast("The layer has no objects to clip by"); return; }
    const kind = top.kind?.type;
    if (kind !== "path" && kind !== "compound" && kind !== "text") {
      toast("The top object must be a path or text");
      return;
    }
    api.pushHistory();
    stripToClip(top);
    const i = kids.indexOf(top);
    if (i > 0) { kids.splice(i, 1); kids.unshift(top); }
    container.kind.clip = true;
    d.layersOpen.add(container.id);
    api.paint();
    api.refreshChrome();
  }
  function pickRow(id, e) {
    const d = doc();
    const { map } = indexNodes(d.file);
    const n = map.get(id);
    if (!n) return;
    if (e.shiftKey && d.layerAnchor != null) {
      const i = layerRowIds.indexOf(d.layerAnchor);
      const j = layerRowIds.indexOf(id);
      if (i >= 0 && j >= 0) {
        const [a, b] = i < j ? [i, j] : [j, i];
        const range = layerRowIds.slice(a, b + 1);
        d.layerRows = (e.metaKey || e.ctrlKey) ? [...new Set([...(d.layerRows || []), ...range])] : range;
      }
    } else if (e.metaKey || e.ctrlKey) {
      const rows = d.layerRows || [];
      d.layerRows = rows.includes(id) ? rows.filter((x) => x !== id) : [...rows, id];
      d.layerAnchor = id;
    } else {
      d.layerRows = [id];
      d.layerAnchor = id;
      if (n.kind?.type !== "layer") {
        d.selection = [id];
        d._layerSelKey = String(id);
        api.syncProxyFromSelection();
      }
    }
    d.currentLayer = containing(id);
    api.paintOverlay();
    api.drawPanel();
    api.drawTaskbar();
    api.status();
  }
  function selectArt(id, add) {
    const d = doc();
    const { map } = indexNodes(d.file);
    const n = map.get(id);
    if (!n) return;
    const ids = [];
    if (n.kind?.type === "layer") {
      const walk = (c) => {
        if (c.visible === false || c.locked) return;
        if (c.kind?.type === "layer") { for (const k of childrenOf(c) || []) walk(k); return; }
        ids.push(c.id);
      };
      for (const c of childrenOf(n) || []) walk(c);
    } else ids.push(id);
    if (!ids.length) return;
    if (add) {
      const all = ids.every((i) => d.selection.includes(i));
      d.selection = all ? d.selection.filter((i) => !ids.includes(i)) : [...new Set([...d.selection, ...ids])];
    } else d.selection = ids;
    d._layerSelKey = d.selection.join(",");
    api.syncProxyFromSelection();
    api.paintOverlay();
    api.drawPanel();
    api.drawTaskbar();
    api.status();
  }
  function beginRename(id) {
    doc().renaming = id;
    api.drawPanel();
    const input = document.querySelector(".lrename");
    if (!input) return;
    input.focus();
    input.select();
  }
  function commitRename(id, value, cancel) {
    const d = doc();
    if (d.renaming == null) return;
    d.renaming = null;
    if (!cancel) {
      const { map } = indexNodes(d.file);
      const n = map.get(id);
      const next = value.trim();
      if (n && next !== (n.name || "")) {
        api.pushHistory();
        n.name = next || null;
      }
    }
    api.drawPanel();
  }
  function wireRows() {
    const body = $("pbody");
    body.querySelectorAll("[data-leye]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const { map } = indexNodes(file());
      const n = map.get(+b.dataset.leye);
      if (!n) return;
      api.pushHistory();
      n.visible = n.visible === false;
      api.paint();
      api.drawPanel();
    });
    body.querySelectorAll("[data-llock]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const { map } = indexNodes(file());
      const n = map.get(+b.dataset.llock);
      if (!n) return;
      api.pushHistory();
      n.locked = !n.locked;
      if (n.locked) {
        const d = doc();
        d.selection = d.selection.filter((id) => id !== n.id);
        d._layerSelKey = d.selection.join(",");
      }
      api.drawPanel();
    });
    body.querySelectorAll("[data-ldisc]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const id = +b.dataset.ldisc;
      const d = doc();
      const { map } = indexNodes(file());
      const n = map.get(id);
      if (!n || !(childrenOf(n) || []).length) return;
      const next = !d.layersOpen.has(id);
      const apply = (node) => {
        if (next) d.layersOpen.add(node.id); else d.layersOpen.delete(node.id);
        if (e.altKey) for (const c of childrenOf(node) || []) if (c.kind?.type !== "compound") apply(c);
      };
      apply(n);
      api.drawPanel();
    });
    body.querySelectorAll("[data-ltgt]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const id = +b.dataset.ltgt;
      doc().layerTarget = id;
      selectArt(id, e.shiftKey);
      doc().layerTarget = id;
    });
    body.querySelectorAll("[data-lsq]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      selectArt(+b.dataset.lsq, e.shiftKey);
    });
    body.querySelectorAll(".lrow").forEach((row) => {
      row.onclick = (e) => {
        if (e.target.closest("button, input")) return;
        pickRow(+row.dataset.id, e);
      };
    });
    body.querySelectorAll(".lnm").forEach((nm) => nm.ondblclick = (e) => {
      e.stopPropagation();
      beginRename(+nm.closest(".lrow").dataset.id);
    });
    body.querySelectorAll(".lrename").forEach((input) => {
      input.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { e.preventDefault(); input.dataset.cancel = "1"; input.blur(); }
      };
      input.onblur = () => commitRename(+input.closest(".lrow").dataset.id, input.value, input.dataset.cancel === "1");
      input.onclick = (e) => e.stopPropagation();
    });
  }
  function wire() {
    const body = $("pbody");
    const search = $("layer-search");
    if (search) {
      search.oninput = () => {
        doc().layersQuery = search.value;
        const list = body.querySelector(".llist");
        const top = list.scrollTop;
        list.innerHTML = rowsHTML();
        list.scrollTop = top;
        wireRows();
        scheduleThumbs(thumbQueue);
      };
      search.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); search.blur(); }
      };
    }
    body.querySelectorAll("[data-lcmd]").forEach((b) => b.onclick = () => {
      const cmd = b.dataset.lcmd;
      if (cmd === "locate") locate();
      else if (cmd === "clip") toggleClip();
      else if (cmd === "sublayer") createLayer(true);
      else if (cmd === "newlayer") createLayer(false);
      else if (cmd === "delete") deleteRows();
    });
    wireRows();
    scheduleThumbs(thumbQueue);
  }
  return { html, wire, clearThumbs, ensure };
}
