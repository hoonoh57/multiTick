// src/web/app.js  ── 전체 교체본 (v3 지원 / 분할패널 / 당일 시가 정규화)
import {
  createChart, CandlestickSeries, HistogramSeries,
  createSeriesMarkers, CrosshairMode, LineStyle,
} from 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.mjs';

import { run, spearman, downloadJson } from './measure/registry.js';
import { assemble, wall, hhmm } from './measure/common.js';
import { FMT } from './measure/types.js';

/* ────────────────────────── 상수 / 상태 ────────────────────────── */

const PALETTE = ['#e05a5a', '#4a9eff', '#2ecc71', '#f5b041',
                 '#a569bd', '#48c9b0', '#ec7063', '#5dade2'];

const MULS = [[1, '30틱'], [2, '60틱'], [4, '120틱'], [8, '240틱'],
              [12, '360틱'], [16, '480틱'], [24, '720틱']];
const BUCKETS = [[60, '1분'], [180, '3분'], [300, '5분'], [900, '15분']];
const BASE_SCOPE = 30;

const $ = s => document.querySelector(s);
const msg  = t => { $('#msg').textContent = t; };
const cmsg = t => { $('#cmsg').textContent = t; };

const state = {
  watchlist: null,
  selected: new Set(),
  cache: new Map(),
  lastRun: null,
};

let chart = null;
let disposables = [];

/* ────────────────────────── 초기화 ────────────────────────── */

initTabs();
initSelects();
initImportTab();
initChartTab();
loadWatchlists();
{
  const d = new Date();
  $('#baseDate').value =
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function initTabs() {
  document.querySelectorAll('.tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('.tab-body').forEach(x =>
        x.classList.toggle('on', x.id === 'tab-' + b.dataset.tab));
    });
  });
}

function initSelects() {
  const fill = (el, pairs, def) => {
    el.innerHTML = pairs
      .map(([v, l]) => `<option value="${v}"${v === def ? ' selected' : ''}>${l}</option>`).join('');
  };
  fill($('#cTickMul'), MULS, 4);
  fill($('#cBucket'), BUCKETS, 900);
}

/* ────────────────────────── 불러오기 탭 ────────────────────────── */

function initImportTab() {
  $('#btnParse').addEventListener('click', doParse);
  $('#btnSave').addEventListener('click', doSave);
  $('#btnToChart').addEventListener('click', () => {
    if (!state.watchlist) { msg('먼저 변환하세요.'); return; }
    applyWatchlist(state.watchlist);
    document.querySelector('.tab[data-tab="chart"]').click();
  });
}

async function doParse() {
  const raw = $('#paste').value;
  if (!raw.trim()) { msg('붙여넣은 내용이 비어 있습니다.'); return; }
  msg('변환 중…');
  try {
    const r = await fetch('/api/perf/parse', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw,
        baseDate: $('#baseDate').value.replaceAll('-', ''),
        baseTime: $('#baseTime').value.replace(':', '') + '00',
        condition: $('#condition').value,
        tickMul: +$('#tickMul').value,
        bucketSec: +$('#bucketSec').value,
        slots: +$('#slots').value,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || j.error || '파싱 실패');
    state.watchlist = j.watchlist || j;
    renderPreview(state.watchlist, j.unresolved || [], j.ambiguous || []);
    msg(`종목 ${state.watchlist.symbols.length}개 변환 완료`
      + ((j.unresolved || []).length ? ` · 코드 미해결 ${j.unresolved.length}개` : ''));
  } catch (e) { msg('오류: ' + e.message); }
}

async function doSave() {
  if (!state.watchlist) { msg('먼저 변환하세요.'); return; }
  const r = await fetch('/api/perf/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.watchlist),
  });
  const j = await r.json();
  if (!r.ok) { msg('저장 실패: ' + (j.detail ?? '')); return; }
  const file = j.saved ? String(j.saved).split(/[\\/]/).pop() : '';   // 서버 응답 키: saved
  msg(`저장됨: ${file} (${j.count ?? 0}종목)`);
  loadWatchlists(file);
}

