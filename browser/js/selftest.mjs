import { readFileSync } from "node:fs";
import { polygonBoolean } from "./bool.js";
import { expandBlend, renderDocument, repeatTransforms } from "./render.js";
import { addSpineAnchor, blendSpine, moveSpineAnchor, readBlendOptions, removeSpineAnchor, stepsBetween, writeBlendOptions } from "./blend.js";
import { applyRecolor, artworkColors, cluster, colorFromKey, colorKey, keepsNeutral, mapColor, neutralOf, reduceColors, tinted } from "./recolor.js";
import { clipEditTargets, loadFile, makeClippingMask, releaseClippingMask } from "./model.js";
import { ellipsePath, pathD, starPath, toRgb, warpDocPoint } from "./geom.js";
import { liveCorners, maxRadius, pathCorners, setEllipsePie, setLiveCorners, setPolygonSides } from "./corners.js";
import { addLinesAt, locateMesh, meshFromPath, meshLinesPath, moveMeshPoint, pointNear, removePointLines } from "./mesh.js";
import { parseFace, outlineGlyphs, rememberFace } from "./outlines.js";

const gray = toRgb({ model: "gray", k: 0.9 });
if (Math.abs(gray.r - 0.1) > 1e-6) throw new Error("gray ink should be 1-k, got " + gray.r);

const rect = { subpaths: [{ closed: true, anchors: [
  { p: { x: 0, y: 0 }, in: { x: 0, y: 0 }, out: { x: 0, y: 0 }, kind: "Corner" },
  { p: { x: 100, y: 0 }, in: { x: 100, y: 0 }, out: { x: 100, y: 0 }, kind: "Corner" },
  { p: { x: 100, y: 100 }, in: { x: 100, y: 100 }, out: { x: 100, y: 100 }, kind: "Corner" },
  { p: { x: 0, y: 100 }, in: { x: 0, y: 100 }, out: { x: 0, y: 100 }, kind: "Corner" },
] }] };
const mesh = meshFromPath(rect, { rows: 2, cols: 2, color: { model: "rgb", r: 1, g: 0, b: 0 }, appearance: "center", highlight: 100 });
if (!mesh || mesh.rows !== 2 || mesh.points.length !== 9) throw new Error("mesh grid");
const corner = mesh.points[0];
if (Math.hypot(corner.p.x, corner.p.y) > 1e-4) throw new Error("mesh corner " + JSON.stringify(corner.p));
const mid = mesh.points[1 * 3 + 1];
if (Math.abs(mid.p.x - 50) > 1e-3 || Math.abs(mid.p.y - 50) > 1e-3) throw new Error("mesh centre " + JSON.stringify(mid.p));
if (mid.color.r < 0.99 || mid.color.g < 0.99) throw new Error("center highlight " + JSON.stringify(mid.color));
if (corner.color.r < 0.99 || corner.color.g > 0.01) throw new Error("corner stays red " + JSON.stringify(corner.color));
const disk = meshFromPath(ellipsePath(50, 50, 40, 40), { rows: 2, cols: 2, appearance: "flat" });
const hub = disk.points[1 * 3 + 1].p;
if (Math.hypot(hub.x - 50, hub.y - 50) > 2) throw new Error("circle mesh centre " + JSON.stringify(hub));
console.log("mesh", mesh.points.length, "circle hub", hub.x.toFixed(2), hub.y.toFixed(2));

