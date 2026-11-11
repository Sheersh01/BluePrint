/**
 * Tiny hand-drawn diagram renderer (Excalidraw look) for authored articles.
 *
 * Spec (one statement per line, `#` comments allowed):
 *   node <id> <col>,<row> [box|circle] "Line 1|line 2|line 3"
 *   edge <a> <-> <b> "optional label"        (also ->  and <-)
 *   note <col>,<row> "text|more text"          (free text, left aligned)
 * Columns/rows may be fractional (e.g. 1.5).
 */

const COL_W = 250;
const ROW_H = 165;
const FONT = 'font-family="Virgil, Segoe UI Emoji" font-size="16px" fill="#1e1e1e"';
const STROKE = 'stroke="#1e1e1e" stroke-width="1" fill="none" stroke-linecap="round"';

function rng(seedStr) {
  let h = 2166136261;
  for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function parseSpec(src) {
  const nodes = new Map();
  const edges = [];
  const notes = [];
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    let m;
    if ((m = line.match(/^node\s+(\S+)\s+(-?[\d.]+),(-?[\d.]+)\s+(box|circle)\s+"(.*)"$/))) {
      nodes.set(m[1], { id: m[1], col: +m[2], row: +m[3], shape: m[4], lines: m[5].split("|") });
    } else if ((m = line.match(/^edge\s+(\S+)\s+(<->|->|<-)\s+(\S+)(?:\s+"(.*)")?$/))) {
      edges.push({ a: m[1], dir: m[2], b: m[3], label: m[4] });
    } else if ((m = line.match(/^note\s+(-?[\d.]+),(-?[\d.]+)\s+"(.*)"$/))) {
      notes.push({ col: +m[1], row: +m[2], lines: m[3].split("|") });
    } else {
      throw new Error(`diagram: cannot parse "${line}"`);
    }
  }
  return { nodes, edges, notes };
}

function textWidth(lines) {
  return Math.max(...lines.map((l) => l.length)) * 8.2;
}

function layout(spec) {
  for (const n of spec.nodes.values()) {
    const tw = textWidth(n.lines);
    const th = n.lines.length * 20;
    n.cx = n.col * COL_W + COL_W / 2;
    n.cy = n.row * ROW_H + ROW_H / 2;
    if (n.shape === "circle") {
      const d = Math.max(96, Math.min(150, Math.max(tw + 30, th + 40)));
      n.w = n.h = d;
    } else {
      n.w = Math.max(110, tw + 44);
      n.h = Math.max(64, th + 34);
    }
  }
  // Notes: left edge on the column's centre line, vertically centred on the row's centre line.
  for (const n of spec.notes) {
    n.w = textWidth(n.lines);
    n.h = n.lines.length * 20;
    n.x = n.col * COL_W + COL_W / 2;
    n.y = n.row * ROW_H + ROW_H / 2 - n.h / 2;
  }
}

function wobblyLine(r, x1, y1, x2, y2) {
  const j = () => (r() - 0.5) * 2.2;
  const mx = (x1 + x2) / 2 + j() * 1.5;
  const my = (y1 + y2) / 2 + j() * 1.5;
  return `M${(x1 + j()).toFixed(2)} ${(y1 + j()).toFixed(2)} Q${mx.toFixed(2)} ${my.toFixed(2)} ${(x2 + j()).toFixed(2)} ${(y2 + j()).toFixed(2)}`;
}

function roundedRect(r, x, y, w, h) {
  const rad = Math.min(18, w / 6, h / 4);
  const parts = [];
  for (let pass = 0; pass < 2; pass++) {
    const j = () => (r() - 0.5) * 2.4;
    parts.push(
      `M${x + rad + j()} ${y + j()} L${x + w - rad + j()} ${y + j()} Q${x + w} ${y} ${x + w + j()} ${y + rad + j()} ` +
        `L${x + w + j()} ${y + h - rad + j()} Q${x + w} ${y + h} ${x + w - rad + j()} ${y + h + j()} ` +
        `L${x + rad + j()} ${y + h + j()} Q${x} ${y + h} ${x + j()} ${y + h - rad + j()} ` +
        `L${x + j()} ${y + rad + j()} Q${x} ${y} ${x + rad + j()} ${y + j()}`,
    );
  }
  return parts.map((d) => `<path d="${d}" ${STROKE}></path>`).join("");
}

function ellipse(r, cx, cy, rx, ry) {
  const parts = [];
  for (let pass = 0; pass < 2; pass++) {
    const pts = [];
    const start = r() * Math.PI * 2;
    for (let k = 0; k <= 16; k++) {
      const a = start + (k / 16) * Math.PI * 2 + (pass ? 0.05 : 0);
      const wob = 1 + (r() - 0.5) * 0.025;
      pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
    }
    let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
    for (let k = 1; k < pts.length; k++) {
      const [px, py] = pts[k - 1];
      const [qx, qy] = pts[k];
      d += ` Q${px.toFixed(2)} ${py.toFixed(2)} ${((px + qx) / 2).toFixed(2)} ${((py + qy) / 2).toFixed(2)}`;
    }
    parts.push(d);
  }
  return parts.map((d) => `<path d="${d}" ${STROKE}></path>`).join("");
}

