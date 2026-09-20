#!/usr/bin/env node
// Gera os ícones do app (favicon) em apps/web/app/, que o Next.js serve sozinho:
//   icon.svg         ícone vetorial (navegadores modernos)
//   favicon.ico      16, 32 e 48 px (navegadores/atalhos antigos)
//   apple-icon.png   180 px (tela inicial do iPhone/iPad, sem cantos arredondados: o iOS arredonda)
// O desenho é o do ícone "canvas" do app: três nós ligados por fios, em branco sobre o azul de destaque.
// Sem dependências: rasteriza as formas (com suavização) e grava PNG/ICO na mão.  Uso: node scripts/make-favicon.mjs
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const out = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "apps", "web", "app");
const BLUE = [0x2f, 0x7d, 0xe1]; // --accent do tema claro
const WHITE = [255, 255, 255];

// ---------------------------------------------------------------- desenho (viewBox 64x64)
const NODES = [
  { x: 9, y: 11, w: 18, h: 13, r: 4 },
  { x: 9, y: 40, w: 18, h: 13, r: 4 },
  { x: 37, y: 25.5, w: 18, h: 13, r: 4 },
];
const WIRES = [
  [[27, 17.5], [33, 17.5], [31, 32], [37, 32]],
  [[27, 46.5], [33, 46.5], [31, 32], [37, 32]],
];
const STROKE = 3.4;
const RADIUS = 14;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${RADIUS}" fill="#2f7de1"/>
  <g fill="#fff">
${NODES.map((n) => `    <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.r}"/>`).join("\n")}
  </g>
  <path d="${WIRES.map((w) => `M${w[0].join(" ")}C${w[1].join(" ")} ${w[2].join(" ")} ${w[3].join(" ")}`).join("")}" fill="none" stroke="#fff" stroke-width="${STROKE}" stroke-linecap="round"/>
</svg>
`;

// ---------------------------------------------------------------- rasterizador
const roundRectDist = (px, py, { x, y, w, h, r }) => {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

// fios: curvas de Bézier cúbicas amostradas em segmentos; a distância ao segmento dá o traço com pontas redondas
const SEGMENTS = WIRES.flatMap((p) => {
  const pts = Array.from({ length: 65 }, (_, i) => {
    const t = i / 64, u = 1 - t;
    return [0, 1].map((k) => u ** 3 * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t ** 3 * p[3][k]);
  });
  return pts.slice(1).map((b, i) => [pts[i], b]);
});
const segDist = (px, py, [[ax, ay], [bx, by]]) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** Pixel RGBA de um ponto do desenho (0..64). `rounded`: fundo com cantos arredondados (false = quadrado inteiro). */
function sample(px, py, rounded) {
  const bg = rounded ? roundRectDist(px, py, { x: 0, y: 0, w: 64, h: 64, r: RADIUS }) <= 0 : px >= 0 && px < 64 && py >= 0 && py < 64;
  if (!bg) return [0, 0, 0, 0];
  const glyph = NODES.some((n) => roundRectDist(px, py, n) <= 0) || SEGMENTS.some((s) => segDist(px, py, s) <= STROKE / 2);
  return [...(glyph ? WHITE : BLUE), 255];
}

/** Imagem size x size com suavização (grade SS x SS por pixel, média com alfa pré-multiplicado). */
function render(size, rounded) {
  const SS = 6, scale = 64 / size;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const [sr, sg, sb, sa] = sample((x + (i + 0.5) / SS) * scale, (y + (j + 0.5) / SS) * scale, rounded);
          r += sr * sa; g += sg * sa; b += sb * sa; a += sa;
        }
      }
      const o = (y * size + x) * 4, n = SS * SS;
      px[o] = a ? Math.round(r / a) : 0;
      px[o + 1] = a ? Math.round(g / a) : 0;
      px[o + 2] = a ? Math.round(b / a) : 0;
      px[o + 3] = Math.round(a / n);
    }
  }
  return px;
}

// ---------------------------------------------------------------- PNG e ICO
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro "nenhum"
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
function ico(sizes) {
  const images = sizes.map((s) => png(s, render(s, true)));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); // tipo: icone
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const dir = images.map((img, i) => {
    const e = Buffer.alloc(16);
    e[0] = sizes[i] % 256; // largura (0 = 256)
    e[1] = sizes[i] % 256;
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(img.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...images]);
}

writeFileSync(join(out, "icon.svg"), svg);
writeFileSync(join(out, "favicon.ico"), ico([16, 32, 48]));
writeFileSync(join(out, "apple-icon.png"), png(180, render(180, false)));
console.log(`✔ ${out}: icon.svg, favicon.ico (16/32/48) e apple-icon.png (180)`);
