// Seeded generators for the model checks (no dependencies).
//
// Every check runs `forAll(name, gen, property)` with a fixed seed so a
// failure replays exactly. Sizes grow with the run index, so the first
// failing case is usually close to minimal. On failure the message carries
// the seed, the run index and the input as JSON: paste it into a test to
// replay it.
//
// MODEL_SEED=<n> and MODEL_RUNS=<n> override the defaults from the shell.

export const DEFAULT_SEED = Number(process.env.MODEL_SEED ?? 20261029);
export const DEFAULT_RUNS = Number(process.env.MODEL_RUNS ?? 400);

/** mulberry32 — small, fast, good enough for test inputs. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    bool: (p = 0.5) => next() < p,
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return r;
}

/** Fixed-point decimal in [lo, hi] with `places` decimals (contract precision). */
export function decimal(r, lo, hi, places = 4) {
  const scale = 10 ** places;
  return Math.round((lo + r.next() * (hi - lo)) * scale) / scale;
}

export class PropertyFailure extends Error {}

/**
 * Run `property(input, r)` on `runs` generated inputs. `gen(r, size)` builds
 * one input; size goes 0 → maxSize. property throws (assert) or returns
 * false to fail.
 */
export function forAll(name, gen, property, { seed = DEFAULT_SEED, runs = DEFAULT_RUNS, maxSize = 8 } = {}) {
  const r = rng(seed);
  for (let run = 0; run < runs; run += 1) {
    const size = Math.min(maxSize, Math.floor((run * (maxSize + 1)) / runs));
    const input = gen(r, size);
    let ok;
    try {
      ok = property(input, r);
    } catch (error) {
      throw new PropertyFailure(
        `${name} broke on run ${run} (seed ${seed}).\nInput: ${JSON.stringify(input)}\n${error?.message ?? error}`,
      );
    }
    if (ok === false) {
      throw new PropertyFailure(
        `${name} broke on run ${run} (seed ${seed}).\nInput: ${JSON.stringify(input)}`,
      );
    }
  }
  return runs;
}

/** Every list of length 0..maxLen over `alphabet` (exhaustive small domain). */
export function* sequences(alphabet, maxLen) {
  yield [];
  let layer = [[]];
  for (let len = 1; len <= maxLen; len += 1) {
    const nextLayer = [];
    for (const prefix of layer) {
      for (const symbol of alphabet) {
        const seq = [...prefix, symbol];
        nextLayer.push(seq);
        yield seq;
      }
    }
    layer = nextLayer;
  }
}

/** All permutations of a short list. */
export function* permutations(list) {
  if (list.length <= 1) {
    yield [...list];
    return;
  }
  for (let i = 0; i < list.length; i += 1) {
    const rest = [...list.slice(0, i), ...list.slice(i + 1)];
    for (const tail of permutations(rest)) yield [list[i], ...tail];
  }
}

/** Run `property` on every item of an exhaustive domain; report the first failure. */
export function forEvery(name, items, property) {
  let count = 0;
  for (const input of items) {
    let ok;
    try {
      ok = property(input);
    } catch (error) {
      throw new PropertyFailure(`${name} broke.\nInput: ${JSON.stringify(input)}\n${error?.message ?? error}`);
    }
    if (ok === false) throw new PropertyFailure(`${name} broke.\nInput: ${JSON.stringify(input)}`);
    count += 1;
  }
  return count;
}

// ---- Domain generators -------------------------------------------------

export const TIERS = ['federal', 'state', 'county', 'city'];

/**
 * A random jurisdiction forest: 1-3 federal roots, each tier hangs off a
 * random node one tier up. Ids are short and collide-free. Optionally adds
 * an orphan (parent not in the list) to exercise fail-closed reads.
 */
export function genForest(r, size) {
  const rows = [];
  let n = 0;
  const id = (tier) => `${tier[0]}${n++}`;
  const roots = r.int(1, Math.min(3, 1 + Math.floor(size / 3)));
  for (let i = 0; i < roots; i += 1) rows.push({ id: id('federal'), name: 'F', tier: 'federal', parentId: null });
  for (let level = 1; level < TIERS.length; level += 1) {
    const parents = rows.filter((row) => row.tier === TIERS[level - 1]);
    const count = r.int(1, Math.max(1, Math.min(4, size)));
    for (let i = 0; i < count; i += 1) {
      rows.push({ id: id(TIERS[level]), name: 'J', tier: TIERS[level], parentId: r.pick(parents).id });
    }
  }
  return rows;
}

export function triggerFor(id, jurisdictionId, effect = { talentCost: 0.01 }) {
  return {
    id,
    type: 'policy_change',
    label: `Event ${id}`,
    source: 'mock:model',
    timestamp: '2026-01-01T00:00:00.000Z',
    effect,
    jurisdictionId,
  };
}

/** Triggers with unique ids bound to random forest nodes, NULL, '' or an unknown id. */
export function genTriggers(r, forest, size) {
  const count = r.int(0, size + 2);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const roll = r.next();
    const jurisdictionId = roll < 0.75
      ? r.pick(forest).id
      : roll < 0.85 ? null : roll < 0.9 ? '' : 'nowhere';
    out.push(triggerFor(`evt-${r.int(0, 999).toString(36)}-${i}`, jurisdictionId));
  }
  return out;
}
