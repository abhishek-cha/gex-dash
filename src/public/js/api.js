import { FREQ_MAP, RANGE_MAP } from './chart/constants.js';

export async function checkAuth() {
  const res = await fetch('/auth/status');
  const data = await res.json();
  return data.authenticated;
}

export function getPriceParams() {
  const freqVal = document.getElementById('freq-select').value;
  const rangeVal = document.getElementById('range-select').value;
  const freq = FREQ_MAP[freqVal] || FREQ_MAP['1D'];
  const range = RANGE_MAP[rangeVal] || RANGE_MAP['1Y'];

  if (freq.frequencyType === 'minute') {
    const dayPeriods = { '5D': 5, '1M': 10, '3M': 10, '6M': 10, 'YTD': 10, '1Y': 10, '2Y': 10, '5Y': 10, '10Y': 10, '20Y': 10 };
    return { ...freq, periodType: 'day', period: String(dayPeriods[rangeVal] || 10) };
  }
  if (freq.frequencyType === 'monthly' && range.periodType !== 'year') {
    return { ...freq, periodType: 'year', period: '1' };
  }
  return { ...freq, ...range };
}

export function applyGexHeader(gexData) {
  const underlying = gexData.underlying || {};
  const price = gexData.underlyingPrice || underlying.last || 0;
  const change = underlying.change || 0;
  const pctChange = underlying.percentChange || 0;

  document.getElementById('hdr-price').textContent = '$' + price.toFixed(2);
  const changeEl = document.getElementById('hdr-change');
  const sign = change >= 0 ? '+' : '';
  changeEl.textContent = `${sign}${change.toFixed(2)} (${sign}${pctChange.toFixed(2)}%)`;
  changeEl.className = 'change ' + (change >= 0 ? 'up' : 'down');
}

export async function loadPrice(symbol, chart) {
  const loading = document.getElementById('loading');
  const params = getPriceParams();
  const qs = new URLSearchParams(params).toString();

  loading.style.display = 'block';
  loading.textContent = `Loading ${symbol} price...`;

  try {
    const res = await fetch(`/api/price/${encodeURIComponent(symbol)}?${qs}`);
    if (res.status === 401) { window.location.href = '/auth/login'; return; }
    if (!res.ok) throw new Error('Price API error');
    const priceData = await res.json();
    loading.style.display = 'none';
    chart.loadPriceData(priceData);
  } catch (err) {
    loading.textContent = 'Failed to load price data.';
    console.error('Price load error:', err);
  }
}

/**
 * @param {string} symbol
 * @param {object} chart - GEXChart instance
 * @param {object} state - { allExpirations, selectedExpirations, updateExpirationsFromData }
 * @param {{ useFilter?: boolean }} options
 */
export async function loadGEX(symbol, chart, state, { useFilter = false } = {}) {
  try {
    let url = `/api/gex/${encodeURIComponent(symbol)}`;
    if (useFilter && state.selectedExpirations.size > 0 && state.selectedExpirations.size < state.allExpirations.length) {
      url += `?expirations=${[...state.selectedExpirations].join(',')}`;
    }
    const res = await fetch(url);
    if (res.status === 401) return;
    if (!res.ok) throw new Error('GEX API error');

    if (useFilter) {
      const gexData = await res.json();
      applyGexHeader(gexData);
      if (gexData.expirationDates) {
        state.allExpirations = gexData.expirationDates;
        state.updateFilterButton();
      }
      chart.loadGEXData(gexData);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstChunkApplied = false;

    while (true) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;

        const chunk = JSON.parse(line);
        if (chunk.done) break;

        if (!firstChunkApplied && chunk.gexLevels) {
          applyGexHeader(chunk);
          chart.loadGEXData(chunk);
          firstChunkApplied = true;
        }

        if (chunk.expirationDates) {
          state.updateExpirationsFromData(chunk.expirationDates);
        }
      }
    }
  } catch (err) {
    console.error('GEX load error:', err);
  }
}
