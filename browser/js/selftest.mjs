import { readFileSync } from "node:fs";
import { polygonBoolean } from "./bool.js";
import { expandBlend, renderDocument, repeatTransforms } from "./render.js";
import { addSpineAnchor, blendSpine, moveSpineAnchor, removeSpineAnchor } from "./blend.js";
import { loadFile } from "./model.js";
import { ellipsePath, pathD, toRgb, warpDocPoint } from "./geom.js";
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
