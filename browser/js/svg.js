/** Minimal SVG importer → VectorCraft path/text nodes. */

import { applyXf, ident, mulXf, pathFromAnchors } from "./geom.js";
import { makePathNode } from "./model.js";

function parseStyle(el) {
  const style = {};
  const raw = el.getAttribute("style") || "";
  for (const part of raw.split(";")) {
    const [k, v] = part.split(":").map((s) => s && s.trim());
    if (k && v) style[k] = v;
  }
  const attr = (name) => el.getAttribute(name) || style[name] || "";
  return {
    fill: attr("fill") || "#000",
    stroke: attr("stroke") || "none",
    strokeWidth: parseFloat(attr("stroke-width") || "1") || 1,
    opacity: parseFloat(attr("opacity") || "1"),
    fillOpacity: parseFloat(attr("fill-opacity") || "1"),
    strokeOpacity: parseFloat(attr("stroke-opacity") || "1"),
  };
}

function cssColor(s) {
  if (!s || s === "none") return null;
  s = s.trim();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return { model: "rgb", r: 0, g: 0, b: 0 };
    return { model: "rgb", r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { model: "rgb", r: (p[0] || 0) / 255, g: (p[1] || 0) / 255, b: (p[2] || 0) / 255 };
  }
  const named = { black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], blue: [0, 0, 1], green: [0, 0.5, 0] };
  if (named[s]) return { model: "rgb", r: named[s][0], g: named[s][1], b: named[s][2] };
  return { model: "rgb", r: 0, g: 0, b: 0 };
}

function paintOf(color, opacity) {
  if (!color) return { type: "none" };
  return { type: "solid", color, opacity };
}

function appearanceFrom(st) {
  const items = [];
  const fill = cssColor(st.fill);
  if (fill) items.push({ kind: "fill", paint: { type: "solid", color: fill }, opacity: st.fillOpacity, blend: "Normal", visible: true });
  const stroke = cssColor(st.stroke);
  if (stroke && st.stroke !== "none") {
    items.push({ kind: "stroke", paint: { type: "solid", color: stroke }, opacity: st.strokeOpacity, blend: "Normal", visible: true, width: st.strokeWidth, cap: "butt", join: "miter", miter_limit: 4, align: "center", arrow_scale: 1 });
  }
  if (!items.length) items.push({ kind: "fill", paint: { type: "none" }, opacity: 1, blend: "Normal", visible: true });
  return { items };
}

function parseTransform(s) {
  if (!s) return ident();
  let m = ident();
  const re = /(matrix|translate|scale|rotate)\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(s))) {
    const n = match[2].split(/[\s,]+/).map(Number);
    let t = ident();
    if (match[1] === "matrix") t = n;
    else if (match[1] === "translate") t = [1, 0, 0, 1, n[0] || 0, n[1] || 0];
    else if (match[1] === "scale") t = [n[0] || 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (match[1] === "rotate") {
      const a = (n[0] || 0) * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
      t = [co, si, -si, co, 0, 0];
      if (n.length >= 3) t = mulXf(mulXf([1, 0, 0, 1, n[1], n[2]], t), [1, 0, 0, 1, -n[1], -n[2]]);
    }
    m = mulXf(m, t);
  }
  return m;
}

function tokens(d) {
  const out = [];
  const re = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;
  let m;
  while ((m = re.exec(d || ""))) out.push(m[0]);
  return out;
}

