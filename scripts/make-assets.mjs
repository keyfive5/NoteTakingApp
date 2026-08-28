// Generates the app icon, splash and favicons from vector sources.
//
// The mark: three lines of text with a lens over them, and the line under the
// lens picked out in the accent. It says "find the thing you wrote" at 1024px
// and still reads as a distinct silhouette at 40px on a home screen.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'assets');
fs.mkdirSync(OUT, { recursive: true });

const INK = '#141311';
const AMBER = '#E8A33D';
const CREAM = '#F2EFE8';

/**
 * The mark on a 1024 grid.
 * @param {{bg?: string, line?: string, accent?: string, inset?: number}} o
 */
let markSeq = 0;

function mark({ bg = INK, line = CREAM, accent = AMBER, inset = 0 } = {}) {
  const scale = (1024 - inset * 2) / 1024;
  const t = (v) => (inset + v * scale).toFixed(2);
  const w = (v) => (v * scale).toFixed(2);
  // Ids must be unique per document, or a second embedded copy reuses the first.
  const uid = `m${markSeq++}`;

  const BAR_H = 46;
  const bars = [
    { y: 262, x: 180, len: 470 },
    { y: 360, x: 180, len: 600 },
    { y: 458, x: 180, len: 640 },
    { y: 556, x: 180, len: 400 },
  ];

  // Lens centred on the third line, low and right of the text block.
  const cx = 620;
  const cy = 458 + BAR_H / 2;
  const r = 170;
  const ring = 52;
  // Radius of the gap punched out of the text so the lens reads as being on top
  // rather than tangled in the lines.
  const clear = r + ring / 2 + 26;
  const hx = cx + r * 0.707;
  const hy = cy + r * 0.707;

  const bar = (b, fill, opacity) =>
    `<rect x="${t(b.x)}" y="${t(b.y)}" width="${w(b.len)}" height="${w(BAR_H)}" rx="${w(BAR_H / 2)}" ` +
    `fill="${fill}" opacity="${opacity}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <mask id="${uid}cut">
      <rect width="1024" height="1024" fill="#fff"/>
      <circle cx="${t(cx)}" cy="${t(cy)}" r="${w(clear)}" fill="#000"/>
    </mask>
  </defs>
  ${bg === 'none' ? '' : `<rect width="1024" height="1024" fill="${bg}"/>`}
  <g mask="url(#${uid}cut)">
    ${bars.map((b) => bar(b, line, 0.4)).join('\n    ')}
  </g>
  ${''/* Two short bars inside the lens: magnified text. A single centred bar
        reads as a minus sign, which is the wrong idea entirely. */}
  <rect x="${t(cx - 88)}" y="${t(cy - 54)}" width="${w(176)}" height="${w(34)}" rx="${w(17)}" fill="${accent}"/>
  <rect x="${t(cx - 88)}" y="${t(cy + 8)}" width="${w(114)}" height="${w(34)}" rx="${w(17)}" fill="${accent}"/>
  <circle cx="${t(cx)}" cy="${t(cy)}" r="${w(r)}" fill="none" stroke="${accent}" stroke-width="${w(ring)}"/>
  <line x1="${t(hx)}" y1="${t(hy)}" x2="${t(hx + 104)}" y2="${t(hy + 104)}" stroke="${accent}" stroke-width="${w(ring + 4)}" stroke-linecap="round"/>
</svg>`;
}

/** Splash: the mark, smaller, centred on the app background. */
function splash() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="none"/>
  <g transform="translate(212,212) scale(0.586)">
    ${mark({ bg: 'none', line: '#1E1C18', accent: '#C7791A' }).replace(/<\/?svg[^>]*>/g, '')}
  </g>
</svg>`;
}

async function write(name, svg, size) {
  const file = path.join(OUT, name);
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`  ${name.padEnd(32)} ${size}x${size}  ${kb} KB`);
}

console.log('assets:');
await write('icon.png', mark(), 1024);
await write('favicon.png', mark(), 96);
await write('splash.png', splash(), 1024);
// Android adaptive icon: the foreground is padded so the system mask cannot
// clip the mark, and the background is a flat plate.
await write('android-icon-foreground.png', mark({ bg: 'none', inset: 190 }), 1024);
await write(
  'android-icon-background.png',
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${INK}"/></svg>`,
  1024,
);
await write(
  'android-icon-monochrome.png',
  mark({ bg: 'none', line: '#FFFFFF', accent: '#FFFFFF', inset: 190 }),
  1024,
);
console.log('done');
