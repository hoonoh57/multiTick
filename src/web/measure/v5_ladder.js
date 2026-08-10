// src/web/measure/v5_ladder.js
// v5 · 사다리(가격 눈금) 밀도
// 시간창이 아니라 "가격 눈금 통과 구간"으로 분해한다.
// 돌파 눈금 아래 = 실전 가용 피처, 위 = 정답지. 둘이 가격축에서 분리된다.

const P = (v, o) => (v / o - 1) * 100;
const R = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export const meta = { id: 'v5', label: 'v5 · 사다리 (가격눈금 밀도)', version: '0.1.0', frozen: false };

export const options = {
  threshold: 5,        // 돌파 눈금 (시가 대비 %)
  ladderMode: 'abs',   // 'abs' 절대% | 'rel' 돌파기준 상대%p
  rungs: null,         // UI 입력 배열 (없으면 아래 기본값)
  rungsAbs: [2, 3, 4, 5, 6, 7, 8, 10],
  rungsRel: [-3, -2, -1, 0, 1, 2, 3],
  denMode: 'tick',     // 'tick' 틱/초 | 'candle' 봉/분
  touch: 'high',       // 'high' 고가터치 | 'close' 종가확정
  goodUp: 2,           // 진성: 돌파 +2%p 눈금 선착
  badDown: 1.5,        // 먹튀: 돌파 -1.5%p 이탈 선착
  brokenPct: 1.5,      // 등반 중 되돌림 한계(계단 끊김)
  hyst: 1.5,           // 재무장 폭
};

export const columns = [
  { key: 'gateHm',  label: '돌파',     fmt: 'hm'   },
  { key: 'label',   label: '판정',     fmt: 'raw'  },
  { key: 'baseX',   label: '급증배수', fmt: 'f2'   },
  { key: 'accel',   label: '가속',     fmt: 'f2'   },
  { key: 'baseDen', label: '기준밀도', fmt: 'f2'   },
  { key: 'preDen',  label: '직전밀도', fmt: 'f2'   },
  { key: 'preSpp',  label: '초/%p',    fmt: 'f1'   },
  { key: 'upShare', label: '양봉비',   fmt: 'pc'   },
  { key: 'maxRung', label: '최고눈금', fmt: 'pct2' },
  { key: 'broken',  label: '끊김',     fmt: 'bool' },
];