const meshGrid = meshFromPath(rect, { rows: 1, cols: 1, appearance: "flat", color: { model: "rgb", r: 0, g: 0, b: 1 } });
const rightHandle = meshGrid.points[1].handles[0].x;
moveMeshPoint(meshGrid, 1, 130, -20);
if (meshGrid.points[1].p.x !== 130 || meshGrid.points[1].p.y !== -20) throw new Error("mesh point did not move");
if (Math.abs(meshGrid.points[1].handles[0].x - rightHandle) > 1e-6) throw new Error("moving a point should keep handle offsets");
moveMeshPoint(meshGrid, 1, 150, -20, 2);
if (Math.abs(meshGrid.points[1].p.x - 130) > 1e-6) throw new Error("handle drag moved the point");
if (Math.abs(meshGrid.points[1].handles[2].x - 20) > 1e-6 || Math.abs(meshGrid.points[1].handles[2].y) > 1e-6) throw new Error("handle offset " + JSON.stringify(meshGrid.points[1].handles[2]));
const editable = meshFromPath(rect, { rows: 1, cols: 1, appearance: "flat" });
if (pointNear(editable, { x: 0, y: 0 }, 1) !== 0) throw new Error("pointNear missed the corner");
if (locateMesh(editable, { x: -10, y: 50 }) != null) throw new Error("locateMesh should reject a point outside the outline");
const added = addLinesAt(editable, { x: 50, y: 50 });
if (editable.rows !== 2 || editable.cols !== 2 || editable.points.length !== 9) throw new Error("addLinesAt grid " + editable.rows + "x" + editable.cols);
const hub2 = editable.points[added];
if (Math.hypot(hub2.p.x - 50, hub2.p.y - 50) > 1) throw new Error("added mesh point " + JSON.stringify(hub2.p));
const lines = pathD(meshLinesPath(editable));
if ((lines.match(/[MC]/g) || []).length < 12) throw new Error("mesh lines missing: " + lines.slice(0, 80));
if (!removePointLines(editable, added)) throw new Error("interior point should delete its lines");
if (editable.rows !== 1 || editable.cols !== 1 || editable.points.length !== 4) throw new Error("deletePoint left " + editable.points.length);
if (removePointLines(editable, 0)) throw new Error("a corner point has no interior line to delete");
console.log("mesh edit", added, "lines", lines.length);

function rectNode(x) {
  const corner = (px, py) => ({ p: { x: px, y: py }, in: { x: px, y: py }, out: { x: px, y: py }, kind: "Corner" });
  return {
    id: x + 1, visible: true, opacity: 1, appearance: { items: [] },
    kind: { type: "path", path: { subpaths: [{ closed: true, anchors: [corner(x, 0), corner(x + 10, 0), corner(x + 10, 10), corner(x, 10)] }] } },
  };
}
const keys = [rectNode(0), rectNode(100)];
const straight = expandBlend({ kind: { type: "blend", spec: { spacing: { steps: 1 } }, children: keys } });
const straightMid = straight[1].kind.path.subpaths[0].anchors.reduce((s, a) => ({ x: s.x + a.p.x, y: s.y + a.p.y }), { x: 0, y: 0 });
straightMid.x /= 4; straightMid.y /= 4;
if (Math.hypot(straightMid.x - 55, straightMid.y - 5) > 1e-6) throw new Error("straight blend mid " + JSON.stringify(straightMid));
const spine = { subpaths: [{ closed: false, anchors: [
  { p: { x: 5, y: 5 }, in: { x: 5, y: 5 }, out: { x: 5, y: 5 }, kind: "Corner" },
  { p: { x: 55, y: -95 }, in: { x: 55, y: -95 }, out: { x: 55, y: -95 }, kind: "Corner" },
  { p: { x: 105, y: 5 }, in: { x: 105, y: 5 }, out: { x: 105, y: 5 }, kind: "Corner" },
] }] };
const bent = expandBlend({ kind: { type: "blend", spec: { spacing: { steps: 1 }, spine, keyAnchors: [0, 2] }, children: keys } });
const bentMid = bent[1].kind.path.subpaths[0].anchors.reduce((s, a) => ({ x: s.x + a.p.x, y: s.y + a.p.y }), { x: 0, y: 0 });
bentMid.x /= 4; bentMid.y /= 4;
if (Math.hypot(bentMid.x - 55, bentMid.y + 95) > 1e-4) throw new Error("bent spine mid " + JSON.stringify(bentMid));
if (Math.hypot(bent[0].kind.path.subpaths[0].anchors[0].p.x - 0, bent[0].kind.path.subpaths[0].anchors[0].p.y) > 1e-6) throw new Error("key moved with the spine");
const live = blendSpine(keys, {});
if (live.anchors.join() !== "0,1" || Math.hypot(live.path.subpaths[0].anchors[0].p.x - 5, live.path.subpaths[0].anchors[0].p.y - 5) > 1e-6) {
  throw new Error("default spine " + JSON.stringify(live.path.subpaths[0].anchors.map((a) => a.p)));
}
const spineBlend = { kind: { type: "blend", spec: { spacing: { steps: 1 } }, children: [rectNode(0), rectNode(100)] } };
const inserted = addSpineAnchor(spineBlend, 55, 5);
if (inserted !== 1 || spineBlend.kind.spec.keyAnchors.join() !== "0,2") throw new Error("add spine point " + inserted + " " + spineBlend.kind.spec.keyAnchors);
if (!moveSpineAnchor(spineBlend, 1, 55, -95)) throw new Error("move spine point");
if (removeSpineAnchor(spineBlend, 0)) throw new Error("a key's spine point should stay");
const followed = expandBlend(spineBlend);
const followedMid = followed[1].kind.path.subpaths[0].anchors.reduce((s, a) => ({ x: s.x + a.p.x, y: s.y + a.p.y }), { x: 0, y: 0 });
followedMid.x /= 4; followedMid.y /= 4;
if (Math.hypot(followedMid.x - 55, followedMid.y + 95) > 1e-4) throw new Error("edited spine mid " + JSON.stringify(followedMid));
console.log("blend spine", inserted, "mid", followedMid.y.toFixed(2));

