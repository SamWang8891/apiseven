// After the suite: APISIX holds what the seed put there, no more and no less.
import { Admin } from './admin';

export default async function globalTeardown(): Promise<void> {
  const seeded = process.env.E2E_SEED_COUNTS;
  if (!seeded) return;
  const expected = JSON.parse(seeded) as Record<string, number>;
  const actual = await new Admin().counts();
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const diff = keys.filter((k) => expected[k] !== actual[k]).map((k) => `${k}: seeded ${expected[k] ?? 0}, now ${actual[k] ?? 0}`);
  if (diff.length > 0) {
    throw new Error(`The suite left APISIX different from the seed:\n  ${diff.join('\n  ')}`);
  }
}
