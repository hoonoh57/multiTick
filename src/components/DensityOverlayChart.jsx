// src/components/DensityOverlayChart.jsx
import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import { makeAxis, gridWhitespace, placeIntoSlots, toPercent } from '../lib/tickDensity';
import { createBucketSeparators } from '../lib/bucketSeparators';

const PALETTE = ['#e05a5a', '#4a9eff', '#2ecc71', '#f5b041', '#a569bd', '#48c9b0'];

/**
 * items: [{ code, name, dayOpen, candles:[{time,open,high,low,close,volume,_n}] }]
 *   candles.time = 벽시계 epoch(sec), 이미 원하는 틱크기로 조립된 상태
 * mode: 'time' (다종목 밀도 비교) | 'tick' (단일종목 정독, 보정 없음)
 */
export default function DensityOverlayChart({
  items, sessionStart, sessionEnd, bucketSec = 900, slots = 20,
  tickSize = 720, mode = 'time', priceBands = [5, 10, 20],
}) {
  const boxRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    const chart = createChart(boxRef.current, {
      autoSize: true,
      layout: { background: { color: '#14181f' }, textColor: '#c9d1d9', panes: { separatorColor: '#2a3038' } },
      grid: { vertLines: { visible: false }, horzLines: { color: '#1e242c' } },
      rightPriceScale: { borderColor: '#2a3038' },
      timeScale: { borderColor: '#2a3038', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: 1 },
      hoveredSeriesOnTop: true,
    });
    chartRef.current = chart;
    return () => chart.remove();
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !items?.length) return;

    const axis = makeAxis({ sessionStart, sessionEnd, bucketSec, slots });
    const disposers = [];

    // (1) 축 골격: 슬롯 whitespace. 종목 수·밀도와 무관하게 축 폭을 고정한다.
    const grid = chart.addSeries(LineSeries, {
      color: 'transparent', lastValueVisible: false, priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    grid.setData(gridWhitespace(axis));
    disposers.push(() => chart.removeSeries(grid));

    // (2) 단위구간 구분선
    const sepTimes = Array.from({ length: axis.buckets + 1 }, (_, b) => axis.bucketStart(b));
    grid.attachPrimitive(createBucketSeparators(chart, () => sepTimes));

    // (3) 가격 기준선 (당일 시가 대비 %)
    const ref = chart.addSeries(LineSeries, { color: 'transparent', lastValueVisible: false, priceLineVisible: false });
    ref.setData([{ time: axis.slotTime(0, 0), value: 0 }, { time: axis.slotTime(axis.buckets - 1, axis.slots - 1), value: 0 }]);
    ref.applyOptions({ visible: false });
    for (const p of [0, ...priceBands]) {
      ref.createPriceLine({
        price: p, color: p === 0 ? '#4a5058' : 'rgba(240,180,80,0.45)',
        lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: p === 0 ? '시가' : `+${p}%`,
      });
    }
    disposers.push(() => chart.removeSeries(ref));

    // (4) 종목별 틱캔들 + 발생개수 라벨
    const tickIndex = new Map();   // 틱축 모드 라벨용
    items.forEach((it, k) => {
      const color = PALETTE[k % PALETTE.length];
      const src = mode === 'tick'
        ? it.candles.map((c, i) => { const t = axis.slotTime(0, 0) + i * axis.slotSec; tickIndex.set(t, i + 1); return { ...c, time: t, srcTime: c.time }; })
        : it.candles;

      const { placed, counts } = mode === 'tick'
        ? { placed: src, counts: [] }
        : placeIntoSlots(src, axis);

      const s = chart.addSeries(CandlestickSeries, {
        upColor: color, downColor: 'transparent',
        borderUpColor: color, borderDownColor: color,
        wickUpColor: color, wickDownColor: color,
        borderVisible: true, priceLineVisible: false, lastValueVisible: k === 0,
        title: it.name,
      });
      s.setData(toPercent(placed, it.dayOpen));
      disposers.push(() => chart.removeSeries(s));

      if (counts.length) {
        createSeriesMarkers(s, counts.map(c => ({
          time: c.labelTime, position: 'aboveBar', color, shape: 'circle', size: 0,
          text: c.overflow ? `${c.count}▲` : `${c.count}`,
        })));

        // (5) 하단 페인: 구간별 발생 체결건수. 종목마다 슬롯을 어긋나게 두어 막대가 나란히 서게 함.
        const h = chart.addSeries(HistogramSeries, {
          color, priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false,
        }, 1);
        h.setData(counts.map(c => ({
          time: axis.slotTime(c.bucket, Math.min(k, axis.slots - 1)),
          value: c.count * tickSize,
        })));
        disposers.push(() => chart.removeSeries(h));
      }
    });

    if (mode === 'tick') {
      chart.applyOptions({ timeScale: { tickMarkFormatter: t => String(tickIndex.get(t) ?? '') } });
    } else {
      chart.applyOptions({ timeScale: { tickMarkFormatter: null } });
    }

    const panes = chart.panes();
    if (panes.length > 1) panes[1].setStretchFactor(0.28);
    chart.timeScale().fitContent();

    return () => { for (const d of disposers.reverse()) { try { d(); } catch {} } };
  }, [items, sessionStart, sessionEnd, bucketSec, slots, tickSize, mode, priceBands]);

  return <div ref={boxRef} style={{ width: '100%', height: '100%' }} />;
}