function painted(x, color) {
  const n = rectNode(x);
  n.appearance = { items: [{ kind: "fill", visible: true, paint: { type: "solid", color } }] };
  return n;
}
const red = painted(0, { model: "rgb", r: 1, g: 0, b: 0 });
const blue = painted(100, { model: "rgb", r: 0, g: 0, b: 1 });
if (stepsBetween([red, blue], { spacing: "smoothColor" }, 0) !== 128) throw new Error("smooth color steps");
if (stepsBetween([rectNode(0), rectNode(100)], { spacing: "smoothColor" }, 0) !== 50) throw new Error("same-color steps");
if (stepsBetween([rectNode(0), rectNode(100)], { spacing: { distance: 25 } }, 0) !== 3) throw new Error("distance steps");
if (stepsBetween([rectNode(0), rectNode(100)], { spacing: { steps: 70 } }, 0) !== 70) throw new Error("specified steps");
const opt = {};
writeBlendOptions(opt, { spacing: "distance", distance: 12, orientation: "path" });
if (opt.spacing.distance !== 12 || opt.orientation !== "alignToPath") throw new Error("write blend options " + JSON.stringify(opt));
const read = readBlendOptions(opt);
if (read.spacing !== "distance" || read.orientation !== "path" || read.distance !== 12) throw new Error("read blend options " + JSON.stringify(read));
function stacked(y) {
  const n = rectNode(0);
  n.kind.path.subpaths[0].anchors.forEach((a) => { a.p.y += y; a.in.y += y; a.out.y += y; });
  return n;
}
const upright = expandBlend({
  kind: {
    type: "blend",
    spec: {
      spacing: { steps: 1 },
      orientation: "alignToPath",
      keyAnchors: [0, 1],
      spine: { subpaths: [{ closed: false, anchors: [
        { p: { x: 5, y: 5 }, in: { x: 5, y: 5 }, out: { x: 5, y: 5 }, kind: "Corner" },
        { p: { x: 5, y: 105 }, in: { x: 5, y: 105 }, out: { x: 5, y: 105 }, kind: "Corner" },
      ] }] },
    },
    children: [stacked(0), stacked(100)],
  },
});
const turned = upright[1].kind.path.subpaths[0].anchors[0].p;
if (Math.abs(turned.x - 10) > 1e-3 || Math.abs(turned.y - 50) > 1e-3) throw new Error("align to path " + JSON.stringify(turned));
console.log("blend options", read.spacing, "turned", turned.x.toFixed(2), turned.y.toFixed(2));

