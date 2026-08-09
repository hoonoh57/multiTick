// src/web/measure/v3_gateDensity.js
import { toPercent, pct, slice } from './common.js';

export const meta = {
  id: 'v3', label: '돌파 게이트 + 동일시각 밀도', version: '0.1.0', frozen: false,
};

export const options = {
  threshold: { label: '돌파 기준(%)', def: 5 },
  preMin:    { label: '돌파 직전 관찰(분)', def: 5 },
};

const columns = [
  { key: 'breakAt',  label: '돌파시각',    fmt: 'hm'   },
  { key: 'preDens',  label: '직전체결/분', fmt: 'f1'   },
  { key: 'preRatio', label: '급증배율',    fmt: 'f2'   },
  { key: 'share',    label: '시각점유율',  fmt: 'pc'   },
  { key: 'preCand',  label: '직전캔들',    fmt: 'int'  },
  { key: 'maxAfter', label: '돌파후최고',  fmt: 'pct2' },
  { key: 'holdMin',  label: '5%유지(분)',  fmt: 'f1'   },
  { key: 'endPct',   label: '종료시점',    fmt: 'pct2' },
];

export function compute(ctx, opt = {}) {
  const th     = opt.threshold ?? options.threshold.def;
  const preMin = opt.preMin ?? options.preMin.def;
  const preSec = preMin * 60;

  const perSymbol = {}, ranking = [], tmp = [];

  // 동일 시각 버킷별 총 체결 (점유율 분모)
  const nB = Math.max(1, Math.ceil((ctx.end - ctx.start) / ctx.bucketSec));
  const bIdx = t => Math.min(nB - 1, Math.max(0, Math.floor((t - ctx.start) / ctx.bucketSec)));
  const totalPerBucket = new Array(nB).fill(0);
  for (const s of ctx.symbols)
    for (const c of slice(s.candles, ctx.start, ctx.end))
      totalPerBucket[bIdx(c.time)] += c.ticks || 0;

  for (const s of ctx.symbols) {
    const raw = slice(s.candles, ctx.start, ctx.end);
    const P = raw.map(c => ({ ...c, p: pct(c.close, s.dayOpen) }));

    // ── 게이트: 종가가 +th% 를 처음 넘는 캔들
    const bi = P.findIndex(c => c.p >= th);
    const hit = bi >= 0;
    const tB = hit ? P[bi].time : null;

    // ── 예측변수 (돌파 이전 정보만 사용)
    const pre = hit ? P.filter(c => c.time > tB - preSec && c.time <= tB) : [];
    const preTicks = pre.reduce((a, c) => a + (c.ticks || 0), 0);
    const preDens = hit ? preTicks / preMin : null;

    const allTicks = P.reduce((a, c) => a + (c.ticks || 0), 0);
    const allMin = Math.max(1, (ctx.end - ctx.start) / 60);
    const baseDens = allTicks / allMin;
    const preRatio = hit && baseDens > 0 ? preDens / baseDens : null;

    const bTot = hit ? totalPerBucket[bIdx(tB)] : 0;
    const myBkt = hit
      ? P.filter(c => bIdx(c.time) === bIdx(tB)).reduce((a, c) => a + (c.ticks || 0), 0) : 0;
    const share = bTot > 0 ? myBkt / bTot : null;

    // ── 정답지 (표시 전용, 순위에 미반영)
    const after = hit ? P.slice(bi + 1) : [];
    const maxAfter = hit
      ? Math.max(th, ...after.map(c => pct(c.high, s.dayOpen))) : null;
    let hold = 0;
    if (hit) for (let i = bi + 1; i < P.length; i++)
      if (P[i].p >= th) hold += P[i].time - P[i - 1].time;
    const endPct = P.length ? P.at(-1).p : null;

    // ── 동일 시각 버킷 밀도 막대
    const bars = Array.from({ length: nB }, (_, b) => {
      const inB = P.filter(c => bIdx(c.time) === b);
      const rising = inB.length > 0 && inB.at(-1).close >= inB[0].open;
      return {
        time: ctx.start + b * ctx.bucketSec + (ctx.bucketSec >> 1),
        value: inB.length,
        color: rising ? s.color : s.color + '55',
      };
    });

    perSymbol[s.code] = {
      series: raw.map(c => toPercent(c, s.dayOpen)),   // 원본 시각, 슬롯 스냅 없음
      bars,
      marks: hit ? [{
        time: tB, price: P[bi].p, position: 'belowBar', color: s.color, shape: 'arrowUp',
        text: `▲${th}% ${Math.round(preDens)}/분 ×${preRatio ? preRatio.toFixed(1) : '-'}`,
      }] : [],
      vlines: hit ? [{ time: tB, color: s.color, label: s.name }] : [],
      metrics: {
        hit, breakAt: tB, preDens, preRatio, share, preCand: pre.length,
        maxAfter, holdMin: hit ? hold / 60 : null, endPct,
      },
    };
    tmp.push({ s, hit, preRatio, preDens, th });
  }

  for (const { s, hit, preRatio, preDens } of tmp)
    ranking.push({
      code: s.code, name: s.name,
      score: hit ? preRatio : null,
      reason: hit
        ? `직전 ${Math.round(preDens)}체결/분 · 평소의 ${preRatio.toFixed(2)}배`
        : `+${th}% 미도달 — 대상 제외`,
    });
  ranking.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

  return { ...meta, columns, perSymbol, ranking, opt: { threshold: th, preMin } };
}