function renderPreview(wl, unresolved, ambiguous) {
  const amb = new Set(ambiguous.map(a => a.name ?? a));
  $('#preview').innerHTML = `
    <table class="preview">
      <thead><tr><th>종목</th><th>코드</th><th>최고수익률</th><th>검색시점거래량</th></tr></thead>
      <tbody>${wl.symbols.map(s => `
        <tr><td>${s.name}${amb.has(s.name) ? ' <span class="warn">유사명 다수</span>' : ''}</td>
            <td>${s.code || '<span class="warn">미해결</span>'}</td>
            <td>${s.maxPct ?? '-'}</td><td>${(s.volume ?? 0).toLocaleString()}</td></tr>`).join('')}
      </tbody></table>`;
}

/* ────────────────────────── 차트 탭 ────────────────────────── */

function initChartTab() {
  $('#btnDraw').addEventListener('click', () => draw().catch(e => cmsg('오류: ' + e.message)));
  $('#btnGolden').addEventListener('click', saveGolden);
  $('#wlPick').addEventListener('change', e => { if (e.target.value) loadOne(e.target.value); });

  const modeSel = $('#mode');
  const syncMode = () => {
    const m = modeSel.value;
    if ($('#thWrap')) $('#thWrap').style.display = m === 'v1' ? 'none' : '';
    if ($('#ladBox')) $('#ladBox').style.display = (m === 'v5' || m === 'v45') ? '' : 'none';
    if ($('#frozenBadge')) $('#frozenBadge').innerHTML =
      m === 'v1' ? '<span class="badge-frozen">FROZEN v1.0.0</span>' : '';
  };
  modeSel.addEventListener('change', syncMode);

  const lad = $('#ladMode');
  if (lad) lad.addEventListener('change', () => {
    $('#ladRungs').value = lad.value === 'rel' ? '-3,-2,-1,0,1,2,3' : '2,3,4,5,6,7,8,10';
  });

  syncMode();
}

async function loadWatchlists(prefer) {
  const sel = $('#wlPick');
  sel.innerHTML = '<option value="">— 불러오는 중… —</option>';
  try {
    const r = await fetch('/api/watchlists');
    if (!r.ok) throw new Error(`/api/watchlists ${r.status}`);
    const names = await r.json();               // 서버: 파일명 문자열 배열 (오름차순)

    if (!names.length) {
      sel.innerHTML = '<option value="">— 저장된 목록 없음 —</option>';
      cmsg('저장된 목록이 없습니다. [성과검증 불러오기] 탭에서 변환 → 파일로 저장을 한 번만 해두세요.');
      return;
    }

    const arr = [...names].sort((a, b) => String(b).localeCompare(String(a)));  // 역순 = 최신순
    sel.innerHTML = arr.map(n => `<option value="${n}">${n}</option>`).join('');

    const pick = (prefer && arr.includes(prefer)) ? prefer : arr[0];
    sel.value = pick;
    await loadOne(pick);                        // 플레이스홀더 없이 즉시 로드
  } catch (e) {
    sel.innerHTML = '<option value="">— 불러오기 실패 —</option>';
    cmsg('목록 조회 오류: ' + e.message);
  }
}

async function loadOne(name) {
  try {
    const r = await fetch('/api/watchlist/' + encodeURIComponent(name));  // 확장자 포함 그대로
    if (!r.ok) throw new Error(`목록 읽기 실패 ${r.status}`);
    applyWatchlist(await r.json());
  } catch (e) { cmsg('오류: ' + e.message); }
}

function applyWatchlist(wl) {
  state.watchlist = wl;
  state.selected = new Set(wl.symbols.filter(s => s.code).slice(0, 6).map(s => s.code));
  if (wl.tick?.mul) $('#cTickMul').value = wl.tick.mul;
  if (wl.bucket?.sec) $('#cBucket').value = wl.bucket.sec;
  if (wl.bucket?.slots) $('#cSlots').value = wl.bucket.slots;
  renderPicker();
  cmsg(`${wl.baseDate} ${wl.baseTime} · 종목 ${wl.symbols.length}개 · 좌측에서 선택 후 [그리기]`);
}

