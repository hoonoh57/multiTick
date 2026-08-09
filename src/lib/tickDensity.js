// src/lib/tickDensity.js

/** 체결시각 'HHMMSS' + 'YYYYMMDD' → 벽시계를 그대로 쓰는 epoch(sec). KST 라벨이 그대로 나온다. */
export function wallClockToTime(yyyymmdd, hhmmss) {
  const s = String(yyyymmdd);
  const t = String(hhmmss).padStart(6, '0');
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
                  +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)) / 1000;
}

function mergeOHLC(arr) {
  let high = -Infinity, low = Infinity, vol = 0, n = 0;
  for (const c of arr) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    vol += c.volume ?? 0;
    n += c._n ?? 1;
  }
  return {
    time: arr[0].time, open: arr[0].open, high, low,
    close: arr[arr.length - 1].close, volume: vol, _n: n,
  };
}

/** 30틱 원본 → mul배 조립 (무손실). 마지막 미완성 묶음은 partial 플래그. */
export function assembleTicks(base, mul) {
  if (!mul || mul <= 1) return base.map(c => ({ ...c, _n: 1 }));
  const out = [];
  for (let i = 0; i < base.length; i += mul) {
    const chunk = base.slice(i, i + mul);
    const m = mergeOHLC(chunk.map(c => ({ ...c, _n: 1 })));
    m.time = chunk[chunk.length - 1].time;   // 봉 종료 시각 기준으로 고정
    m._n = chunk.length;
    m.partial = chunk.length < mul;
    out.push(m);
  }
  return out;
}

/** 버킷/슬롯 축. slotSec = bucketSec / slots 가 정수가 되도록 slots를 고른다. */
export function makeAxis({ sessionStart, sessionEnd, bucketSec, slots }) {
  const slotSec = Math.max(1, Math.round(bucketSec / slots));
  const realSlots = Math.max(1, Math.round(bucketSec / slotSec));
  const buckets = Math.max(1, Math.ceil((sessionEnd - sessionStart) / bucketSec));
  return {
    sessionStart, sessionEnd, bucketSec, slots: realSlots, slotSec, buckets,
    slotTime: (b, s) => sessionStart + b * bucketSec + s * slotSec,
    bucketStart: b => sessionStart + b * bucketSec,
    bucketOf: t => Math.floor((t - sessionStart) / bucketSec),
  };
}

/** 모든 슬롯을 whitespace로 깔아 축 폭을 종목 수와 무관하게 고정 */
export function gridWhitespace(axis) {
  const out = [];
  for (let b = 0; b < axis.buckets; b++)
    for (let s = 0; s < axis.slots; s++)
      out.push({ time: axis.slotTime(b, s) });
  return out;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 캔들을 버킷 내 실제 체결시각 위치의 슬롯으로 스냅.
 * 충돌 시 다음 빈 슬롯으로 밀고, 슬롯이 다 차면 마지막 칸에 OHLC 병합.
 * 반환 counts[].count 가 "그 구간의 실제 발생 개수".
 */
export function placeIntoSlots(candles, axis) {
  const byBucket = new Map();
  for (const c of candles) {
    const b = axis.bucketOf(c.time);
    if (b < 0 || b >= axis.buckets) continue;
    if (!byBucket.has(b)) byBucket.set(b, []);
    byBucket.get(b).push(c);
  }

  const placed = [], counts = [];
  for (const b of [...byBucket.keys()].sort((a, z) => a - z)) {
    const list = byBucket.get(b).sort((a, z) => a.time - z.time);
    const bStart = axis.bucketStart(b);
    const lastSlotTime = axis.slotTime(b, axis.slots - 1);

    let prev = -1, i = 0, firstTime = null;
    for (; i < list.length; i++) {
      const want = clamp(Math.floor((list[i].time - bStart) / axis.slotSec), 0, axis.slots - 1);
      const slot = Math.max(want, prev + 1);
      if (slot > axis.slots - 1) break;
      const t = axis.slotTime(b, slot);
      if (firstTime === null) firstTime = t;
      placed.push({ ...list[i], time: t, srcTime: list[i].time, _n: list[i]._n ?? 1 });
      prev = slot;
    }

    let overflow = 0;
    if (i < list.length) {
      const rest = list.slice(i);
      overflow = rest.length;
      const tail = placed[placed.length - 1];
      if (tail && tail.time === lastSlotTime) {
        placed[placed.length - 1] = { ...mergeOHLC([tail, ...rest]), time: lastSlotTime, merged: true };
      } else {
        const m = mergeOHLC(rest);
        placed.push({ ...m, time: lastSlotTime, merged: true });
        if (firstTime === null) firstTime = lastSlotTime;
      }
    }

    counts.push({
      bucket: b,
      bucketTime: bStart,
      labelTime: firstTime ?? axis.slotTime(b, 0),
      count: list.length,
      drawn: Math.min(list.length, axis.slots),
      overflow,
    });
  }
  return { placed, counts };
}

/** 당일 시가 대비 % 로 정규화 */
export function toPercent(candles, dayOpen) {
  const f = v => (v / dayOpen - 1) * 100;
  return candles.map(c => ({ ...c, open: f(c.open), high: f(c.high), low: f(c.low), close: f(c.close) }));
}

/**
 * 가격 구간(시가 대비 %)별 밀도 통계.
 * bands 예: [0, 5, 10, 20, 30] → 0~5 / 5~10 / 10~20 / 20~30 / 30+
 */
export function bandStats(candles, dayOpen, tickSize, bands = [0, 5, 10, 20, 30]) {
  const edges = [...bands, Infinity];
  const acc = edges.slice(0, -1).map((lo, i) => ({
    lo, hi: edges[i + 1], candles: 0, ticks: 0, volume: 0, firstT: null, lastT: null,
  }));
  for (const c of candles) {
    const pct = (c.close / dayOpen - 1) * 100;
    const k = acc.findIndex(a => pct >= a.lo && pct < a.hi);
    if (k < 0) continue;
    const a = acc[k];
    a.candles += c._n ?? 1;
    a.ticks += (c._n ?? 1) * tickSize;
    a.volume += c.volume ?? 0;
    if (a.firstT === null) a.firstT = c.srcTime ?? c.time;
    a.lastT = c.srcTime ?? c.time;
  }
  return acc.map(a => ({
    ...a,
    dwellSec: a.firstT === null ? 0 : a.lastT - a.firstT,
    ticksPerMin: a.firstT === null || a.lastT === a.firstT
      ? null : a.ticks / ((a.lastT - a.firstT) / 60),
  }));
}