function arcToCubics(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  // Endpoint-to-center, then sample as cubics via a polyline of corners (good enough).
  const pts = [];
  const steps = 8;
  const p = (phi * Math.PI) / 180;
  const co = Math.cos(p), si = Math.sin(p);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = co * dx + si * dy, y1p = -si * dx + co * dy;
  rx = Math.abs(rx) || 1e-6; ry = Math.abs(ry) || 1e-6;
  let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = fa !== fs ? 1 : -1;
  const sq = Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p));
  const coef = sign * Math.sqrt(sq);
  const cxp = coef * (rx * y1p) / ry, cyp = coef * -(ry * x1p) / rx;
  const cx = co * cxp - si * cyp + (x1 + x2) / 2;
  const cy = si * cxp + co * cyp + (y1 + y2) / 2;
  const ang = (u, v) => Math.atan2(u[1], u[0]) - Math.atan2(v[1], v[0]);
  let th = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  let dth = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - th;
  if (!fs && dth > 0) dth -= Math.PI * 2;
  if (fs && dth < 0) dth += Math.PI * 2;
  void ang;
  for (let i = 1; i <= steps; i++) {
    const t = th + dth * (i / steps);
    const x = cx + rx * Math.cos(t) * co - ry * Math.sin(t) * si;
    const y = cy + rx * Math.cos(t) * si + ry * Math.sin(t) * co;
    pts.push({ x, y });
  }
  return pts;
}

export function parsePathD(d) {
  const t = tokens(d);
  let i = 0;
  const subpaths = [];
  let sp = null;
  let cx = 0, cy = 0, sx = 0, sy = 0, cmd = "M", prev = "";
  const num = () => parseFloat(t[i++]);
  const isCmd = (c) => c && /[a-zA-Z]/.test(c);
  const start = (x, y) => { sp = { anchors: [{ p: { x, y }, in: { x, y }, out: { x, y }, kind: "Corner" }], closed: false }; subpaths.push(sp); sx = cx = x; sy = cy = y; };
  const line = (x, y) => { sp.anchors.push({ p: { x, y }, in: { x, y }, out: { x, y }, kind: "Corner" }); cx = x; cy = y; };
  const curve = (x1, y1, x2, y2, x, y) => {
    const last = sp.anchors[sp.anchors.length - 1];
    last.out = { x: x1, y: y1 };
    last.kind = "Smooth";
    sp.anchors.push({ p: { x, y }, in: { x: x2, y: y2 }, out: { x, y }, kind: "Smooth" });
    cx = x; cy = y;
  };
  while (i < t.length) {
    if (isCmd(t[i])) cmd = t[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "M") {
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      start(x, y);
      cmd = rel ? "l" : "L";
    } else if (C === "L") {
      line(num() + (rel ? cx : 0), num() + (rel ? cy : 0));
    } else if (C === "H") {
      line(num() + (rel ? cx : 0), cy);
    } else if (C === "V") {
      line(cx, num() + (rel ? cy : 0));
    } else if (C === "C") {
      const x1 = num() + (rel ? cx : 0), y1 = num() + (rel ? cy : 0);
      const x2 = num() + (rel ? cx : 0), y2 = num() + (rel ? cy : 0);
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      curve(x1, y1, x2, y2, x, y);
    } else if (C === "S") {
      const last = sp.anchors[sp.anchors.length - 1];
      const x1 = prev.toUpperCase() === "C" || prev.toUpperCase() === "S" ? cx * 2 - last.in.x : cx;
      const y1 = prev.toUpperCase() === "C" || prev.toUpperCase() === "S" ? cy * 2 - last.in.y : cy;
      const x2 = num() + (rel ? cx : 0), y2 = num() + (rel ? cy : 0);
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      curve(x1, y1, x2, y2, x, y);
    } else if (C === "Q") {
      const x1 = num() + (rel ? cx : 0), y1 = num() + (rel ? cy : 0);
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      curve(cx + 2 / 3 * (x1 - cx), cy + 2 / 3 * (y1 - cy), x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y), x, y);
    } else if (C === "A") {
      const rx = num(), ry = num(), phi = num(), fa = num(), fs = num();
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      for (const p of arcToCubics(cx, cy, rx, ry, phi, fa, fs, x, y)) line(p.x, p.y);
    } else if (C === "Z") {
      if (sp) { sp.closed = true; cx = sx; cy = sy; }
    }
    prev = cmd;
  }
  return { subpaths: subpaths.filter((s) => s.anchors.length) };
}

function mapAnchors(path, xf) {
  return {
    subpaths: path.subpaths.map((sp) => ({
      closed: sp.closed,
      anchors: sp.anchors.map((a) => ({
        p: applyXf(xf, a.p), in: applyXf(xf, a.in), out: applyXf(xf, a.out), kind: a.kind,
      })),
    })),
  };
}

