// Interval scheduling helpers. Times are minutes since midnight; intervals are half-open [start, end).
export type Iv = [number, number];

/** Merge overlapping intervals. Touching intervals ([1,3) and [3,5)) merge too. Input order is arbitrary. */
export function merge(ivs: Iv[]): Iv[] {
  const sorted = ivs
    .map(([s, e]): Iv => [s, e])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
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
  let cur = dayStart;
  for (const [s, e] of merge(busy)) {
    if (e <= dayStart) continue;
    if (s >= dayEnd) break;
    if (s - cur >= min) out.push([cur, s]);
    if (e > cur) cur = e;
  }
  if (dayEnd - cur >= min) out.push([cur, dayEnd]);
  return out;
}

/** Earliest start t such that [t, t+len) is free for every person; null when none. */
export function firstCommon(people: Iv[][], dayStart: number, dayEnd: number, len: number): number | null {
  const all = people.flat();
  const free = freeSlots(all, dayStart, dayEnd, len);
  return free.length ? free[0][0] : null;
}
