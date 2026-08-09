// src/web/measure/v2_breakout.js
import { toPercent, pct, slice } from './common.js';

export const meta = {
  id: 'v2', label: '돌파 앵커 (0→+N% 경로)', version: '0.1.0', frozen: false,
};

export const options = {
  threshold: { label: '돌파 기준(%)', type: 'number', def: 5, min: 1, max: 30, step: 1 },
};

const columns = [
  { key: 'elapsed',   label: '돌파소요',   fmt: 'sec'  },
  { key: 'candlesB',  label: '돌파전캔들', fmt: 'int'  },
  { key: 'perMin',    label: '분당체결',   fmt: 'f1'   },
  { key: 'avgUpBody', label: '평균양봉',   fmt: 'f2'   },
  { key: 'pctPerMin', label: '진척%/분',   fmt: 'f2'   },
  { key: 'maxAfter',  label: '돌파후최고', fmt: 'pct2' },
  { key: 'pulled',    label: '되밀림',     fmt: 'bool' },
];

const dim = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
};

export function compute(ctx, opt = {}) {
  const th = opt.threshold ?? options.threshold.def;
  const perSymbol = {}, ranking = [];

  for (const s of ctx.symbols) {
    const raw = slice(s.candles, ctx.start, ctx.end);
    const target = s.dayOpen * (1 + th / 100);
    const bi = raw.findIndex(c => c.close >= target);      // 돌파 캔들 인덱스
    const hit = bi >= 0;
    const before = hit ? raw.slice(0, bi + 1) : raw;
    const after = hit ? raw.slice(bi + 1) : [];

    const elapsed = hit ? raw[bi].time - ctx.start : null;
    const ticksB = before.reduce((a, c) => a + (c.ticks || 0), 0);
    const perMin = elapsed ? ticksB / (elapsed / 60) : null;
    const ups = before.filter(c => c.close > c.open);
    const avgUpBody = ups.length
      ? ups.reduce((a, c) => a + (c.close - c.open) / s.dayOpen * 100, 0) / ups.length : null;
    const pctPerMin = elapsed ? th / (elapsed / 60) : null;
    const maxAfter = after.length
      ? Math.max(...after.map(c => pct(c.high, s.dayOpen))) : (hit ? th : null);
    const minAfter = after.length
      ? Math.min(...after.map(c => pct(c.low, s.dayOpen))) : null;
    const pulled = hit && minAfter != null && minAfter < th * 0.4;

    const buckets = Math.max(1, Math.ceil((ctx.end - ctx.start) / ctx.bucketSec));
    const bars = Array.from({ length: buckets }, (_, b) => {
      const t0 = ctx.start + b * ctx.bucketSec, t1 = t0 + ctx.bucketSec;
      const inB = raw.filter(c => c.time >= t0 && c.time < t1);
      const net = inB.length ? inB.at(-1).close - inB[0].open : 0;
      return { time: t0 + Math.floor(ctx.bucketSec / 2),
               value: inB.reduce((a, c) => a + (c.ticks || 0), 0),
               // TODO: 틱룰 기반 매수/매도 분리로 교체 예정. 지금은 버킷 순방향으로 근사.
               color: net >= 0 ? s.color : dim(s.color, 0.35) };
    });

    perSymbol[s.code] = {
      series: raw.map((c, i) => {
        const p = toPercent(c, s.dayOpen);
        const pre = !hit || i <= bi;
        return pre ? p
          : { ...p, color: dim(s.color, 0.25), borderColor: dim(s.color, 0.25),
                    wickColor: dim(s.color, 0.25) };
      }),
      bars,
      marks: hit ? [{ time: raw[bi].time, price: pct(raw[bi].high, s.dayOpen),
                      text: `+${th}% ${(elapsed / 60).toFixed(1)}분 · ${before.length}캔들`,
                      position: 'aboveBar', color: s.color }] : [],
      vlines: hit ? [{ time: raw[bi].time, color: s.color, label: `${s.name} 돌파` }] : [],
      metrics: { elapsed, candlesB: before.length, ticksB, perMin,
                 avgUpBody, pctPerMin, maxAfter, pulled, hit },
    };

    ranking.push({
      code: s.code, name: s.name,
      score: hit ? perMin * pctPerMin : null,
      reason: hit ? `${(elapsed / 60).toFixed(1)}분 · ${Math.round(perMin)}체결/분 · ${pctPerMin.toFixed(2)}%/분`
                  : `+${th}% 미도달 (최고 ${(Math.max(...raw.map(c => pct(c.high, s.dayOpen)))).toFixed(1)}%)`,
    });
  }

  ranking.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return { ...meta, columns, perSymbol, ranking, opt: { threshold: th } };
}
