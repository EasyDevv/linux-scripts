// Interval scheduling helpers. Times are minutes since midnight; intervals are half-open [start, end).
export type Iv = [number, number];

/** Merge overlapping intervals. Touching intervals ([1,3) and [3,5)) merge too. Input order is arbitrary. */
export function merge(ivs: Iv[]): Iv[] {
  const sorted = ivs.map(([s, e]): Iv => [s, e]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Iv[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) {
      if (e > last[1]) last[1] = e;
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

/** Free slots of at least `min` minutes inside [dayStart, dayEnd) not covered by `busy`. */
export function freeSlots(busy: Iv[], dayStart: number, dayEnd: number, min: number): Iv[] {
  const out: Iv[] = [];
  const clipped = busy
    .map(([s, e]): Iv => [Math.max(s, dayStart), Math.min(e, dayEnd)])
    .filter(([s, e]) => e > s);
  let cur = dayStart;
  for (const [s, e] of merge(clipped)) {
    if (s - cur >= min) out.push([cur, s]);
    if (e > cur) cur = e;
  }
  if (dayEnd - cur >= min) out.push([cur, dayEnd]);
  return out;
}

function intersect(a: Iv[], b: Iv[]): Iv[] {
  const out: Iv[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]);
    const e = Math.min(a[i][1], b[j][1]);
    if (e > s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/** Earliest start t such that [t, t+len) is free for every person; null when none. */
export function firstCommon(people: Iv[][], dayStart: number, dayEnd: number, len: number): number | null {
  let common: Iv[] = [[dayStart, dayEnd]];
  for (const busy of people) {
    common = intersect(common, freeSlots(busy, dayStart, dayEnd, 0));
    if (common.length === 0) return null;
  }
  for (const [s, e] of common) {
    if (e - s >= len) return s;
  }
  return null;
}