export function compute(ctx, opt = {}) {
  const o = { ...options, ...opt };
  const th = +o.threshold || 5;

  const src = Array.isArray(o.rungs) && o.rungs.length
    ? o.rungs.slice()
    : (o.ladderMode === 'rel' ? o.rungsRel : o.rungsAbs).slice();
  let rungs = (o.ladderMode === 'rel' ? src.map(v => th + v) : src).filter(Number.isFinite);
  if (!rungs.some(v => Math.abs(v - th) < 1e-9)) rungs.push(th);
  rungs = [...new Set(rungs.map(v => +(+v).toFixed(2)))].sort((a, b) => a - b);
  const gi = rungs.findIndex(v => Math.abs(v - th) < 1e-9);

  const segLabels = ['기준~' + R(rungs[0])];
  for (let i = 1; i < rungs.length; i++) segLabels.push(R(rungs[i - 1]) + '→' + R(rungs[i]));

  const goodLvl = th + o.goodUp, badLvl = th - o.badDown;
  const perSymbol = {}, events = [], ranking = [];

  for (const s of ctx.symbols) {
    const dop = s.dayOpen;
    const raw = s.candles.filter(c => c.time >= ctx.start && c.time <= ctx.end);
    const series = raw.map(c => ({
      time: c.time, open: P(c.open, dop), high: P(c.high, dop),
      low: P(c.low, dop), close: P(c.close, dop),
    }));

    if (raw.length < 3) {
      perSymbol[s.code] = { series, bars: [], marks: [], vlines: [],
        metrics: { label: '자료부족', gateHm: null, baseX: null } };
      continue;
    }

    // 봉 지속초 — 틱봉은 길이가 제각각이라 분모를 실측한다
    const gaps = [];
    for (let i = 1; i < raw.length; i++) gaps.push(raw[i].time - raw[i - 1].time);
    const sorted = gaps.filter(v => v > 0).sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 60;

    const cs = raw.map((c, i) => {
      let d = i + 1 < raw.length ? raw[i + 1].time - c.time : med;
      if (!(d > 0) || d > med * 20) d = med;
      return { time: c.time, dur: d, tk: c.ticks || ctx.tickSize || 30, up: c.close > c.open,
        pO: P(c.open, dop), pH: P(c.high, dop), pL: P(c.low, dop), pC: P(c.close, dop) };
    });

    const tv = i => (o.touch === 'close' ? cs[i].pC : cs[i].pH);
    const touchIdx = (lvl, a, b) => { for (let i = a; i <= b; i++) if (tv(i) >= lvl) return i; return -1; };

    const range = (a, b) => {
      if (b < a) return null;
      let sec = 0, tk = 0, n = 0, up = 0;
      for (let i = a; i <= b; i++) { sec += cs[i].dur; tk += cs[i].tk; n++; if (cs[i].up) up++; }
      if (!(sec > 0)) return null;
      return { den: o.denMode === 'tick' ? tk / sec : n / (sec / 60), sec, n,
               upShare: n ? up / n : 0, inOne: false };
    };
    const oneBar = (i, dp) => {
      const c = cs[i];
      const f = Math.min(1, Math.max(0.05, dp / Math.max(0.05, c.pH - c.pL)));
      return { den: o.denMode === 'tick' ? c.tk / c.dur : 1 / (c.dur / 60),
               sec: c.dur * f, n: f, upShare: c.up ? 1 : 0, inOne: true };
    };

    // 돌파 이벤트 탐지 (재무장 히스테리시스)
    const gates = [];
    let armed = true, armIdx = 0;
    for (let i = 0; i < cs.length; i++) {
      if (armed && cs[i].pC >= th) { gates.push({ iStart: armIdx, iGate: i }); armed = false; }
      else if (!armed && cs[i].pC < th - o.hyst) { armed = true; armIdx = i; }
    }

    const out = gates.map((ev, k) => {
      const iStart = ev.iStart, iGate = ev.iGate, gp = cs[iGate].pC;

      let iBad = -1;
      for (let i = iGate + 1; i < cs.length; i++) if (cs[i].pC < badLvl) { iBad = i; break; }
      const iEnd = iBad < 0 ? cs.length - 1 : iBad;
      let iGood = -1;
      for (let i = iGate; i <= iEnd; i++) if (tv(i) >= goodLvl) { iGood = i; break; }

      const iT = rungs.map((lv, j) => j <= gi ? touchIdx(lv, iStart, iGate) : touchIdx(lv, iGate, iEnd));

      const segs = [];
      const b0 = iT[0] < 0 ? iGate : iT[0];
      const base = range(iStart, Math.max(iStart, b0 - 1));
      segs.push(Object.assign({ label: segLabels[0], side: 'base', spp: null },
        base || { den: null, sec: 0, n: 0, upShare: 0, inOne: false }));
      for (let j = 1; j < rungs.length; j++) {
        const a = iT[j - 1], b = iT[j], dp = rungs[j] - rungs[j - 1];
        let g = null;
        if (a >= 0 && b >= 0) g = (b === a) ? oneBar(b, dp) : range(a + 1, b);
        segs.push(Object.assign({ label: segLabels[j], side: j <= gi ? 'pre' : 'post' },
          g || { den: null, sec: null, n: 0, upShare: 0, inOne: false },
          { spp: (g && g.sec) ? g.sec / dp : null }));
      }

      const baseDen = segs[0].den;
      const preSeg = gi >= 1 ? segs[gi] : segs[0];
      const preDen = preSeg.den;
      const baseX = (baseDen && preDen != null) ? preDen / baseDen : null;
      const firstSeg = segs[1];
      const accel = (gi >= 2 && firstSeg && firstSeg.den && preDen != null) ? preDen / firstSeg.den : null;

      let up = 0, n = 0, peak = -1e9, dd = 0, climbSec = 0;
      for (let i = iStart; i <= iGate; i++) {
        n++; if (cs[i].up) up++; climbSec += cs[i].dur;
        if (cs[i].pH > peak) peak = cs[i].pH;
        dd = Math.max(dd, peak - cs[i].pL);
      }

      let maxRung = null;
      for (let j = gi; j < rungs.length; j++) if (iT[j] >= 0) maxRung = rungs[j];
      let mfe = 0, mae = 0;
      for (let i = iGate; i <= iEnd; i++) { mfe = Math.max(mfe, cs[i].pH - gp); mae = Math.min(mae, cs[i].pL - gp); }

      let label;
      if (iGood >= 0 && (iBad < 0 || iGood <= iBad)) label = '진성';
      else if (iBad >= 0) label = '먹튀';
      else label = (cs.length - 1 - iGate) >= 5 ? '중립' : '미판정';

      return { code: s.code, name: s.name, color: s.color, seq: k + 1,
        gateHm: cs[iGate].time, gateAt: cs[iGate].time, gatePct: gp,
        segs, baseDen, preDen, baseX, accel, preSpp: preSeg.spp,
        upShare: n ? up / n : 0, climbSec, maxRung, mfe, mae,
        broken: dd >= o.brokenPct, label,
        rungTouch: iT.map(i => (i >= 0 ? cs[i].time : null)),
        wPre: [cs[iStart].time, cs[iGate].time], wPost: [cs[iGate].time, cs[iEnd].time] };
    });

    events.push(...out);

    const bars = [];
    if (ctx.bucketSec) {
      for (let t = ctx.start; t < ctx.end; t += ctx.bucketSec) {
        let tk = 0, sec = 0;
        for (const c of cs) if (c.time >= t && c.time < t + ctx.bucketSec) { tk += c.tk; sec += c.dur; }
        let col = '#21262d';
        const mid = t + ctx.bucketSec / 2;
        for (const e of out) {
          if (mid >= e.wPre[0] && mid < e.wPre[1]) col = '#f5b041';
          else if (mid >= e.wPost[0] && mid <= e.wPost[1])
            col = e.label === '진성' ? '#2ecc71' : e.label === '먹튀' ? '#6e4040' : '#3d4650';
        }
        bars.push({ time: t, value: sec > 0 ? tk / sec : 0, color: col });
      }
    }

    const marks = [];
    for (const e of out) {
      marks.push({ time: e.gateAt, position: 'belowBar',
        shape: e.label === '진성' ? 'arrowUp' : 'arrowDown',
        color: e.label === '진성' ? '#2ecc71' : e.label === '먹튀' ? '#e05a5a' : '#8b949e',
        text: e.label + ' ×' + (e.baseX != null ? e.baseX.toFixed(1) : '-') });
      for (let j = 0; j < gi; j++) if (e.rungTouch[j])
        marks.push({ time: e.rungTouch[j], position: 'aboveBar', shape: 'circle',
          color: '#8b949e', text: R(rungs[j]) + '%' });
    }

    const top = out.filter(e => e.baseX != null).sort((a, b) => b.baseX - a.baseX)[0] || out[0] || null;
    perSymbol[s.code] = { series, bars, marks,
      vlines: out.map(e => ({ time: e.gateAt, color: e.color })),
      metrics: top ? Object.assign({}, top, { nEvents: out.length })
                   : { label: '대상외', nEvents: 0, gateHm: null, baseX: null } };
    if (top && top.baseX != null)
      ranking.push({ code: s.code, score: top.baseX,
        reason: out.length + '회 · ' + top.label + ' · ×' + top.baseX.toFixed(2) });
  }

  ranking.sort((a, b) => b.score - a.score);
  events.sort((a, b) => a.gateAt - b.gateAt);

  const binsOf = (key, edges) => edges.map(([lo, hi]) => {
    const g = events.filter(e => e[key] != null && e[key] >= lo && e[key] < hi);
    const w = g.filter(e => e.label === '진성').length;
    return { bin: '×' + lo + '~' + (hi === 999 ? '∞' : hi), n: g.length, win: w,
             lose: g.filter(e => e.label === '먹튀').length, rate: g.length ? w / g.length : null };
  });

  return { id: meta.id, label: meta.label, version: meta.version,
    perSymbol, ranking, columns, events,
    summary: binsOf('baseX', [[0, 1.5], [1.5, 2.5], [2.5, 4], [4, 999]]),
    summary2: binsOf('accel', [[0, 0.8], [0.8, 1.2], [1.2, 2], [2, 999]]),
    rungs, gateIndex: gi, segLabels,
    rungsLabel: rungs.map(R).join('/') + '% (돌파 ' + R(th) + '%)',
    denUnit: o.denMode === 'tick' ? '틱/초' : '봉/분' };
}