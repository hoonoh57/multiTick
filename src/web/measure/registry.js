// src/web/measure/registry.js
import * as v1 from './v1_fixedWindow.frozen.js';
import * as v2 from './v2_breakout.js';
import * as v3 from './v3_gateDensity.js';
import * as v4 from './v4_events.js'; 

import * as v5 from './v5_ladder.js';

export const MODES = { v1, v2, v3, v4, v5 };
export const list = () => Object.values(MODES).map(m => m.meta);
export const run = (id, ctx, opt) => MODES[id].compute(ctx, opt);

/** 두 결과의 순위 상관 (대상 제외 종목은 최하위 공동순위) */
export function spearman(a, b) {
  const rank = r => {
    const m = new Map();
    r.ranking.forEach((x, i) => m.set(x.code, x.score == null ? r.ranking.length : i + 1));
    return m;
  };
  const ra = rank(a), rb = rank(b);
  const codes = [...ra.keys()].filter(c => rb.has(c));
  const n = codes.length;
  if (n < 2) return null;
  const d2 = codes.reduce((s, c) => s + (ra.get(c) - rb.get(c)) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

export function downloadJson(obj, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
