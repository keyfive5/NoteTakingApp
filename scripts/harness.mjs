// Tiny zero-dependency assertion harness shared by the test scripts.
let passed = 0;
const failures = [];
let group = '';

/**
 * Group assertions under a label. Accepts an async body, in which case the
 * caller must await it so the group label and the final report stay in step.
 */
export function describe(name, fn) {
  group = name;
  const result = fn();
  if (result && typeof result.then === 'function') {
    return result.then(() => {
      group = '';
    });
  }
  group = '';
  return undefined;
}

export function ok(cond, label) {
  if (cond) passed++;
  else failures.push(`${group ? group + ' :: ' : ''}${label}`);
}

export function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`${group ? group + ' :: ' : ''}${label}\n     expected ${e}\n     actual   ${a}`);
}

export function report(title) {
  const total = passed + failures.length;
  if (failures.length) {
    console.log(`\n${title}: ${passed}/${total} passed, ${failures.length} FAILED\n`);
    for (const f of failures) console.log('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`${title}: ${passed}/${total} passed`);
}
