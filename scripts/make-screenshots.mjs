/**
 * Captures App Store screenshots from the running web build.
 *
 *   1. start the dev server:  npx expo start --web --port 8097
 *   2. node scripts/make-screenshots.mjs
 *
 * Every shot is the real app in a real state — the library is seeded into
 * localStorage and then driven with actual clicks and typing, rather than
 * mocked up. The typo shot in particular has to be genuine: it is the whole
 * claim of the app.
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:8097';
const OUT = 'store/screenshots';

// Apple asks for a 6.9 inch and a 6.5 inch iPhone.
const DEVICES = [
  { name: '6.9', width: 1320, height: 2868, css: [440, 956] },
  { name: '6.5', width: 1242, height: 2688, css: [414, 896] },
];

const BG = '#141311';
const INK = '#F2EFE8';
const DIM = '#A69E90';
const SUB = 'Sift — local-first notes. No account, no subscription.';

const DAY = 864e5;

/** A demo library that makes the search claims visible. */
const DEMO = [
  ['# Meeting notes — Q3 planning\n\nRoadmap review with Priya and Sam. #work/planning\n\n- [x] Book the room\n- [ ] Send the deck\n- [ ] Follow up on hiring\n\nWe agreed to revisit [[Budget 2026]] before anything ships.', 0.05],
  ['# Budget 2026\n\nAnnual budget. Rent is the largest line by far. #work/finance\n\nGroceries average $520 a month, up 8% on last year.', 9],
  ['# Grocery list\n\nmilk, eggs, sourdough, olive oil, and a lightbulb for the hallway #home', 0.3],
  ['# Architecture decisions\n\nWe chose a **local-first** architecture: files on device, no server.\n\nSee [[Meeting notes — Q3 planning]] and [[Budget 2026]]. #work/eng', 3],
  ['# Sourdough starter\n\nFeed every morning, discard half. Ready when it doubles in 4 hours.\n\n#home/kitchen #recipes', 5],
  ['# Team offsite\n\nBanff, second week of October. Links to [[Meeting notes — Q3 planning]]. #work', 7],
  ['# Reading list\n\nPiranesi, The Dispossessed, Mrs Dalloway. #reading', 14],
  ['# Kyoto trip\n\nFushimi Inari at sunrise, Nishiki market, the philosopher\u2019s path. #travel', 30],
  ['# Running plan\n\nFour times a week. Long run Sunday, easy pace. #health', 2],
  ['# getUserId refactor\n\nThe getUserId helper should take a session, not a raw token. #work/eng', 4],
];

const seed = `(() => {
  const now = Date.now();
  const demo = ${JSON.stringify(DEMO)};
  const files = {};
  demo.forEach(([body, age], i) => {
    const id = 'demo' + i;
    const t = now - age * ${DAY};
    const title = body.split('\\n')[0].replace(/^#+\\s*/, '');
    files['/sift/notes/' + id + '.md'] =
      ['---','id: '+id,'title: '+title,'created: '+t,'updated: '+t,'rev: 3',
       'pinned: '+(i===0),'archived: false','locked: false','trashed: ','---',''].join('\\n') + body;

    // Version logs, written the way the app writes them. The history shot has
    // to show real revisions — a screenshot captioned "every version kept"
    // sitting on an empty state would be worse than no screenshot at all.
    const paras = body.split('\\n\\n');
    const revisions = [];
    for (let r = 1; r <= 3; r++) {
      revisions.push(JSON.stringify({
        rev: r,
        at: t - (3 - r) * ${DAY} * 0.6,
        title,
        body: paras.slice(0, Math.max(1, paras.length - (3 - r))).join('\\n\\n'),
      }));
    }
    files['/sift/versions/' + id + '.jsonl'] = revisions.join('\\n') + '\\n';
  });
  files['/sift/settings.json'] = JSON.stringify({ theme: 'dark', accent: 'Amber', fontScale: 1 });
  localStorage.setItem('sift.fs.v1', JSON.stringify(files));
})()`;

const SHOTS = [
  {
    id: '1',
    headline: 'Find the note you\nonly half remember',
    async run(page) {
      await type(page, 'input[aria-label="Search notes"]', 'meting notes');
    },
  },
  {
    id: '2',
    headline: 'Typos, plurals and\ncompound words. Handled.',
    async run(page) {
      await type(page, 'input[aria-label="Search notes"]', 'light bulb');
    },
  },
  {
    id: '3',
    headline: 'Markdown that reads\nlike a finished page',
    async run(page) {
      await clickLabelStartingWith(page, 'Meeting notes');
    },
  },
  {
    id: '4',
    headline: 'Notes that know\nabout each other',
    async run(page) {
      await click(page, '[aria-label="Connections"]');
    },
  },
  {
    id: '5',
    headline: 'Every version kept.\nNothing ever lost.',
    async run(page) {
      await clickLabelStartingWith(page, 'Architecture decisions');
      await click(page, '[aria-label="Version history"]');
    },
  },
];

