import * as THREE from 'three';
import { COLORS, LAYOUT } from './constants.js';

export function buildGrid(chart) {
  const s = chart._sectionBounds();
  const range = chart.viewPriceMax - chart.viewPriceMin;
  const step = chart._niceStep(range, 10);
  const startP = Math.ceil(chart.viewPriceMin / step) * step;

  for (let p = startP; p <= chart.viewPriceMax; p += step) {
    const y = chart._priceToY(p);
    chart.groups.grid.add(
      chart._makeLine(
        [[LAYOUT.marginLeft, y], [chart.width, y]],
        COLORS.grid, 0.5
      )
    );
  }
}

export function buildCandles(chart) {
  const s = chart._sectionBounds();
  const visibleCount = chart.viewEndIdx - chart.viewStartIdx;
  if (visibleCount <= 0) return;

  const candleW = (s.candle.width / visibleCount) * (1 - LAYOUT.candleGap);
  const wickW = Math.max(1, candleW * 0.1);

  const drawStart = Math.max(0, Math.floor(chart.viewStartIdx));
  const drawEnd = Math.min(chart.priceData.length, Math.ceil(chart.viewEndIdx));
  for (let i = drawStart; i < drawEnd; i++) {
    const c = chart.priceData[i];
    if (!c) continue;
    const x = chart._idxToX(i + 0.5) - candleW / 2;
    const isUp = c.close >= c.open;
    const color = isUp ? COLORS.candleUp : COLORS.candleDown;

    const bodyLow = Math.min(c.open, c.close);
    const bodyHigh = Math.max(c.open, c.close);
    const yLow = chart._priceToY(bodyLow);
    const yHigh = chart._priceToY(bodyHigh);
    const bodyH = Math.max(yHigh - yLow, 1);
    chart.groups.candles.add(chart._makePlane(x, yLow, candleW, bodyH, color));

    const wickYLow = chart._priceToY(c.low);
    const wickYHigh = chart._priceToY(c.high);
    const wickX = chart._idxToX(i + 0.5) - wickW / 2;
    chart.groups.candles.add(
      chart._makePlane(wickX, wickYLow, wickW, wickYHigh - wickYLow, color)
    );
  }
}

export function buildGEXBars(chart) {
  const s = chart._sectionBounds();
  if (!chart.gexLevels.length) return;

  const maxCallGex = Math.max(...chart.gexLevels.map(l => Math.abs(l.callGex)), 1);
  const maxPutGex = Math.max(...chart.gexLevels.map(l => Math.abs(l.putGex)), 1);
  const maxGex = Math.max(maxCallGex, maxPutGex);
  const halfW = s.gex.width / 2;
  const centerX = s.gex.left + halfW;

  const strikes = chart.gexLevels.map(l => l.strike).sort((a, b) => a - b);

  for (const level of chart.gexLevels) {
    const py = chart._priceToY(level.strike);
    if (py < s.bottom || py > s.top) continue;
    const { y: barY, h: barH } = chart._gexBarBounds(level.strike, strikes);

    if (level.callGex > 0) {
      const w = (level.callGex / maxGex) * halfW;
      chart.groups.gexBars.add(
        chart._makePlane(centerX, barY, w, barH, COLORS.callGex, 0.85)
      );
    }

    if (level.putGex < 0) {
      const w = (Math.abs(level.putGex) / maxGex) * halfW;
      chart.groups.gexBars.add(
        chart._makePlane(centerX - w, barY, w, barH, COLORS.putGex, 0.85)
      );
    }
  }
}

export function buildVolumeBars(chart) {
  const s = chart._sectionBounds();
  if (!chart.gexLevels.length) return;

  const maxVol = Math.max(...chart.gexLevels.map(l => l.totalVolume), 1);
  const strikes = chart.gexLevels.map(l => l.strike).sort((a, b) => a - b);

  for (const level of chart.gexLevels) {
    if (!level.totalVolume) continue;
    const py = chart._priceToY(level.strike);
    if (py < s.bottom || py > s.top) continue;
    const { y: barY, h: barH } = chart._gexBarBounds(level.strike, strikes);

    const w = (level.totalVolume / maxVol) * s.volume.width * 0.9;
    chart.groups.volumeBars.add(
      chart._makePlane(s.volume.left + 2, barY, w, barH, COLORS.volume, 0.85)
    );

    if (level.totalVolume > 0 && level.totalOI > 0 && level.totalVolume > level.totalOI) {
      const r = Math.max(2, Math.min(barH * 0.3, 4));
      const geo = new THREE.CircleGeometry(r, 16);
      const mat = new THREE.MeshBasicMaterial({ color: COLORS.volumeAlert });
      const dot = new THREE.Mesh(geo, mat);
      dot.position.set(s.volume.left + 2 + w + r + 2, barY + barH / 2, 0);
      chart.groups.volumeBars.add(dot);
    }
  }
}

export function buildSeparators(chart) {
  const s = chart._sectionBounds();
  chart.groups.overlays.add(
    chart._makeLine(
      [[s.axis.right, 0], [s.axis.right, chart.height]],
      COLORS.separator, 0.6
    )
  );
  chart.groups.overlays.add(
    chart._makeLine(
      [[s.volume.left, 0], [s.volume.left, chart.height]],
      COLORS.separator, 0.6
    )
  );
}

export function buildPriceLine(chart) {
  if (!chart.spotPrice) return;
  const y = chart._priceToY(chart.spotPrice);
  const dashLen = 6;
  const gapLen = 4;
  const pts = [];
  for (let x = LAYOUT.marginLeft; x < chart.width; x += dashLen + gapLen) {
    pts.push([x, y], [Math.min(x + dashLen, chart.width), y]);
  }
  for (let i = 0; i < pts.length - 1; i += 2) {
    chart.groups.overlays.add(
      chart._makeLine([pts[i], pts[i + 1]], COLORS.priceLine, 0.8)
    );
  }
}
