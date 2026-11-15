// After the suite: APISIX holds what the seed put there, no more and no less, and every seed object
// as it was (but its update time).
import { Admin } from './admin';

export default async function globalTeardown(): Promise<void> {
  const seeded = process.env.E2E_SEED_COUNTS;
  const objects = process.env.E2E_SEED_OBJECTS;
  if (!seeded || !objects) return;
  const admin = new Admin();
  const expected = JSON.parse(seeded) as Record<string, number>;
  const actual = await admin.counts();
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const diff = keys.filter((k) => expected[k] !== actual[k]).map((k) => `${k}: seeded ${expected[k] ?? 0}, now ${actual[k] ?? 0}`);
  const before = JSON.parse(objects) as Record<string, string>;
  const now = await admin.snapshot();
  for (const key of Object.keys(before).sort()) {
    if (now[key] === undefined) diff.push(`${key}: seeded, now gone`);
    else if (now[key] !== before[key]) diff.push(`${key}: changed since the seed`);
  }
  if (diff.length > 0) {
    throw new Error(`The suite left APISIX different from the seed:\n  ${diff.join('\n  ')}`);
  }
}