function boundaryPoint(n, tx, ty, gap = 10) {
  const dx = tx - n.cx;
  const dy = ty - n.cy;
  const len = Math.hypot(dx, dy) || 1;
  if (n.shape === "circle") {
    const rr = n.w / 2 + gap;
    return [n.cx + (dx / len) * rr, n.cy + (dy / len) * rr];
  }
  const hw = n.w / 2 + gap;
  const hh = n.h / 2 + gap;
  const s = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  return [n.cx + dx * s, n.cy + dy * s];
}

function arrowHead(r, x, y, fromX, fromY) {
  const ang = Math.atan2(y - fromY, x - fromX);
  const L = 14;
  const a1 = ang + Math.PI - 0.42;
  const a2 = ang + Math.PI + 0.42;
  return (
    `<path d="${wobblyLine(r, x + Math.cos(a1) * L, y + Math.sin(a1) * L, x, y)}" ${STROKE}></path>` +
    `<path d="${wobblyLine(r, x + Math.cos(a2) * L, y + Math.sin(a2) * L, x, y)}" ${STROKE}></path>`
  );
}

function textBlock(lines, x, y, anchor) {
  return lines
    .map(
      (l, k) =>
        `<text x="${x.toFixed(1)}" y="${(y + k * 20).toFixed(1)}" ${FONT} text-anchor="${anchor}" style="white-space: pre;" dominant-baseline="text-before-edge">${esc(l)}</text>`,
    )
    .join("");
}

export function renderSketch(src, seed = "x") {
  const spec = parseSpec(src);
  layout(spec);
  const r = rng(seed);
  const out = [];

  for (const e of spec.edges) {
    const A = spec.nodes.get(e.a);
    const B = spec.nodes.get(e.b);
    if (!A || !B) throw new Error(`diagram: unknown node in edge ${e.a} ${e.dir} ${e.b}`);
    const [x1, y1] = boundaryPoint(A, B.cx, B.cy);
    const [x2, y2] = boundaryPoint(B, A.cx, A.cy);
    out.push(`<path d="${wobblyLine(r, x1, y1, x2, y2)}" ${STROKE}></path>`);
    out.push(`<path d="${wobblyLine(r, x1, y1 + 0.8, x2, y2 + 0.8)}" ${STROKE} opacity="0.6"></path>`);
    if (e.dir === "->" || e.dir === "<->") out.push(arrowHead(r, x2, y2, x1, y1));
    if (e.dir === "<-" || e.dir === "<->") out.push(arrowHead(r, x1, y1, x2, y2));
    if (e.label) {
      const lines = e.label.split("|");
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const vertical = Math.abs(x2 - x1) < Math.abs(y2 - y1);
      out.push(textBlock(lines, vertical ? mx + 12 : mx, vertical ? my - lines.length * 10 : my - lines.length * 20 - 6, vertical ? "start" : "middle"));
    }
  }
  for (const n of spec.nodes.values()) {
    out.push(
      n.shape === "circle"
        ? ellipse(r, n.cx, n.cy, n.w / 2, n.h / 2)
        : roundedRect(r, n.cx - n.w / 2, n.cy - n.h / 2, n.w, n.h),
    );
    out.push(textBlock(n.lines, n.cx, n.cy - (n.lines.length * 20) / 2, "middle"));
  }
  for (const n of spec.notes) out.push(textBlock(n.lines, n.x, n.y, "start"));

  // bounds
  const xs = [];
  const ys = [];
  for (const n of spec.nodes.values()) {
    xs.push(n.cx - n.w / 2, n.cx + n.w / 2);
    ys.push(n.cy - n.h / 2, n.cy + n.h / 2);
  }
  for (const n of spec.notes) {
    xs.push(n.x, n.x + n.w);
    ys.push(n.y, n.y + n.h);
  }
  for (const e of spec.edges) {
    if (!e.label) continue;
    const A = spec.nodes.get(e.a);
    const B = spec.nodes.get(e.b);
    ys.push((A.cy + B.cy) / 2 - e.label.split("|").length * 20 - 10);
    xs.push((A.cx + B.cx) / 2 + textWidth(e.label.split("|")) / 2 + 20);
  }
  const pad = 24;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const W = Math.max(...xs) - minX + pad;
  const H = Math.max(...ys) - minY + pad;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}"><defs></defs>` +
    `<rect x="0" y="0" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="#ffffff"></rect>` +
    `<g transform="translate(${(-minX).toFixed(1)} ${(-minY).toFixed(1)})">${out.join("")}</g></svg>`
  );
}
