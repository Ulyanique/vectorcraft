import { readFileSync } from "node:fs";
import { polygonBoolean } from "./bool.js";
import { renderDocument } from "./render.js";
import { loadFile } from "./model.js";

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

const feat = loadFile(readFileSync(new URL("../../examples/feature-sheet.vectorcraft", import.meta.url)));
const fs = renderDocument(feat);
console.log("feature body", fs.body.length, "mesh polys", (fs.body.match(/<path /g) || []).length);
