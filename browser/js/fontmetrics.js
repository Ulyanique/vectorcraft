/** Advance widths and typographic em-box from the bundled fonts.

Illustrator tracking is added to every character, including the last, so a run's
width is sum(advances) + (tracking/1000)·size·count. Source Sans 3's hhea box
(ascent 1000, descent −326) is what the Transform fields measure. */

const FILES = {
  "Source Sans 3": {
    regular: "/assets/fonts/SourceSans3-Regular.ttf",
    semibold: "/assets/fonts/SourceSans3-Semibold.ttf",
    bold: "/assets/fonts/SourceSans3-Bold.ttf",
    italic: "/assets/fonts/SourceSans3-It.ttf",
  },
  Inter: {
    regular: "/assets/fonts/Inter-Regular.ttf",
    medium: "/assets/fonts/Inter-Medium.ttf",
    semibold: "/assets/fonts/Inter-SemiBold.ttf",
  },
  "Source Serif 4": { regular: "/assets/fonts/SourceSerif4-Regular.ttf" },
  "JetBrains Mono": { regular: "/assets/fonts/JetBrainsMono-Regular.ttf" },
};

const cache = new Map();
const pending = new Map();

function styleSlot(style) {
  const s = String(style || "regular").toLowerCase().replace(/[\s_-]+/g, "");
  if (s.includes("semibold") || s === "semi" || s.includes("demibold")) return "semibold";
  if (s.includes("extrabold") || s.includes("ultrabold")) return "bold";
  if (s.includes("bold")) return "bold";
  if (s.includes("medium")) return "medium";
  if (s.includes("italic") || s.includes("oblique")) return "italic";
  return "regular";
}

export function fontUrl(family, style) {
  const fam = FILES[family] || FILES["Source Sans 3"];
  return fam[styleSlot(style)] || fam.regular || fam.bold;
}

export function metricsFor(family, style) {
  return cache.get(fontUrl(family, style)) || null;
}

export function installMetrics(family, style, metrics) {
  cache.set(fontUrl(family, style), metrics);
}

export function loadFontMetrics(family, style) {
  const url = fontUrl(family, style);
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (pending.has(url)) return pending.get(url);
  const job = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(url);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const m = metricsFromBuffer(buf);
      cache.set(url, m);
      pending.delete(url);
      return m;
    })
    .catch((err) => {
      pending.delete(url);
      throw err;
    });
  pending.set(url, job);
  return job;
}

/** Width in document points. Tracking is 1/1000 em, applied to every character. */
export function measureWidth(metrics, text, size, tracking = 0) {
  if (!metrics || !text) return 0;
  let units = 0;
  let n = 0;
  for (const ch of text) {
    units += metrics.advance(ch.codePointAt(0));
    n++;
  }
  return (units / metrics.units) * size + (tracking / 1000) * size * n;
}

export function typoBox(metrics, size) {
  const units = metrics?.units || 1000;
  const ascent = (metrics?.ascent ?? 800) / units * size;
  const descent = Math.abs(metrics?.descent ?? 200) / units * size;
  return { ascent, descent };
}

export function metricsFromBuffer(buf) {
  const view = buf instanceof DataView ? buf : new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
  const u16 = (o) => view.getUint16(o);
  const i16 = (o) => view.getInt16(o);
  const u32 = (o) => view.getUint32(o);
  const num = u16(4);
  const tables = {};
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    tables[tag] = u32(o + 8);
  }
  const units = u16(tables.head + 18);
  const ascent = i16(tables.hhea + 4);
  const descent = i16(tables.hhea + 6);
  const numH = u16(tables.hhea + 34);
  const hmtx = tables.hmtx;
  const glyphOf = cmapLookup(view, tables.cmap);
  const advance = (cp) => {
    const g = glyphOf(cp) || 0;
    const gi = g < numH ? g : Math.max(0, numH - 1);
    return u16(hmtx + gi * 4);
  };
  return { units, ascent, descent, advance };
}

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
    const groups = new Array(n);
    let p = so + 16;
    for (let i = 0; i < n; i++) {
      groups[i] = [u32(p), u32(p + 4), u32(p + 8)];
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
