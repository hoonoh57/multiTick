// src/web/measure/types.js
/**
 * ctx = {
 *   baseDate, baseTime, start, end,        // 분석 창 (epoch sec)
 *   tickMul, tickSize, bucketSec, slots,
 *   symbols: [{ code, name, color, dayOpen, candles }]
 * }
 *
 * 반환 = {
 *   id, label, version, frozen, columns,
 *   perSymbol: { [code]: { series, bars, marks, vlines, metrics } },
 *   ranking: [{ code, name, score, reason }]   // score=null 이면 대상 제외
 * }
 */
const hhmmOf = v => {
  const s = ((v % 86400) + 86400) % 86400;
  return String(Math.floor(s / 3600)).padStart(2, '0') + ':' +
         String(Math.floor((s % 3600) / 60)).padStart(2, '0');
};

export const FMT = {
  int:  v => v == null ? '-' : Math.round(v).toLocaleString(),
  f1:   v => v == null ? '-' : v.toFixed(1),
  f2:   v => v == null ? '-' : v.toFixed(2),
  pct2: v => v == null ? '-' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%',
  sec:  v => v == null ? '-' : (v / 60).toFixed(1) + '분',
  bool: v => v ? '●' : '',
  hm:   v => v == null ? '-' : hhmmOf(v),
  raw: v => (v == null ? '-' : String(v)),
  pc:   v => v == null ? '-' : (v * 100).toFixed(1) + '%',
};
