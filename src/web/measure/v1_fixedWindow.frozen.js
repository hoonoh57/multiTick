// src/web/measure/v1_fixedWindow.frozen.js
// ─────────────────────────────────────────────────────────────
//  FROZEN 2026-08-09.  이 파일은 수정하지 않는다.
//  변경이 필요하면 v1_1_*.js 로 포크할 것.
//  known-issue: 버킷당 카운트가 슬롯 수(slots)에서 절단됨.  →  의도적 보존.
//               (관측 사례: 120틱/15분/20슬롯에서 100·98·95 로 천장 접촉)
// ─────────────────────────────────────────────────────────────
import { toPercent, pct, slice } from './common.js';

export const meta = {
  id: 'v1', label: '고정 시간창 밀도 (원본)', version: '1.0.0',
  frozen: true, frozenAt: '2026-08-09',
};

const columns = [
  { key: 'candles',  label: '캔들수',    fmt: 'int'  },
  { key: 'ticks',    label: '체결수',    fmt: 'int'  },
  { key: 'perMin',   label: '분당체결',  fmt: 'f1'   },
  { key: 'lastPct',  label: '구간종가',  fmt: 'pct2' },
  { key: 'maxPct',   label: '구간최고',  fmt: 'pct2' },
  { key: 'overflow', label: '절단',      fmt: 'bool' },
];

function makeAxis({ start, end, bucketSec, slots }) {
  const span = end - start;
  const buckets = Math.max(1, Math.ceil(span / bucketSec));
  const slotSec = Math.max(1, Math.round(bucketSec / slots));
  return { start, end, span, bucketSec, slots, buckets, slotSec,
           totalSlots: buckets * slots };
}

/** 캔들을 슬롯에 스냅. 충돌 시 다음 빈 칸, 버킷 초과분은 마지막 칸에 OHLC 병합. */
function placeIntoSlots(candles, axis) {
  const occ = new Map();                 // slotIdx -> candle
  const counts = new Array(axis.buckets).fill(0);
  const of = new Array(axis.buckets).fill(false);

  for (const c of candles) {
    const rel = c.time - axis.start;
    if (rel < 0 || rel >= axis.span) continue;
    const b = Math.min(axis.buckets - 1, Math.floor(rel / axis.bucketSec));
    const last = b * axis.slots + axis.slots - 1;

    let s = Math.floor(rel / axis.slotSec);
    if (s < b * axis.slots) s = b * axis.slots;
    while (s <= last && occ.has(s)) s++;

    if (s > last) {                      // ── 절단 지점 ──
      const m = occ.get(last);
      m.high = Math.max(m.high, c.high);
      m.low = Math.min(m.low, c.low);
      m.close = c.close;
      m.volume += c.volume || 0;
      m.ticks += c.ticks || 0;
      m.merged = (m.merged || 1) + 1;
      of[b] = true;
    } else {
      occ.set(s, { ...c, time: axis.start + s * axis.slotSec });
      counts[b]++;                       // 슬롯 배치분만 계수 → 상한 = slots
    }
  }
  return { placed: [...occ.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]),
           counts, overflow: of, axis };
}

export function compute(ctx) {
  const perSymbol = {}, ranking = [];

  for (const s of ctx.symbols) {
    const raw = slice(s.candles, ctx.start, ctx.end);
    const axis = makeAxis(ctx);
    const { placed, counts, overflow } = placeIntoSlots(raw, axis);

    const candles = counts.reduce((a, b) => a + b, 0);
    const ticks = placed.reduce((a, c) => a + (c.ticks || 0), 0);
    const mins = (ctx.end - ctx.start) / 60;
    const lastPct = placed.length ? pct(placed.at(-1).close, s.dayOpen) : null;
    const maxPct = raw.length ? Math.max(...raw.map(c => pct(c.high, s.dayOpen))) : null;

    perSymbol[s.code] = {
      series: placed.map(c => toPercent(c, s.dayOpen)),
      bars: counts.map((n, b) => ({
        time: axis.start + b * axis.bucketSec + Math.floor(axis.bucketSec / 2),
        value: n, color: s.color,
      })),
      marks: counts.map((n, b) => {
        const inB = placed.filter(c =>
          c.time >= axis.start + b * axis.bucketSec &&
          c.time <  axis.start + (b + 1) * axis.bucketSec);
        if (!inB.length) return null;
        const tail = inB.at(-1);
        return { time: tail.time, price: pct(tail.high, s.dayOpen),
                 text: String(n) + (overflow[b] ? '▲' : ''),
                 position: 'aboveBar', color: s.color };
      }).filter(Boolean),
      vlines: Array.from({ length: axis.buckets + 1 },
                        (_, i) => ({ time: axis.start + i * axis.bucketSec,
                                     color: 'rgba(255,255,255,0.18)' })),
      metrics: {
        candles, ticks, perMin: ticks / mins, lastPct, maxPct,
        overflow: overflow.some(Boolean),
        rawCandles: raw.length,     // 진단용. score·그리기에 미사용.
      },
    };
    ranking.push({ code: s.code, name: s.name, score: candles,
                   reason: `${candles}캔들 / ${Math.round(ticks).toLocaleString()}체결` });
  }

  ranking.sort((a, b) => b.score - a.score);
  return { ...meta, columns, perSymbol, ranking };
}