function closeColor(a, b) {
  if (a.model !== b.model) return false;
  const keys = a.model === "cmyk" ? ["c", "m", "y", "k"] : a.model === "gray" ? ["k"] : a.model === "lab" ? ["l", "a", "b"] : ["r", "g", "b"];
  return keys.every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < (a.model === "lab" ? 0.1 : 1e-3));
}
if (colorKey({ model: "rgb", r: 1, g: 0.5, b: 0 }) !== "rgb 255 127.5 0") throw new Error("rgb key");
if (colorKey({ model: "cmyk", c: 0, m: 1, y: 1, k: 0 }) !== "cmyk 0 100 100 0") throw new Error("cmyk key");
if (colorKey({ model: "gray", k: 0.4 }) !== "gray 40") throw new Error("gray key");
if (colorKey({ model: "lab", l: 55, a: 60.5, b: -40.25 }) !== "lab 55 60.5 -40.25") throw new Error("lab key");
if (colorKey(colorFromKey("rgb 18 52 86")) !== "rgb 18 52 86") throw new Error("key round trip");
if (colorKey({ model: "cmyk", c: 0, m: 1, y: 1, k: 0 }) === colorKey({ model: "rgb", r: 1, g: 0, b: 0 })) throw new Error("cmyk red is not rgb red");
const inkRed = { model: "cmyk", c: 0, m: 1, y: 1, k: 0 };
const pink = tinted(inkRed, 0.4);
const scaled = mapColor("scaleTints", [pink, inkRed], { model: "cmyk", c: 1, m: 0.5, y: 0, k: 0 }, pink);
if (!closeColor(scaled, { model: "cmyk", c: 0.4, m: 0.2, y: 0, k: 0 })) throw new Error("scale tints " + JSON.stringify(scaled));
const other = { model: "cmyk", c: 0, m: 0.3, y: 0.8, k: 0 };
const kept = mapColor("preserveTints", [inkRed, tinted(inkRed, 0.5), other], { model: "cmyk", c: 1, m: 0, y: 0, k: 0 }, other);
if (!closeColor(kept, { model: "cmyk", c: 1, m: 0, y: 0, k: 0 })) throw new Error("preserve tints should leave a non-tint exact");
const hueRow = [{ model: "rgb", r: 0.9, g: 0.2, b: 0.2 }, { model: "rgb", r: 0.5, g: 0.1, b: 0.1 }, { model: "rgb", r: 1, g: 0.7, b: 0.7 }];
const hueTo = { model: "rgb", r: 0, g: 0.4, b: 1 };
if (!hueRow.every((c) => closeColor(mapColor("exact", hueRow, hueTo, c), hueTo))) throw new Error("exact");
const grayMapped = mapColor("exact", [{ model: "gray", k: 0.3 }], hueTo, { model: "gray", k: 0.3 });
if (grayMapped.model !== "gray") throw new Error("exact should keep gray");
const colors = [
  { model: "rgb", r: 1, g: 0, b: 0 },
  { model: "rgb", r: 0, g: 0, b: 1 },
  { model: "rgb", r: 0.9, g: 0.1, b: 0.05 },
  { model: "rgb", r: 0.1, g: 0.1, b: 0.9 },
  { model: "rgb", r: 1, g: 0.2, b: 0.2 },
];
const rows = cluster(colors, [5, 4, 1, 1, 1], 2).map((r) => r.join(","));
if (rows.join("|") !== "0,2,4|1,3") throw new Error("cluster " + rows.join("|"));
if (neutralOf({ model: "rgb", r: 1, g: 1, b: 1 }) !== "white" || !keepsNeutral({ model: "rgb", r: 0, g: 0, b: 0 })) throw new Error("preserve black and white");
const art = {
  id: 1,
  appearance: { items: [{ kind: "fill", paint: { type: "solid", color: { model: "rgb", r: 1, g: 0, b: 0 } } }] },
  kind: { type: "group", children: [{
    id: 2,
    appearance: { items: [] },
    kind: { type: "mesh", rows: 1, cols: 1, points: [{ p: { x: 0, y: 0 }, color: { model: "rgb", r: 0, g: 0, b: 1 } }] },
  }] },
};
if (artworkColors([art]).length !== 2) throw new Error("artwork colors");
const reduced = reduceColors(artworkColors([art]), { count: 1, method: "exact", preserve: { white: false, black: false, grays: false } });
if (reduced.map.length !== 1 || reduced.map[0].from.length !== 2) throw new Error("reduce to one row");
applyRecolor([art], [{ from: [{ model: "rgb", r: 1, g: 0, b: 0 }], to: { model: "rgb", r: 0, g: 1, b: 0 } }, { from: [{ model: "rgb", r: 0, g: 0, b: 1 }], to: hueTo, exclude: true }], "exact");
if (art.appearance.items[0].paint.color.g !== 1) throw new Error("fill was not recolored");
if (art.kind.children[0].kind.points[0].color.b !== 1) throw new Error("excluded mesh colour changed");
const grad = {
  id: 3,
  appearance: { items: [{ kind: "fill", paint: { type: "gradient", gradient: { stops: [
    { offset: 0, color: { model: "rgb", r: 1, g: 0, b: 0 } },
    { offset: 1, color: { model: "rgb", r: 0, g: 0, b: 1 } },
  ] } } }] },
  kind: { type: "text", runs: [{ style: { fill: { type: "solid", color: { model: "rgb", r: 1, g: 1, b: 0 } }, stroke: { type: "none" } } }] },
};
applyRecolor([grad], [
  { from: [{ model: "rgb", r: 1, g: 0, b: 0 }, { model: "rgb", r: 0, g: 0, b: 1 }], to: { model: "rgb", r: 0, g: 1, b: 0 } },
  { from: [{ model: "rgb", r: 1, g: 1, b: 0 }], to: { model: "rgb", r: 0, g: 0, b: 0 } },
], "exact");
const stops = grad.appearance.items[0].paint.gradient.stops;
if (stops[0].color.g !== 1 || stops[1].color.g !== 1) throw new Error("gradient stops were not recolored");
if (grad.kind.runs[0].style.fill.color.r !== 0) throw new Error("text fill was not recolored");
console.log("recolor", rows.join("|"));

