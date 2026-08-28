// Validates the App Store listing copy before it is pushed.
//
// The character limits are hard rejections, and guideline 2.3.7 rejects price
// references anywhere except the description — a rule previous submissions have
// been caught by, so it is checked here rather than remembered.
import * as M from '../store/metadata.mjs';

const LIMITS = { NAME: 30, SUBTITLE: 30, PROMOTIONAL_TEXT: 170, KEYWORDS: 100, DESCRIPTION: 4000 };

let problems = 0;
for (const [key, max] of Object.entries(LIMITS)) {
  const length = [...M[key]].length;
  if (length > max) problems++;
  console.log(`${length <= max ? 'ok  ' : 'OVER'} ${key.padEnd(18)} ${length} / ${max}`);
}

const PRICE_REF = /\bfree\b|\bprice[ds]?\b|\bsale\b|\bdiscount\b|\bsubscription\b|\$/i;
for (const key of ['NAME', 'SUBTITLE', 'PROMOTIONAL_TEXT', 'KEYWORDS']) {
  const hit = PRICE_REF.test(M[key]);
  if (hit) problems++;
  console.log(`${hit ? 'PRICE REF' : 'clean    '} ${key}`);
}

// Keywords are comma separated with no spaces; a stray space wastes characters.
if (/,\s/.test(M.KEYWORDS)) {
  problems++;
  console.log('SPACES    KEYWORDS contains ", " which wastes the budget');
}

console.log(problems === 0 ? '\nmetadata ok' : `\n${problems} problem(s)`);
process.exit(problems ? 1 : 0);
