export function updateLabels(chart) {
  const overlay = document.getElementById('labels-overlay');
  overlay.innerHTML = '';
  const s = chart._sectionBounds();

  const range = chart.viewPriceMax - chart.viewPriceMin;
  const step = chart._niceStep(range, 10);
  const startP = Math.ceil(chart.viewPriceMin / step) * step;

  for (let p = startP; p <= chart.viewPriceMax; p += step) {
    const y = chart.height - chart._priceToY(p);
    const lbl = document.createElement('div');
    lbl.className = 'price-label';
    lbl.style.top = y - 6 + 'px';
    lbl.style.left = s.axis.left + 4 + 'px';
    lbl.textContent = p.toFixed(p >= 1000 ? 0 : 2);
    overlay.appendChild(lbl);
  }

  if (chart.spotPrice) {
    const y = chart.height - chart._priceToY(chart.spotPrice);
    const tag = document.createElement('div');
    tag.className = 'current-price-tag';
    tag.style.top = y - 8 + 'px';
    tag.style.left = s.axis.left + 2 + 'px';
    tag.textContent = chart.spotPrice.toFixed(2);
    overlay.appendChild(tag);
  }

  const visCount = chart.viewEndIdx - chart.viewStartIdx;
  const labelEvery = Math.max(1, Math.floor(visCount / 10));
  const labelStart = Math.max(0, Math.floor(chart.viewStartIdx));
  const labelEnd = Math.min(chart.priceData.length, Math.ceil(chart.viewEndIdx));
  for (let i = labelStart; i < labelEnd; i += labelEvery) {
    const c = chart.priceData[i];
    if (!c) continue;
    const x = chart._idxToX(i + 0.5);
    const lbl = document.createElement('div');
    lbl.className = 'date-label';
    lbl.style.left = x + 'px';
    const d = c.date;
    lbl.textContent = `${d.getMonth() + 1}/${d.getDate()}`;
    overlay.appendChild(lbl);
  }

  const gexLabel = document.createElement('div');
  gexLabel.className = 'section-label';
  gexLabel.style.left = s.gex.left + 8 + 'px';
  gexLabel.textContent = 'CALL / PUT GEX';
  overlay.appendChild(gexLabel);

  const netLabel = document.createElement('div');
  netLabel.className = 'section-label';
  netLabel.style.left = s.netGex.left + 4 + 'px';
  netLabel.textContent = 'NET GEX';
  overlay.appendChild(netLabel);

  if (chart.gexLevels.length > 0) {
    addGexScale(chart, overlay, s);
    addNetGexScale(chart, overlay, s);
  } else {
    for (const [sec, text] of [[s.gex, 'Loading GEX...'], [s.netGex, 'Loading...']]) {
      const lbl = document.createElement('div');
      lbl.className = 'gex-loading-label';
      lbl.style.left = sec.left + sec.width / 2 + 'px';
      lbl.style.top = '50%';
      lbl.textContent = text;
      overlay.appendChild(lbl);
    }
  }
}

function addGexScale(chart, overlay, s) {
  const maxCallGex = Math.max(...chart.gexLevels.map(l => Math.abs(l.callGex)), 1);
  const maxPutGex = Math.max(...chart.gexLevels.map(l => Math.abs(l.putGex)), 1);
  const maxGex = Math.max(maxCallGex, maxPutGex);
  const halfW = s.gex.width / 2;
  const centerX = s.gex.left + halfW;
  const ticks = 3;
  const scaleStep = chart._niceStep(maxGex, ticks);

  const zeroLbl = document.createElement('div');
  zeroLbl.className = 'gex-scale-label';
  zeroLbl.style.left = centerX + 'px';
  zeroLbl.textContent = '0';
  overlay.appendChild(zeroLbl);

  for (let v = scaleStep; v <= maxGex * 1.05; v += scaleStep) {
    const frac = v / maxGex;
    if (frac > 1.05) break;

    const rx = centerX + frac * halfW;
    if (rx < s.gex.right - 5) {
      const rl = document.createElement('div');
      rl.className = 'gex-scale-label';
      rl.style.left = rx + 'px';
      rl.style.color = '#4caf50';
      rl.textContent = chart._fmtGex(v);
      overlay.appendChild(rl);
    }

    const lx = centerX - frac * halfW;
    if (lx > s.gex.left + 5) {
      const ll = document.createElement('div');
      ll.className = 'gex-scale-label';
      ll.style.left = lx + 'px';
      ll.style.color = '#f44336';
      ll.textContent = chart._fmtGex(v);
      overlay.appendChild(ll);
    }
  }
}

function addNetGexScale(chart, overlay, s) {
  const maxNet = Math.max(...chart.gexLevels.map(l => Math.abs(l.netGex)), 1);
  const ticks = 2;
  const scaleStep = chart._niceStep(maxNet, ticks);
  const usableW = s.netGex.width * 0.9;

  const zLbl = document.createElement('div');
  zLbl.className = 'gex-scale-label';
  zLbl.style.left = s.netGex.left + 2 + 'px';
  zLbl.style.transform = 'none';
  zLbl.textContent = '0';
  overlay.appendChild(zLbl);

  for (let v = scaleStep; v <= maxNet * 1.05; v += scaleStep) {
    const frac = v / maxNet;
    if (frac > 1.05) break;
    const x = s.netGex.left + 2 + frac * usableW;
    if (x < s.netGex.right - 10) {
      const lbl = document.createElement('div');
      lbl.className = 'gex-scale-label';
      lbl.style.left = x + 'px';
      lbl.textContent = chart._fmtGex(v);
      overlay.appendChild(lbl);
    }
  }
}