function filledRect(id, x, y, w, h, color) {
  const corner = (px, py) => ({ p: { x: px, y: py }, in: { x: px, y: py }, out: { x: px, y: py }, kind: "Corner" });
  return {
    id, visible: true, opacity: 1,
    appearance: { items: [{ kind: "fill", paint: { type: "solid", color }, opacity: 1, visible: true }] },
    kind: { type: "path", path: { subpaths: [{ closed: true, anchors: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)] }] }, rule: "NonZero", clipping: false, guide: false },
  };
}
const clipFile = {
  document: {
    next_id: 10,
    artboards: [{ id: 1, rect: { x0: 0, y0: 0, x1: 200, y1: 200 } }],
    layers: [{ id: 1, kind: { type: "layer", children: [
      filledRect(2, 0, 0, 30, 30, { model: "rgb", r: 0, g: 0, b: 1 }),
      filledRect(3, 0, 0, 80, 80, { model: "rgb", r: 1, g: 0, b: 0 }),
      filledRect(4, 40, 40, 20, 20, { model: "rgb", r: 0, g: 1, b: 0 }),
    ] } }],
  },
};
const refused = makeClippingMask(clipFile, [3]);
if (!refused.error || clipFile.document.layers[0].kind.children.length !== 3) throw new Error("clip needs two objects");
const made = makeClippingMask(clipFile, [2, 4]);
if (made.error || made.id !== 10) throw new Error("make clip " + JSON.stringify(made));
const layerKids = clipFile.document.layers[0].kind.children;
if (layerKids.map((n) => n.id).join() !== "3,10") throw new Error("clip group should replace the top object: " + layerKids.map((n) => n.id));
const clipGroup = layerKids[1];
if (!clipGroup.kind.clip || clipGroup.kind.children.map((n) => n.id).join() !== "4,2") throw new Error("mask first " + clipGroup.kind.children.map((n) => n.id));
if (clipGroup.kind.children[0].kind.clipping !== true) throw new Error("mask should clip");
if (clipGroup.kind.children[0].appearance.items[0].paint.type !== "none") throw new Error("mask paint should be cleared");
if (clipEditTargets(clipFile, [10], true).join() !== "4") throw new Error("edit mask");
if (clipEditTargets(clipFile, [2], false).join() !== "2") throw new Error("edit contents from a child");
const clipped = renderDocument(clipFile);
if (!clipped.defs.includes("<clipPath") || !clipped.body.includes("clip-path=")) throw new Error("svg clip missing");
if (clipped.body.includes("rgb(0, 255, 0)") || clipped.body.includes("#00ff00")) throw new Error("mask fill should not paint");
if (!releaseClippingMask(clipFile, [10])) throw new Error("release");
if (clipGroup.kind.clip || clipGroup.kind.children[0].kind.clipping) throw new Error("release should stop clipping");
console.log("clipping mask", made.id);

