// Interval scheduling helpers. Times are minutes since midnight; intervals are half-open [start, end).
export type Iv = [number, number];

/** Merge overlapping intervals. Touching intervals ([1,3) and [3,5)) merge too. Input order is arbitrary. */
export function merge(ivs: Iv[]): Iv[] {
  const sorted = ivs.map(([s, e]): Iv => (s <= e ? [s, e] : [e, s])).sort((a, b) => a[0] - b[0]);
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
  for (const [s, e] of merge(busy)) {
    if (e <= cur) continue;
    if (s > cur && s - cur >= min) out.push([cur, Math.min(s, dayEnd)]);
    cur = Math.max(cur, e);
    if (cur >= dayEnd) break;
  }
  if (dayEnd - cur >= min) out.push([cur, dayEnd]);
  return out;
}

/** Earliest start t such that [t, t+len) is free for every person; null when none. */
export function firstCommon(people: Iv[][], dayStart: number, dayEnd: number, len: number): number | null {
  let common: Iv[] = [[dayStart, dayEnd]];
  for (const busy of people) {
    const free = freeSlots(busy, dayStart, dayEnd, 0);
    const next: Iv[] = [];
    for (const [as, ae] of common) {
      for (const [bs, be] of free) {
        const s = Math.max(as, bs);
        const e = Math.min(ae, be);
        if (e >= s) next.push([s, e]);
      }
    }
    common = next;
  }
  for (const [s, e] of common) {
    if (e - s >= len) return s;
  }
  return null;
}
