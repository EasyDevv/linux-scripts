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
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Free slots of at least `min` minutes inside [dayStart, dayEnd) not covered by `busy`. */
export function freeSlots(busy: Iv[], dayStart: number, dayEnd: number, min: number): Iv[] {
  const out: Iv[] = [];
  let cur = dayStart;
  for (const [rawS, rawE] of merge(busy)) {
    const s = Math.max(rawS, dayStart);
    const e = Math.min(rawE, dayEnd);
    if (e <= s) continue;
    if (s - cur >= min) out.push([cur, s]);
    if (e > cur) cur = e;
  }
  if (dayEnd - cur >= min) out.push([cur, dayEnd]);
  return out;
}

/** Earliest start t such that [t, t+len) is free for every person; null when none. */
export function firstCommon(people: Iv[][], dayStart: number, dayEnd: number, len: number): number | null {
  if (people.length === 0) return dayStart + len <= dayEnd ? dayStart : null;

  let common: Iv[] = freeSlots(people[0], dayStart, dayEnd, len);
  for (let i = 1; i < people.length && common.length > 0; i++) {
    const free = freeSlots(people[i], dayStart, dayEnd, len);
    const next: Iv[] = [];
    let a = 0;
    let b = 0;
    while (a < common.length && b < free.length) {
      const s = Math.max(common[a][0], free[b][0]);
      const e = Math.min(common[a][1], free[b][1]);
      if (e - s >= len) next.push([s, e]);
      if (common[a][1] < free[b][1]) a++;
      else b++;
    }
    common = next;
  }

  return common.length ? common[0][0] : null;
}