const square = {
  id: 1, visible: true,
  kind: {
    type: "path",
    path: { subpaths: [{ closed: true, anchors: [
      { p: { x: 0, y: 0 }, in: { x: 0, y: 0 }, out: { x: 0, y: 0 }, kind: "Corner" },
      { p: { x: 100, y: 0 }, in: { x: 100, y: 0 }, out: { x: 100, y: 0 }, kind: "Corner" },
      { p: { x: 100, y: 80 }, in: { x: 100, y: 80 }, out: { x: 100, y: 80 }, kind: "Corner" },
      { p: { x: 0, y: 80 }, in: { x: 0, y: 80 }, out: { x: 0, y: 80 }, kind: "Corner" },
    ] }] },
    live: { shape: "rectangle", w: 100, h: 80, radii: [0, 0, 0, 0], xf: [1, 0, 0, 1, 0, 0] },
  },
};
if (pathCorners(square.kind.path).length !== 4) throw new Error("rectangle should have 4 corners");
if (Math.abs(maxRadius(pathCorners(square.kind.path)[0]) - 40) > 1e-6) throw new Error("corner max is half the shorter side");
setLiveCorners(square, { radius: 10, corners: [1] });
const cut = square.kind.path.subpaths[0].anchors;
if (cut.length !== 5) throw new Error("one rounded corner is two anchors, got " + cut.length);
if (liveCorners(square).sources[0].join() !== "0,1,1,2,3") throw new Error("corner sources " + liveCorners(square).sources[0]);
const end = cut[1];
if (Math.abs(end.p.x - 90) > 1e-6 || Math.abs(end.p.y) > 1e-6) throw new Error("top-right cut should meet the top at 90,0: " + JSON.stringify(end.p));
setLiveCorners(square, { kind: "chamfer", corners: [1] });
const chamfer = square.kind.path.subpaths[0].anchors[1];
if (Math.abs(chamfer.in.x - chamfer.p.x) > 1e-6 || Math.abs(chamfer.in.y - chamfer.p.y) > 1e-6) throw new Error("chamfer is straight");
const star = { id: 2, visible: true, kind: { type: "path", path: starPath(100, 100, 50, 5, 0.5) } };
if (pathCorners(star.kind.path).length !== 10) throw new Error("star corners");
setLiveCorners(star, { radius: 4 });
if (star.kind.live?.shape !== "path" || star.kind.path.subpaths[0].anchors.length !== 20) throw new Error("star cuts to 20 anchors");
setLiveCorners(star, { radius: 0 });
if (star.kind.live) throw new Error("a path with no cut corners is plain again");
const pie = { id: 3, visible: true, kind: { type: "path", path: ellipsePath(50, 50, 40, 20), live: { shape: "ellipse", w: 80, h: 40, pie: [0, 360], xf: [1, 0, 0, 1, 10, 30] } } };
setEllipsePie(pie, { end: 90 });
if (pie.kind.path.subpaths[0].anchors.length !== 3) throw new Error("quarter pie");
if (Math.abs(pie.kind.path.subpaths[0].anchors[0].p.x - 50) > 1e-6) throw new Error("pie centre follows xf");
const poly = { id: 4, visible: true, kind: { type: "path", path: { subpaths: [] }, live: { shape: "polygon", radius: 30, sides: 6, xf: [1, 0, 0, 1, 0, 0] } } };
setPolygonSides(poly, 5);
if (poly.kind.path.subpaths[0].anchors.length !== 5) throw new Error("polygon sides");
console.log("corners", "rect", cut.length, "star plain", star.kind.path.subpaths[0].anchors.length);

