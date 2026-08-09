// src/lib/bucketSeparators.js
export function createBucketSeparators(chart, getTimes, opts = {}) {
  const color = opts.color ?? 'rgba(255, 90, 90, 0.22)';
  const width = opts.width ?? 1;

  const renderer = {
    draw(target) {
      target.useBitmapCoordinateSpace(scope => {
        const ctx = scope.context;
        const ts = chart.timeScale();
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, Math.round(width * scope.verticalPixelRatio));
        for (const t of getTimes()) {
          const x = ts.timeToCoordinate(t);
          if (x === null) continue;
          const px = Math.round(x * scope.horizontalPixelRatio) + 0.5;
          ctx.beginPath();
          ctx.moveTo(px, 0);
          ctx.lineTo(px, scope.bitmapSize.height);
          ctx.stroke();
        }
        ctx.restore();
      });
    },
  };

  const view = { renderer: () => renderer, zOrder: () => 'bottom' };
  return { updateAllViews() {}, paneViews: () => [view] };
}
