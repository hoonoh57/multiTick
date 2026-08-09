// v4 · 돌파 이벤트 단위 (전 구간 합산 없음, 모든 분모는 지역 창)
const P = (v, o) => (v / o - 1) * 100;
const den = (arr, sec) => (sec > 0 ? arr.length / (sec / 60) : 0);

export const meta = { id: 'v4', label: 'v4 · 돌파 이벤트 (진성/먹튀)', version: '1.0.0', frozen: false };

export const options = {
  threshold: 5,   // 돌파 기준 (시가 대비 %)
  hyst: 1.5,      // 재무장 폭 (th-hyst 아래로 내려와야 다음 이벤트)
  baseMin: 10,    // 지역 기준창 (pre 바로 앞)
  preMin: 3,      // 돌파 직전창
  judgeMin: 10,   // 판정창
  goodPct: 3,     // 진성: 돌파가 대비 MFE
  badPct: -1.5,   // 먹튀: 돌파가 대비 MAE
};

export const columns = [
  { key: 'gateHm',  label: '돌파',     fmt: 'hm'   },
  { key: 'label',   label: '판정',     fmt: 'raw'  },
  { key: 'preX',    label: '급증배수', fmt: 'f2'   },
  { key: 'baseDen', label: '기준/분',  fmt: 'f2'   },
  { key: 'preDen',  label: '직전/분',  fmt: 'f2'   },
  { key: 'upShare', label: '양봉비',   fmt: 'f2'   },
  { key: 'effi',    label: '%p/봉',    fmt: 'f2'   },
  { key: 'mfe',     label: 'MFE',      fmt: 'pct2' },
  { key: 'mae',     label: 'MAE',      fmt: 'pct2' },
  { key: 'holdMin', label: '유지(분)', fmt: 'f1'   },
];