function renderPicker() {
  const wl = state.watchlist;
  if (!wl) { $('#picker').innerHTML = ''; return; }
  $('#picker').innerHTML = wl.symbols.map(s => {
    const on = state.selected.has(s.code);
    const color = PALETTE[[...state.selected].indexOf(s.code) % PALETTE.length];
    return `<label class="pick${s.code ? '' : ' disabled'}">
      <input type="checkbox" data-code="${s.code}" ${on ? 'checked' : ''} ${s.code ? '' : 'disabled'}>
      <span class="swatch" style="background:${on ? color : '#30363d'}"></span>
      <span class="nm">${s.name}</span>
      <span class="mx">${s.maxPct ?? ''}</span></label>`;
  }).join('');
  $('#picker').querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.checked ? state.selected.add(cb.dataset.code) : state.selected.delete(cb.dataset.code);
      renderPicker();
    });
  });
}

/* ────────────────────────── 틱 조회 / 정규화 ────────────────────────── */

const num = v => {
  if (v == null) return NaN;
  const n = Math.abs(parseFloat(String(v).replace(/[,+\s]/g, '')));
  return Number.isFinite(n) ? n : NaN;
};

function pickTime(r, ymd) {
  if (typeof r.time === 'number') return r.time > 1e12 ? Math.floor(r.time / 1000) : r.time;
  const s = String(r.cntr_tm ?? r.t ?? r.dt ?? '');
  if (s.length >= 14) return wall(s.slice(0, 8), s.slice(8, 14));
  if (s.length === 6) return wall(ymd, s);
  return null;
}