const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const b = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }];
const u = polygonBoolean(a, b, "union");
const i = polygonBoolean(a, b, "intersect");
const d = polygonBoolean(a, b, "difference");
console.log("union rings", u.length, "pts", u[0]?.length);
console.log("intersect", i.length, i[0]);
console.log("difference", d.length, d.map((r) => r.length));

const file = loadFile(readFileSync(new URL("../../examples/ribbons.vectorcraft", import.meta.url)));
const svg = renderDocument(file);
console.log("ribbons defs", svg.defs.length, "body", svg.body.length);
console.log("has Live Blends", svg.body.includes("Live Blends"));
console.log("path count", (svg.body.match(/<path /g) || []).length);

const neon = loadFile(readFileSync(new URL("../../examples/neon-drive.vectorcraft", import.meta.url)));
const ns = renderDocument(neon);
console.log("neon body", ns.body.length, "text", ns.body.includes("NEON DRIVE"), "glow", ns.defs.includes("feGaussianBlur"));

const font = readFileSync(new URL("../../assets/fonts/SourceSans3-Bold.ttf", import.meta.url));
const face = parseFace(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength));
const outlined = outlineGlyphs(face, "NO", { size: 100, tracking: 0 }, [1, 0, 0, 1, 0, 0], "Left");
console.log("outline glyphs", outlined.paths.length, "O contours", outlined.paths[1].subpaths.length);
rememberFace("Source Sans 3", "Bold", face);

const feat = loadFile(readFileSync(new URL("../../examples/feature-sheet.vectorcraft", import.meta.url)));
const fs = renderDocument(feat);
const polys = (fs.body.match(/<path /g) || []).length;
console.log("feature body", fs.body.length, "mesh polys", polys, "WARP text", fs.body.includes(">WARP<"));
if (fs.body.includes(">WARP<")) throw new Error("envelope left WARP as unwarped text");
if (polys < 8000) throw new Error("mesh tessellation coarser than the desktop renderer");
if (!fs.body.includes("Envelope Distort")) throw new Error("labels should stay as text");

const warp = outlineGlyphs(face, "WARP", { size: 150, tracking: 40 }, [1, 0, 0, 1, 910, 1150], "Left");
const src = { x0: 880, y0: 930, x1: 1340, y1: 1290 };
const p = warp.paths[0].subpaths[0].anchors[0].p;
const q = warpDocPoint(p, src, "flag", 45, 0, 0, true);
const needle = `${Math.round(q.x * 1000) / 1000} ${Math.round(q.y * 1000) / 1000}`;
console.log("warped anchor", needle, "moved", Math.hypot(q.x - p.x, q.y - p.y).toFixed(2));
if (!fs.body.includes(needle)) throw new Error("flag warp did not bend the glyph outline");
if (Math.hypot(q.x - p.x, q.y - p.y) < 1) throw new Error("flag bend did not move the glyph");

const spin = repeatTransforms(
  { type: "radial", instances: 12, radius: 135, center: { x: 350, y: 1090 }, startAngle: 0, endAngle: 360 },
  { x0: 350, y0: 860, x1: 350, y1: 1050 },
);
if (spin.length !== 12) throw new Error("radial instances");
const id = spin[0].every((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) < 1e-6);
if (!id) throw new Error("source already on the radius should not slide: " + spin[0]);
const grid = repeatTransforms(
  { type: "grid", rows: 2, cols: 2, hSpacing: 10, vSpacing: 10 },
  { x0: 0, y0: 0, x1: 10, y1: 10 },
);
if (grid.length !== 4 || Math.abs(grid[3][4] - 20) > 1e-6 || Math.abs(grid[3][5] - 20) > 1e-6) {
  throw new Error("grid repeat: " + JSON.stringify(grid[3]));
}