export function compute(ctx, opt = {}) {
  const o2 = { ...options, ...opt };
  const th = o2.threshold, hy = o2.hyst;
  const baseSec = o2.baseMin * 60, preSec = o2.preMin * 60, judSec = o2.judgeMin * 60;

  const perSymbol = {}, events = [], ranking = [];

  for (const s of ctx.symbols) {
    const cs = s.candles, o = s.dayOpen;
    const series = cs.map(c => ({
      time: c.time, open: P(c.open, o), high: P(c.high, o),
      low: P(c.low, o), close: P(c.close, o),
    }));
    const win = (a, b) => cs.filter(c => c.time >= a && c.time < b);

    // ── 이벤트 탐지: 지정 시간대(ctx.start~ctx.end) 안에서만
    const gates = [];
    let armed = true;
    for (const c of cs) {
      if (c.time < ctx.start || c.time > ctx.end) continue;
      const p = P(c.close, o);
      if (armed && p >= th) { gates.push(c); armed = false; }
      else if (!armed && p < th - hy) armed = true;
    }

    const evs = gates.map((g, k) => {
      const tg = g.time, gp = g.close;
      const baseArr = win(tg - preSec - baseSec, tg - preSec);
      const preArr  = win(tg - preSec, tg);
      const judArr  = cs.filter(c => c.time >= tg && c.time <= tg + judSec);

      const thin = baseArr.length < 3;
      const baseDen = thin ? null : den(baseArr, baseSec);
      const preDen  = den(preArr, preSec);

      const ups = preArr.filter(c => c.close > c.open);
      const upShare = preArr.length ? ups.length / preArr.length : 0;
      const rise = preArr.length ? P(g.close, o) - P(preArr[0].open, o) : 0;
      const effi = preArr.length ? rise / preArr.length : 0;   // %p per candle

      // ── 판정 (정답지, 점수 미반영)
      const mfe = judArr.length ? Math.max(...judArr.map(c => (c.high / gp - 1) * 100)) : 0;
      const mae = judArr.length ? Math.min(...judArr.map(c => (c.low  / gp - 1) * 100)) : 0;
      let tFall = null, tPeak = tg, best = -1e9, holdEnd = tg;
      for (const c of judArr) {
        const up = (c.high / gp - 1) * 100;
        if (up > best) { best = up; tPeak = c.time; }
        if (tFall == null && P(c.close, o) < th - hy) tFall = c.time;
        if (tFall == null) holdEnd = c.time;
      }
      const truncated = !cs.some(c => c.time >= tg + judSec);
      let label = '중립';
      if (mfe >= o2.goodPct && (tFall == null || tPeak <= tFall)) label = '진성';
      else if (tFall != null || mae <= o2.badPct) label = '먹튀';
      if (truncated && label === '중립') label = '미판정';

      return {
        code: s.code, name: s.name, color: s.color, seq: k + 1,
        gateHm: tg, gateAt: tg, gatePrice: gp, thinBase: thin,
        baseDen, preDen, preX: baseDen ? preDen / baseDen : null,
        upShare, effi, mfe, mae, holdMin: (holdEnd - tg) / 60,
        label, truncated,
        wBase: [tg - preSec - baseSec, tg - preSec],
        wPre:  [tg - preSec, tg],
        wJud:  [tg, tg + judSec],
      };
    });

    events.push(...evs);

    // ── 막대: 절대 틱/분 (정규화 없음) + 구간별 색으로 진성 구간 표기
    const bars = [];
    if (ctx.bucketSec) {
      for (let t = ctx.start; t < ctx.end; t += ctx.bucketSec) {
        const n = win(t, t + ctx.bucketSec).length;
        let col = '#21262d';
        for (const e of evs) {
          const mid = t + ctx.bucketSec / 2;
          if (mid >= e.wPre[0] && mid < e.wPre[1]) col = '#f5b041';
          else if (mid >= e.wJud[0] && mid < e.wJud[1])
            col = e.label === '진성' ? '#2ecc71' : e.label === '먹튀' ? '#6e4040' : '#3d4650';
          else if (mid >= e.wBase[0] && mid < e.wBase[1] && col === '#21262d') col = '#30363d';
        }
        bars.push({ time: t, value: n / (ctx.bucketSec / 60), color: col });
      }
    }

    const marks = evs.map(e => ({
      time: e.gateAt, position: 'belowBar',
      shape: e.label === '진성' ? 'arrowUp' : 'arrowDown',
      color: e.label === '진성' ? '#2ecc71' : e.label === '먹튀' ? '#e05a5a' : '#8b949e',
      text: `${e.label} ×${(e.preX ?? 0).toFixed(1)}`,
    }));

    const top = evs.filter(e => e.preX != null).sort((a, b) => b.preX - a.preX)[0] || null;
    perSymbol[s.code] = {
      series, bars, marks,
      vlines: evs.map(e => ({ time: e.gateAt, color: e.color })),
      metrics: top ? { ...top, nEvents: evs.length }
                   : { label: '대상외', nEvents: 0, gateHm: null, preX: null },
    };
    if (top) ranking.push({ code: s.code, score: top.preX, reason: `${evs.length}회 돌파 · 최고 ×${top.preX.toFixed(2)}` });
  }

  ranking.sort((a, b) => b.score - a.score);
  events.sort((a, b) => a.gateAt - b.gateAt);

  // ── 급증배수 구간별 진성률 (검증용 집계)
  const bins = [[0, 1.5], [1.5, 2.5], [2.5, 4], [4, 99]];
  const summary = bins.map(([lo, hi]) => {
    const g = events.filter(e => e.preX != null && e.preX >= lo && e.preX < hi);
    const w = g.filter(e => e.label === '진성').length;
    return { bin: `×${lo}~${hi === 99 ? '∞' : hi}`, n: g.length, win: w, rate: g.length ? w / g.length : null };
  });

  return { id: meta.id, version: meta.version, perSymbol, ranking, columns, events, summary };
}