export function importSVG(text, file) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("No <svg> element");
  const nodes = [];
  const walk = (el, xf) => {
    if (!el || el.nodeType !== 1) return;
    const local = mulXf(xf, parseTransform(el.getAttribute("transform")));
    const tag = el.localName;
    if (tag === "g" || tag === "svg") {
      for (const c of el.children) walk(c, local);
      return;
    }
    const st = parseStyle(el);
    let path = null;
    if (tag === "path") path = parsePathD(el.getAttribute("d") || "");
    else if (tag === "rect") {
      const x = +el.getAttribute("x") || 0, y = +el.getAttribute("y") || 0;
      const w = +el.getAttribute("width") || 0, h = +el.getAttribute("height") || 0;
      path = pathFromAnchors([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
    } else if (tag === "circle" || tag === "ellipse") {
      const cx = +el.getAttribute("cx") || 0, cy = +el.getAttribute("cy") || 0;
      const rx = tag === "circle" ? +el.getAttribute("r") || 0 : +el.getAttribute("rx") || 0;
      const ry = tag === "circle" ? rx : +el.getAttribute("ry") || 0;
      const k = 0.5522847498;
      const a = (px, py, ix, iy, ox, oy) => ({ p: { x: px, y: py }, in: { x: ix, y: iy }, out: { x: ox, y: oy }, kind: "Smooth" });
      path = { subpaths: [{ closed: true, anchors: [
        a(cx + rx, cy, cx + rx, cy - ry * k, cx + rx, cy + ry * k),
        a(cx, cy + ry, cx + rx * k, cy + ry, cx - rx * k, cy + ry),
        a(cx - rx, cy, cx - rx, cy + ry * k, cx - rx, cy - ry * k),
        a(cx, cy - ry, cx - rx * k, cy - ry, cx + rx * k, cy - ry),
      ] }] };
    } else if (tag === "polygon" || tag === "polyline") {
      const nums = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
      const pts = [];
      for (let i = 0; i < nums.length - 1; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
      path = pathFromAnchors(pts, tag === "polygon");
    } else if (tag === "line") {
      path = pathFromAnchors([
        { x: +el.getAttribute("x1") || 0, y: +el.getAttribute("y1") || 0 },
        { x: +el.getAttribute("x2") || 0, y: +el.getAttribute("y2") || 0 },
      ], false);
    } else if (tag === "text") {
      const x = +el.getAttribute("x") || 0, y = +el.getAttribute("y") || 0;
      const p = applyXf(local, { x, y });
      const size = parseFloat(el.getAttribute("font-size") || "16") || 16;
      const node = {
        id: file.document.next_id++,
        name: "Text",
        visible: true, locked: false, opacity: st.opacity || 1, blend: "Normal", isolate: false, knockout: false,
        appearance: { items: [] },
        kind: {
          type: "text",
          kind: { kind: "point" },
          xf: [1, 0, 0, 1, p.x, p.y],
          runs: [{ text: el.textContent || "", style: {
            font_family: (el.getAttribute("font-family") || "Source Sans 3").replace(/['"]/g, ""),
            font_style: "Regular", size, tracking: 0,
            fill: paintOf(cssColor(st.fill) || { model: "rgb", r: 0, g: 0, b: 0 }),
            stroke: { type: "none" },
          } }],
          para: { justify: "Left" },
        },
      };
      nodes.push(node);
      return;
    }
    if (!path || !path.subpaths.length) return;
    const app = appearanceFrom(st);
    const fill = app.items.find((it) => it.kind === "fill")?.paint;
    const strokeItem = app.items.find((it) => it.kind === "stroke");
    const node = makePathNode(file, mapAnchors(path, local), {
      fill: fill || { type: "none" },
      stroke: strokeItem?.paint || { type: "none" },
      strokeWidth: strokeItem?.width || 1,
    });
    node.opacity = st.opacity || 1;
    nodes.push(node);
  };
  walk(svg, ident());
  return nodes;
}
