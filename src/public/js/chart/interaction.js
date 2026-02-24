import { LAYOUT } from './constants.js';

export function setupInteraction(chart) {
  const el = chart.container;
  const chH = document.getElementById('crosshair-h');
  const chV = document.getElementById('crosshair-v');
  const chPrice = document.getElementById('crosshair-price');
  const tooltip = document.getElementById('tooltip');

  chart._axisDrag = { active: false, startY: 0, startPriceMin: 0, startPriceMax: 0, anchorFrac: 0 };
  chart._chartDrag = { active: false, startX: 0, startY: 0, startViewStart: 0, startViewEnd: 0, startPriceMin: 0, startPriceMax: 0 };
  chart._xAxisDrag = { active: false, startX: 0, startViewStart: 0, startViewEnd: 0, anchorFrac: 0 };
  chart._manualYScale = false;

  el.addEventListener('mousedown', (e) => {
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const s = chart._sectionBounds();
    const inXAxis = my > (chart.height - LAYOUT.marginBottom) && mx >= s.candle.left && mx <= s.candle.right;

    if (inXAxis) {
      e.preventDefault();
      chart._xAxisDrag.active = true;
      chart._xAxisDrag.startX = e.clientX;
      chart._xAxisDrag.startViewStart = chart.viewStartIdx;
      chart._xAxisDrag.startViewEnd = chart.viewEndIdx;
      chart._xAxisDrag.anchorFrac = (mx - s.candle.left) / s.candle.width;
      el.style.cursor = 'ew-resize';
    } else if (mx >= s.axis.left && mx <= s.axis.right) {
      e.preventDefault();
      chart._axisDrag.active = true;
      chart._axisDrag.startY = e.clientY;
      chart._axisDrag.startPriceMin = chart.viewPriceMin;
      chart._axisDrag.startPriceMax = chart.viewPriceMax;
      chart._axisDrag.anchorFrac = 1 - (my / chart.height);
      chart._manualYScale = true;
      el.style.cursor = 'ns-resize';
    } else if (mx >= s.candle.left && mx <= s.candle.right) {
      e.preventDefault();
      chart._chartDrag.active = true;
      chart._chartDrag.startX = e.clientX;
      chart._chartDrag.startY = e.clientY;
      chart._chartDrag.startViewStart = chart.viewStartIdx;
      chart._chartDrag.startViewEnd = chart.viewEndIdx;
      chart._chartDrag.startPriceMin = chart.viewPriceMin;
      chart._chartDrag.startPriceMax = chart.viewPriceMax;
      chart._manualYScale = true;
      el.style.cursor = 'grabbing';
      tooltip.style.display = 'none';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (chart._axisDrag.active) {
      const dy = e.clientY - chart._axisDrag.startY;
      const s = chart._sectionBounds();
      const origRange = chart._axisDrag.startPriceMax - chart._axisDrag.startPriceMin;
      const zoomFactor = Math.pow(2, dy / (s.chartH * 0.5));
      let newRange = Math.max(1, origRange * zoomFactor);

      const anchorPrice = chart._axisDrag.startPriceMin + chart._axisDrag.anchorFrac * origRange;
      chart.viewPriceMin = anchorPrice - chart._axisDrag.anchorFrac * newRange;
      chart.viewPriceMax = anchorPrice + (1 - chart._axisDrag.anchorFrac) * newRange;

      chart.rebuild();
      return;
    }

    if (chart._chartDrag.active) {
      const s = chart._sectionBounds();
      const dx = e.clientX - chart._chartDrag.startX;
      const dy = e.clientY - chart._chartDrag.startY;
      const visCount = chart._chartDrag.startViewEnd - chart._chartDrag.startViewStart;

      const idxShift = -(dx / s.candle.width) * visCount;
      chart.viewStartIdx = chart._chartDrag.startViewStart + idxShift;
      chart.viewEndIdx = chart._chartDrag.startViewEnd + idxShift;

      const priceRange = chart._chartDrag.startPriceMax - chart._chartDrag.startPriceMin;
      const priceShift = (dy / s.chartH) * priceRange;
      chart.viewPriceMin = chart._chartDrag.startPriceMin + priceShift;
      chart.viewPriceMax = chart._chartDrag.startPriceMax + priceShift;

      chart.rebuild();
      return;
    }

    if (chart._xAxisDrag.active) {
      const s = chart._sectionBounds();
      const dx = e.clientX - chart._xAxisDrag.startX;
      const origCount = chart._xAxisDrag.startViewEnd - chart._xAxisDrag.startViewStart;
      const anchorIdx = chart._xAxisDrag.startViewStart + chart._xAxisDrag.anchorFrac * origCount;
      const zoomFactor = Math.pow(2, dx / (s.candle.width * 0.5));
      const newCount = Math.max(5, origCount * zoomFactor);

      chart.viewStartIdx = anchorIdx - chart._xAxisDrag.anchorFrac * newCount;
      chart.viewEndIdx = anchorIdx + (1 - chart._xAxisDrag.anchorFrac) * newCount;

      chart.rebuild();
      return;
    }

    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (mx >= 0 && mx <= chart.width && my >= 0 && my <= chart.height) {
      const s = chart._sectionBounds();
      const inXAxis = my > (chart.height - LAYOUT.marginBottom) && mx >= s.candle.left && mx <= s.candle.right;
      if (inXAxis) {
        el.style.cursor = 'ew-resize';
      } else if (mx >= s.axis.left && mx <= s.axis.right) {
        el.style.cursor = 'ns-resize';
      } else if (mx >= s.candle.left && mx <= s.candle.right) {
        el.style.cursor = 'grab';
      } else {
        el.style.cursor = '';
      }

      chH.style.display = 'block';
      chV.style.display = 'block';
      chH.style.top = my + 'px';
      chV.style.left = mx + 'px';

      const price = chart._yToPrice(chart.height - my);

      chPrice.style.display = 'block';
      chPrice.style.top = my + 'px';
      chPrice.style.left = s.axis.left + 2 + 'px';
      chPrice.textContent = price.toFixed(price >= 1000 ? 0 : 2);

      if (mx >= s.candle.left && mx <= s.candle.right) {
        const visCount = chart.viewEndIdx - chart.viewStartIdx;
        const idx = Math.floor(
          chart.viewStartIdx + ((mx - s.candle.left) / s.candle.width) * visCount
        );
        const c = chart.priceData[idx];
        if (c) {
          tooltip.style.display = 'block';
          tooltip.style.left = (mx + 12) + 'px';
          tooltip.style.top = (my - 10) + 'px';
          const d = c.date;
          let html =
            `<div>${d.toLocaleDateString()}</div>` +
            `<div>O: ${c.open.toFixed(2)}&nbsp; H: ${c.high.toFixed(2)}</div>` +
            `<div>L: ${c.low.toFixed(2)}&nbsp; C: ${c.close.toFixed(2)}</div>` +
            `<div>Vol: ${(c.volume / 1e6).toFixed(1)}M</div>`;
          const nearest = chart._nearestGexLevel(price);
          if (nearest) {
            html +=
              `<div style="border-top:1px solid #30363d;margin-top:4px;padding-top:4px">Strike: ${nearest.strike}</div>` +
              `<div style="color:#4caf50">Call GEX: ${chart._fmtGex(nearest.callGex)}</div>` +
              `<div style="color:#f44336">Put GEX: ${chart._fmtGex(nearest.putGex)}</div>` +
              `<div style="color:#00bcd4">Net GEX: ${chart._fmtGex(nearest.netGex)}</div>`;
          }
          tooltip.innerHTML = html;
        }
      } else if (mx >= s.gex.left && mx <= s.netGex.right) {
        const nearest = chart._nearestGexLevel(price);
        if (nearest) {
          tooltip.style.display = 'block';
          tooltip.style.left = (mx + 12) + 'px';
          tooltip.style.top = (my - 10) + 'px';
          tooltip.innerHTML =
            `<div>Strike: ${nearest.strike}</div>` +
            `<div style="color:#4caf50">Call GEX: ${chart._fmtGex(nearest.callGex)}</div>` +
            `<div style="color:#f44336">Put GEX: ${chart._fmtGex(nearest.putGex)}</div>` +
            `<div style="color:#00bcd4">Net GEX: ${chart._fmtGex(nearest.netGex)}</div>`;
        }
      } else {
        tooltip.style.display = 'none';
      }
    } else {
      chH.style.display = 'none';
      chV.style.display = 'none';
      chPrice.style.display = 'none';
      tooltip.style.display = 'none';
      if (!chart._axisDrag.active && !chart._chartDrag.active && !chart._xAxisDrag.active) el.style.cursor = '';
    }
  });

  window.addEventListener('mouseup', () => {
    if (chart._axisDrag.active) {
      chart._axisDrag.active = false;
      el.style.cursor = '';
    }
    if (chart._chartDrag.active) {
      chart._chartDrag.active = false;
      el.style.cursor = '';
    }
    if (chart._xAxisDrag.active) {
      chart._xAxisDrag.active = false;
      el.style.cursor = '';
    }
  });

  el.addEventListener('dblclick', (e) => {
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const s = chart._sectionBounds();
    if (mx >= s.axis.left && mx <= s.axis.right) {
      chart._manualYScale = false;
      chart._autoFitY();
      chart.rebuild();
    } else if (mx >= s.candle.left && mx <= s.candle.right) {
      chart._manualYScale = false;
      chart.viewStartIdx = 0;
      chart.viewEndIdx = chart.priceData.length;
      chart._autoFitY();
      chart.rebuild();
    }
  });

  el.addEventListener('mouseleave', () => {
    if (!chart._axisDrag.active && !chart._chartDrag.active && !chart._xAxisDrag.active) {
      chH.style.display = 'none';
      chV.style.display = 'none';
      chPrice.style.display = 'none';
      tooltip.style.display = 'none';
    }
  });

  el.addEventListener('wheel', (e) => {
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const s = chart._sectionBounds();
    const inCandle = mx >= s.candle.left && mx <= s.candle.right && my <= (chart.height - LAYOUT.marginBottom);
    if (!inCandle) return;

    e.preventDefault();
    const zoomFactor = Math.pow(1.03, e.deltaY > 0 ? 1 : -1);

    const anchorFrac = (mx - s.candle.left) / s.candle.width;
    const visCount = chart.viewEndIdx - chart.viewStartIdx;
    const anchorIdx = chart.viewStartIdx + anchorFrac * visCount;
    const newCount = Math.max(5, visCount * zoomFactor);
    chart.viewStartIdx = anchorIdx - anchorFrac * newCount;
    chart.viewEndIdx = anchorIdx + (1 - anchorFrac) * newCount;

    const priceFrac = 1 - (my - (chart.height - s.top)) / s.chartH;
    const priceRange = chart.viewPriceMax - chart.viewPriceMin;
    const anchorPrice = chart.viewPriceMin + priceFrac * priceRange;
    const newRange = Math.max(0.01, priceRange * zoomFactor);
    chart.viewPriceMin = anchorPrice - priceFrac * newRange;
    chart.viewPriceMax = anchorPrice + (1 - priceFrac) * newRange;
    chart._manualYScale = true;

    chart.rebuild();
  }, { passive: false });
}
