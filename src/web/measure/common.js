// src/web/measure/common.js
export const KST = 9 * 3600;

/** YYYYMMDD + HHMMSS(KST) -> chart epoch seconds */
export function wall(ymd, hms) {
  const y = +ymd.slice(0, 4), m = +ymd.slice(4, 6), d = +ymd.slice(6, 8);
  const H = +hms.slice(0, 2), M = +hms.slice(2, 4), S = +hms.slice(4, 6) || 0;
  return Date.UTC(y, m - 1, d, H, M, S) / 1000;
}

/** epoch -> 'HH:MM' (KST). Date 객체를 쓰지 않아 로컬 오프셋 중복 적용을 피한다. */
export function hhmm(t) {
  const s = ((t % 86400) + 86400) % 86400;
  return String(Math.floor(s / 3600)).padStart(2, '0') + ':' +
         String(Math.floor((s % 3600) / 60)).padStart(2, '0');
}

/** 30틱 원본 -> mul 배 조립. 마지막 묶음은 partial 표시. */
export function assemble(base, mul, baseScope = 30) {
  if (mul <= 1) return base.map(c => ({ ...c, ticks: baseScope }));
  const out = [];
  for (let i = 0; i < base.length; i += mul) {
    const g = base.slice(i, i + mul);
    out.push({
      time: g[0].time,
      open: g[0].open,
      high: Math.max(...g.map(c => c.high)),
      low: Math.min(...g.map(c => c.low)),
      close: g[g.length - 1].close,
      volume: g.reduce((a, c) => a + (c.volume || 0), 0),
      ticks: g.length * baseScope,
      partial: g.length < mul,
    });
  }
  return out;
}

export const pct = (p, open) => ((p - open) / open) * 100;

export function toPercent(c, open) {
  return {
    ...c,
    open: pct(c.open, open), high: pct(c.high, open),
    low: pct(c.low, open),   close: pct(c.close, open),
  };
}

export function slice(candles, start, end) {
  return candles.filter(c => c.time >= start && c.time < end);
}
