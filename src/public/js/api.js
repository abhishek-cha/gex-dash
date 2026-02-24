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

/**
 * Opens an SSE stream to /api/stream/:symbol.
 *
 * @param {string} symbol
 * @param {{
 *   types: string[],
 *   chart: object,
 *   state: object,
 *   expirations?: Set<string>
 * }} opts
 * @returns {EventSource}
 */
export function openStream(symbol, { types, chart, state, expirations }) {
  const qs = new URLSearchParams({ types: types.join(','), ...getPriceParams() });
  if (expirations && expirations.size > 0) {
    qs.set('expirations', [...expirations].join(','));
  }

  const priceLoading = document.getElementById('loading-price');
  const gexLoading = document.getElementById('loading-gex');
  const wantsPrice = types.includes('price');
  const wantsGex = types.includes('gex');

  if (wantsPrice) priceLoading.style.display = 'block';
  if (wantsGex) gexLoading.style.display = 'block';

  const es = new EventSource(`/api/stream/${encodeURIComponent(symbol)}?${qs}`);

  es.addEventListener('price', (e) => {
    priceLoading.style.display = 'none';
    const priceData = JSON.parse(e.data);
    chart.loadPriceData(priceData);
  });

  es.addEventListener('gex', (e) => {
    gexLoading.style.display = 'none';
    const gexData = JSON.parse(e.data);
    applyGexHeader(gexData);
    chart.loadGEXData(gexData);
    if (gexData.selectedExpirations) {
      state.selectedExpirations = new Set(gexData.selectedExpirations);
      state.updateFilterButton();
    }
  });

  es.addEventListener('expirations', (e) => {
    const data = JSON.parse(e.data);
    if (data.expirationDates) {
      state.allExpirations = data.expirationDates;
      state.updateFilterButton();
    }
  });

  es.addEventListener('done', () => {
    priceLoading.style.display = 'none';
    gexLoading.style.display = 'none';
    es.close();
  });

  es.addEventListener('error', () => {
    priceLoading.style.display = 'none';
    gexLoading.style.display = 'none';
    es.close();
  });

  return es;
}