function normalizeTicks(j, ymd) {
  const arr = Array.isArray(j) ? j : (j.candles ?? j.data ?? j.rows ?? []);
  const out = [];
  for (const r of arr) {
    const t = pickTime(r, ymd);
    const c = num(r.close ?? r.c ?? r.cur_prc);
    if (t == null || !Number.isFinite(c)) continue;
    out.push({
      time: t,
      open:  num(r.open ?? r.o ?? r.open_pric) || c,
      high:  num(r.high ?? r.h ?? r.high_pric) || c,
      low:   num(r.low  ?? r.l ?? r.low_pric)  || c,
      close: c,
      volume: num(r.volume ?? r.v ?? r.trde_qty) || 0,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

async function fetchBase(code, date) {
  const key = `${code}_${date}`;
  if (state.cache.has(key)) return state.cache.get(key);
  const r = await fetch(`/api/ticks?code=${code}&date=${date}`);
  if (!r.ok) throw new Error(`${code} 틱조회 실패 (${r.status})`);
  const rows = normalizeTicks(await r.json(), date);
  state.cache.set(key, rows);
  return rows;
}

async function buildCtx() {
  const wl = state.watchlist;
  if (!wl) throw new Error('목록이 없습니다. 먼저 성과검증을 불러오세요.');
  const codes = wl.symbols.filter(s => state.selected.has(s.code));
  if (!codes.length) throw new Error('종목을 1개 이상 선택하세요.');

  const date = wl.baseDate;
  const mul = +$('#cTickMul').value;
  const bucketSec = +$('#cBucket').value;
  const slots = +$('#cSlots').value;
  const win = +$('#cWindow').value;

  const dayStart = wall(date, '090000');
  const dayEnd   = wall(date, '160000');
  const t0 = wall(date, String(wl.baseTime).padEnd(6, '0'));
  const start = win ? t0 : dayStart;
  const end   = win ? t0 + win : wall(date, '153000');

  const symbols = [];
  const skipped = [];
  for (const [i, s] of codes.entries()) {
    const all = await fetchBase(s.code, date);
    // ★ 전일 데이터 제거: ka10079 는 현재부터 과거로 페이징하므로 당일만 남긴다
    const today = all.filter(c => c.time >= dayStart && c.time < dayEnd);
    if (!today.length) { skipped.push(s.name); continue; }
    symbols.push({
      code: s.code, name: s.name, color: PALETTE[i % PALETTE.length],
      dayOpen: today[0].open,          // ★ 09:00 시가 기준 정규화
      openAt: today[0].time,
      candles: assemble(today, mul, BASE_SCOPE),
      rawCount: today.length,
    });
  }
  if (skipped.length) cmsg(`당일 틱 없음: ${skipped.join(', ')}`);
  if (!symbols.length) throw new Error('조회된 당일 틱이 없습니다.');

  return {
    baseDate: date, baseTime: wl.baseTime, condition: wl.condition,
    start, end, tickMul: mul, tickSize: mul * BASE_SCOPE,
    bucketSec, slots, windowSec: win, symbols,
  };
}

/* ────────────────────────── 그리기 ────────────────────────── */

async function draw() {
  cmsg('조회 중…');
  const ctx = await buildCtx();
  const mode = $('#mode').value;

  const val = (sel, dft) => ($(sel) ? $(sel).value : dft);
  const rungs = (val('#ladRungs', '') || '')
    .split(',').map(v => parseFloat(v.trim())).filter(Number.isFinite);

  const opt = {
    threshold: +$('#th').value || 5,
    preMin: 3, baseMin: 10, judgeMin: 10,
    ladderMode: val('#ladMode', 'abs'),
    rungs: rungs.length ? rungs : null,
    denMode: val('#denMode', 'tick'),
    touch: val('#touchMode', 'high'),
  };

  const ids = mode === 'both' ? ['v1', 'v4']
            : mode === 'v45'  ? ['v5', 'v4']
            : [mode];
  const results = ids.map(id => run(id, ctx, id === 'v1' ? undefined : opt));

  render(ctx, results[0]);
  renderPanels(ctx, results);
  renderEvents(results);

  const rho = results.length === 2 ? spearman(results[0], results[1]) : null;
  $('#corr').textContent = rho == null ? '' : `순위 상관 ρ = ${rho.toFixed(3)}`;

  state.lastRun = { ctx: stripCandles(ctx), results };

  const open = ctx.symbols.map(s => `${s.name} 시가 ${s.dayOpen.toLocaleString()}`).join(' · ');
  const cnt = ctx.symbols
    .map(s => `${s.name} ${results[0].perSymbol[s.code].series.length}`).join(', ');
  cmsg(`${ctx.tickSize}틱 · ${ctx.bucketSec / 60}분구간 — ${cnt}   |   ${open}`);
}


function render(ctx, res) {
  disposables.forEach(f => { try { f(); } catch {} });
  disposables = [];
  if (chart) { chart.remove(); chart = null; }

  const axisMode  = $('#cMode').value;          // 'time' | 'tick' | 'pane'
  const tickAxis  = axisMode === 'tick';
  const paneMode  = axisMode === 'pane';
  const showLabel = $('#cLabel').checked;

  chart = createChart($('#chart'), {
    autoSize: true,
    layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9', attributionLogo: true },
    grid: { vertLines: { color: '#161b22' }, horzLines: { color: '#161b22' } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#30363d', scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: {
      borderColor: '#30363d', timeVisible: true, secondsVisible: false,
      minBarSpacing: 1, rightOffset: 3,
      tickMarkFormatter: t => tickAxis ? String(t - ctx.start) : hhmm(t),
    },
  });

  // 틱축 모드에서만 캔들을 순번으로 재배치
  const dataOf = code => {
    const d = res.perSymbol[code].series;
    return tickAxis ? d.map((c, i) => ({ ...c, time: ctx.start + i * 60 })) : d;
  };

  // 축 폭 고정용 whitespace (시간축·분할패널 공통, 항상 pane 0)
  if (!tickAxis) {
    const step = Math.max(1, Math.round(ctx.bucketSec / ctx.slots));
    const ws = [];
    for (let t = ctx.start; t <= ctx.end; t += step) ws.push({ time: t });
    const g = chart.addSeries(CandlestickSeries, {
      upColor: 'transparent', downColor: 'transparent', borderVisible: false,
      wickVisible: false, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
    }, 0);
    g.setData(ws);
  }

  let anchor = null;

  ctx.symbols.forEach((s, i) => {
    const p = res.perSymbol[s.code];
    const pane = paneMode ? i : 0;

    const cs = chart.addSeries(CandlestickSeries, {
      upColor: s.color, borderUpColor: s.color, wickUpColor: s.color,
      downColor: '#0d1117', borderDownColor: s.color, wickDownColor: s.color,
      priceLineVisible: false, lastValueVisible: paneMode, title: s.name,
      priceFormat: { type: 'custom', minMove: 0.01,
                     formatter: v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%' },
    }, pane);
    cs.setData(dataOf(s.code));
    if (!anchor) anchor = cs;

    if (showLabel && p.marks?.length && !tickAxis) {
      createSeriesMarkers(cs, p.marks.map(m => ({
        time: m.time, position: m.position || 'aboveBar', color: m.color,
        shape: m.shape || 'arrowUp', text: m.text, size: 1,
      })));
    }

    // 분할패널: 각 패널에 0% / +5% 선을 따로
    if (paneMode) {
      [[0, '#8b949e', '시가'], [5, '#f5b041', '+5%']].forEach(([v, c, t]) =>
        cs.createPriceLine({ price: v, color: c, lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: t }));
    }

    if (p.bars?.length && !tickAxis) {
      const hs = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false,
        priceScaleId: paneMode ? 'dens' : '',
      }, paneMode ? i : 1);
      hs.setData(p.bars);
      hs.priceScale().applyOptions({ scaleMargins: { top: paneMode ? 0.80 : 0.75, bottom: 0 } });
    }
  });

  // 오버레이 모드에서만 공용 기준선
  if (!paneMode && anchor) {
    [[0, '#8b949e', '시가'], [5, '#f5b041', '+5%'],
     [10, '#f5b041', '+10%'], [20, '#e05a5a', '+20%']].forEach(([v, c, t]) =>
      anchor.createPriceLine({ price: v, color: c, lineWidth: 1,
        lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: t }));
  }

  // 세로 구분선 (돌파 시점 등)
  if (!tickAxis && anchor) {
    const vlines = [];
    for (const s of ctx.symbols) vlines.push(...(res.perSymbol[s.code].vlines || []));
    if (vlines.length) attachVLines(anchor, chart, dedupe(vlines));
  }

  try {
    const panes = chart.panes();
    if (paneMode) panes.forEach(pn => pn.setStretchFactor(1));
    else if (panes[1]) panes[1].setStretchFactor(0.22);
  } catch {}

  chart.timeScale().fitContent();
}

const dedupe = a => [...new Map(a.map(v => [v.time + (v.label || ''), v])).values()];

/** 세로선 – v5 시리즈 프리미티브 */
function attachVLines(series, chartRef, lines) {
  const prim = {
    attached() {}, detached() {},
    paneViews: () => [{
      renderer: () => ({
        draw(target) {
          target.useBitmapCoordinateSpace(scope => {
            const { context: c, horizontalPixelRatio: hr, bitmapSize } = scope;
            const ts = chartRef.timeScale();
            for (const ln of lines) {
              const x = ts.timeToCoordinate(ln.time);
              if (x == null) continue;
              c.save();
              c.strokeStyle = ln.color || 'rgba(255,255,255,0.18)';
              c.lineWidth = Math.max(1, Math.floor(hr));
              c.beginPath();
              c.moveTo(Math.round(x * hr), 0);
              c.lineTo(Math.round(x * hr), bitmapSize.height);
              c.stroke();
              c.restore();
            }
          });
        },
      }),
      zOrder: () => 'bottom',
    }],
  };
  series.attachPrimitive(prim);
  disposables.push(() => series.detachPrimitive(prim));
}

/* ────────────────────────── 하단 비교 패널 ────────────────────────── */

function renderPanels(ctx, results) {
  const box = $('#panels');
  box.innerHTML = '';
  const rankOf = r => new Map(r.ranking.map((x, i) => [x.code, i + 1]));
  const ranks = results.map(rankOf);

  results.forEach((res, ri) => {
    const el = document.createElement('div');
    el.className = 'panel';
    const cmp  = results.length === 2 ? ranks[1 - ri] : null;
    const mine = ranks[ri];
    const head = res.columns.map(c => `<th>${c.label}</th>`).join('');
    const reason = new Map(res.ranking.map(x => [x.code, x.reason || '']));

    // 랭킹 진입 종목 먼저, 미진입(대상외)은 뒤로 — 전 종목 표시
    const rows = [...ctx.symbols]
      .sort((a, b) => (mine.get(a.code) ?? 1e9) - (mine.get(b.code) ?? 1e9))
      .map(s => {
        const m = res.perSymbol[s.code]?.metrics || {};
        const n = mine.get(s.code) ?? null;
        const cells = res.columns
          .map(c => `<td>${(FMT[c.fmt] || FMT.raw)(m[c.key])}</td>`).join('');
        let mv = '';
        if (cmp) {
          const o = cmp.get(s.code);
          if (o && n) {
            const d = o - n;
            mv = d === 0 ? '–'
               : `<span class="rank-${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`;
          } else mv = '–';
        }
        return `<tr class="${n ? '' : 'out'}" title="${reason.get(s.code) || ''}">
          <td><span class="swatch" style="background:${s.color}"></span>${s.name}
              ${n ? '' : ' <em style="color:#8b949e">대상외</em>'}</td>
          <td>${n ?? '-'}${cmp ? ' ' + mv : ''}</td>${cells}</tr>`;
      }).join('');

    el.innerHTML = `<h4>${res.label ?? res.id}
      ${res.frozen ? '<span class="badge-frozen">FROZEN</span>' : ''}</h4>
      <table><thead><tr><th>종목</th><th>순위</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    box.appendChild(el);
  });
}

/* ────────────────────────── 기준결과 저장 ────────────────────────── */

const stripCandles = c => ({
  ...c,
  symbols: c.symbols.map(({ candles, ...rest }) => ({ ...rest, n: candles.length })),
});

function saveGolden() {
  if (!state.lastRun) { cmsg('먼저 [그리기]를 실행하세요.'); return; }
  const { ctx, results } = state.lastRun;
  const hm = String(ctx.baseTime).replace(':', '').slice(0, 4);
  for (const r of results) {
    downloadJson({ savedAt: new Date().toISOString(), ctx, result: r },
                 `${r.id}_${ctx.baseDate}_${hm}.json`);
  }
  cmsg(`기준결과 ${results.length}건 다운로드 → data/golden/ 로 옮겨두세요.`);
}

function renderEvents(res) {
  const box = document.querySelector('#events');
  if (!box) return;
  box.innerHTML = '';
  const arr = (Array.isArray(res) ? res : [res]).filter(r => r && Array.isArray(r.events));
  for (const r of arr) {
    const d = document.createElement('div');
    d.className = 'evblock';
    d.innerHTML = r.id === 'v5' ? ladderHtml(r) : eventsHtml(r);
    box.appendChild(d);
  }
}

const EVC = { '진성': '#2ecc71', '먹튀': '#e05a5a', '중립': '#8b949e', '미판정': '#6e7681' };
const nz2 = v => (v == null ? '-' : v.toFixed(2));
const nz1 = v => (v == null ? '-' : v.toFixed(1));
const evName = e => `<span class="swatch" style="background:${e.color}"></span>${e.name}` +
                    (e.seq > 1 ? ` <small>#${e.seq}</small>` : '');
const sumLine = (t, sm) => `<div class="evsum">${t} — ` + ((sm || []).filter(b => b.n).map(b =>
  `${b.bin} → ${b.win}/${b.n} (${(b.rate * 100).toFixed(0)}%)`).join(' · ') || '표본 없음') + '</div>';

function eventsHtml(res) {
  if (!res.events.length) return '<h4>v4 · 돌파 이벤트</h4><div class="dim">해당 시간대에 돌파 이벤트가 없습니다.</div>';
  const row = e => `<tr>
    <td>${hhmm(e.gateAt)}</td><td>${evName(e)}</td>
    <td style="color:${EVC[e.label]};font-weight:600">${e.label}</td>
    <td>${e.preX != null ? '×' + nz2(e.preX) : (e.thinBase ? '표본부족' : '-')}</td>
    <td>${nz1(e.baseDen)}</td><td>${nz1(e.preDen)}</td>
    <td>${(e.upShare * 100).toFixed(0)}%</td><td>${nz2(e.effi)}</td>
    <td style="color:#2ecc71">+${nz2(e.mfe)}%</td>
    <td style="color:#e05a5a">${nz2(e.mae)}%</td>
    <td>${nz1(e.holdMin)}</td></tr>`;
  return `<h4>v4 · 돌파 이벤트 ${res.events.length}건</h4>
    <table class="preview"><thead><tr>
    <th>돌파</th><th>종목</th><th>판정</th><th>급증배수</th><th>기준/분</th><th>직전/분</th>
    <th>양봉비</th><th>%p/봉</th><th>MFE</th><th>MAE</th><th>유지</th></tr></thead>
    <tbody>${res.events.map(row).join('')}</tbody></table>
    ${sumLine('급증배수별 진성률', res.summary)}`;
}

function ladderHtml(res) {
  if (!res.events.length)
    return `<h4>v5 · 사다리 <small>눈금 ${res.rungsLabel}</small></h4>
            <div class="dim">해당 시간대에 돌파 이벤트가 없습니다.</div>`;
  const cls = i => (i === 0 ? 'sg-base' : (i <= res.gateIndex ? 'sg-pre' : 'sg-post'));
  const row = e => `<tr>
    <td>${hhmm(e.gateAt)}</td><td>${evName(e)}</td>
    <td style="color:${EVC[e.label]};font-weight:600">${e.label}</td>
    <td>${e.baseX != null ? '×' + nz2(e.baseX) : '-'}</td>
    <td>${e.accel != null ? '×' + nz2(e.accel) : '-'}</td>
    <td>${nz2(e.baseDen)}</td><td>${nz2(e.preDen)}</td>
    <td>${nz1(e.preSpp)}</td><td>${(e.upShare * 100).toFixed(0)}%</td>
    <td>${nz1(e.climbSec / 60)}</td>
    <td>${e.maxRung != null ? e.maxRung + '%' : '-'}</td>
    <td style="color:#2ecc71">+${nz2(e.mfe)}</td>
    <td style="color:#e05a5a">${nz2(e.mae)}</td>
    <td>${e.broken ? '●' : ''}</td></tr>`;
  const segRow = e => `<tr><td>${evName(e)}</td>
    <td style="color:${EVC[e.label]}">${e.label}</td>` +
    e.segs.map((g, i) => `<td class="${cls(i)}">${g.den == null ? '-'
      : nz2(g.den) + (g.spp != null ? `<small> ${nz1(g.spp)}s</small>` : '')}</td>`).join('') + '</tr>';
  return `<h4>v5 · 사다리 이벤트 ${res.events.length}건
      <small>눈금 ${res.rungsLabel} · 밀도 ${res.denUnit}</small></h4>
    <table class="preview"><thead><tr>
      <th>돌파</th><th>종목</th><th>판정</th><th>급증배수</th><th>가속</th><th>기준밀도</th><th>직전밀도</th>
      <th>초/%p</th><th>양봉비</th><th>등반(분)</th><th>최고눈금</th><th>MFE</th><th>MAE</th><th>끊김</th>
    </tr></thead><tbody>${res.events.map(row).join('')}</tbody></table>
    <h4 class="sub">구간별 밀도 (${res.denUnit} · 작은글씨=초/%p)</h4>
    <table class="preview"><thead><tr><th>종목</th><th>판정</th>` +
      res.segLabels.map((l, i) => `<th class="${cls(i)}">${l}</th>`).join('') +
    `</tr></thead><tbody>${res.events.map(segRow).join('')}</tbody></table>
    ${sumLine('급증배수(직전/기준)별 진성률', res.summary)}
    ${sumLine('가속(직전/첫구간)별 진성률', res.summary2)}`;
}