async function settle(page, ms = 550) {
  await new Promise((r) => setTimeout(r, ms));
}

async function click(page, selector) {
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.click(selector);
  await settle(page);
}

async function type(page, selector, text) {
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.click(selector);
  await page.type(selector, text, { delay: 18 });
  await settle(page, 700);
  // Drop the caret so the shot is not captured mid-blink.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await settle(page, 250);
}

/** Note rows are buttons whose accessible name starts with the note title. */
async function clickLabelStartingWith(page, prefix) {
  await page.waitForSelector('[role="button"]', { timeout: 15000 });
  const handle = await page.evaluateHandle((p) => {
    const els = [...document.querySelectorAll('[role="button"],[aria-label]')];
    return els.find((e) => (e.getAttribute('aria-label') ?? '').startsWith(p)) ?? null;
  }, prefix);
  const el = handle.asElement();
  if (!el) throw new Error(`no element labelled "${prefix}"`);
  await el.click();
  await settle(page, 800);
}

function captionSvg(width, headline) {
  const lines = headline.split('\n');
  const size = Math.round(width * 0.062);
  const lead = Math.round(size * 1.2);
  const top = Math.round(width * 0.16);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const font = 'Helvetica Neue, Helvetica, Arial, sans-serif';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round(width * 0.62)}">
    <rect width="100%" height="100%" fill="${BG}"/>
    ${lines
      .map(
        (l, i) =>
          `<text x="50%" y="${top + i * lead}" text-anchor="middle" fill="${INK}" font-family="${font}" font-size="${size}" font-weight="700" letter-spacing="-1.4">${esc(l)}</text>`,
      )
      .join('')}
    <text x="50%" y="${top + lines.length * lead + Math.round(size * 0.5)}" text-anchor="middle" fill="${DIM}" font-family="${font}" font-size="${Math.round(size * 0.4)}" font-weight="500">${esc(SUB)}</text>
  </svg>`;
}

function chromePath() {
  return (
    process.env.CHROME_PATH ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  );
}

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: 'new',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});

try {
  for (const device of DEVICES) {
    const page = await browser.newPage();
    await page.setViewport({
      width: device.css[0],
      height: device.css[1],
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });

    for (const shot of SHOTS) {
      // Reseed before every shot so each one starts from the same library.
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.evaluate(seed);
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      await page.evaluate(() => {
        // Chrome paints a focus ring iOS never draws.
        const style = document.createElement('style');
        style.textContent = '*{outline:none !important;caret-color:transparent !important;}';
        document.head.appendChild(style);
      });
      await settle(page, 900);
      await shot.run(page);

      const appShot = await page.screenshot({ type: 'png' });

      const capHeight = Math.round(device.height * 0.19);
      const caption = await sharp(Buffer.from(captionSvg(device.width, shot.headline)))
        .resize(device.width, capHeight, { fit: 'cover', position: 'top' })
        .png()
        .toBuffer();

      // Size the phone screen so the whole thing fits under the caption. Picking
      // a width by eye overflowed the canvas and cropped the compose button off
      // the bottom of every shot.
      const margin = Math.round(device.height * 0.02);
      const maxByHeight = Math.floor(((device.height - capHeight - margin) * device.css[0]) / device.css[1]);
      const screenWidth = Math.min(Math.round(device.width * 0.86), maxByHeight);
      const screen = await sharp(appShot).resize({ width: screenWidth }).png().toBuffer();
      const meta = await sharp(screen).metadata();
      const rounded = await sharp(screen)
        .composite([
          {
            input: Buffer.from(
              `<svg width="${meta.width}" height="${meta.height}"><rect width="${meta.width}" height="${meta.height}" rx="${Math.round(meta.width * 0.075)}" fill="#fff"/></svg>`,
            ),
            blend: 'dest-in',
          },
        ])
        .png()
        .toBuffer();

      const file = `${OUT}/${device.name}-${shot.id}.png`;
      await sharp({
        create: { width: device.width, height: device.height, channels: 4, background: BG },
      })
        .composite([
          { input: caption, top: 0, left: 0 },
          { input: rounded, top: capHeight, left: Math.round((device.width - screenWidth) / 2) },
        ])
        .flatten({ background: BG })
        .png()
        .toFile(file);
      console.log(`wrote ${file}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
