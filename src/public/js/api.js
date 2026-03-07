import { FREQ_MAP, RANGE_MAP } from './chart/constants.js';
import { buildPriceLine } from './chart/renderers.js';
import { updateWatchlistQuote } from './watchlist.js';

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

export function applyQuote(quoteData, chart) {
  const price = quoteData.price || 0;
  const change = quoteData.change || 0;
  const pctChange = quoteData.percentChange || 0;

  document.getElementById('hdr-price').textContent = '$' + price.toFixed(2);
  const changeEl = document.getElementById('hdr-change');
  const sign = change >= 0 ? '+' : '';
  changeEl.textContent = `${sign}${change.toFixed(2)} (${sign}${pctChange.toFixed(2)}%)`;
  changeEl.className = 'change ' + (change >= 0 ? 'up' : 'down');

  chart.setSpotPrice(price);
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
let _activeStreamId = 0;

export function openStream(symbol, { types, chart, state, expirations }) {
  const streamId = _activeStreamId = Date.now();
  const stale = () => streamId !== _activeStreamId;

  const qs = new URLSearchParams({ types: types.join(','), ...getPriceParams() });
  if (expirations && expirations.size > 0) {
    qs.set('expirations', [...expirations].join(','));
  }

  const priceLoading = document.getElementById('loading-price');
  const gexLoading = document.getElementById('loading-gex');
  const wantsPrice = types.includes('price');
  const wantsGex = types.includes('gex');

  if (wantsPrice) priceLoading.style.display = 'block';
  if (wantsGex) {
    gexLoading.style.display = 'block';
  }

  const es = new EventSource(`/api/stream/${encodeURIComponent(symbol)}?${qs}`);

  let pendingPrice = null;
  let pendingQuote = null;

  es.addEventListener('price', (e) => {
    if (stale()) return;
    pendingPrice = JSON.parse(e.data);
  });

  es.addEventListener('quote', (e) => {
    if (stale()) return;
    pendingQuote = JSON.parse(e.data);
  });

  es.addEventListener('gex', (e) => {
    if (stale()) return;
    const gexData = JSON.parse(e.data);
    chart.mergeGEXChunk(gexData);
    if (gexData.selectedExpirations) {
      for (const d of gexData.selectedExpirations) state.selectedExpirations.add(d);
    }
  });

  es.addEventListener('expirations', (e) => {
    if (stale()) return;
    const data = JSON.parse(e.data);
    if (data.expirationDates) {
      state.allExpirations = data.expirationDates;
    }
  });

  es.addEventListener('done', (e) => {
    if (stale()) return;
    const data = JSON.parse(e.data);
    if (data.type === 'price' && pendingPrice) {
      priceLoading.style.display = 'none';
      chart.loadPriceData(pendingPrice);
      pendingPrice = null;
      // If GEX is also streaming, only rebuild price — GEX will
      // reposition on its own done event using the updated scale.
      // Otherwise rebuild everything so existing GEX bars match the new scale.
      wantsGex ? chart.rebuildPrice() : chart.rebuild();
    } else if (data.type === 'quote' && pendingQuote) {
      applyQuote(pendingQuote, chart);
      updateWatchlistQuote(symbol, pendingQuote);
      pendingQuote = null;
      buildPriceLine(chart);
    } else if (data.type === 'gex') {
      gexLoading.style.display = 'none';
      chart.commitGEX();
      chart.rebuildGEX();
      state.updateFilterButton();
    } else if (data.type === 'expiration') {
      state.updateFilterButton();
    } else if (!data.type) {
      priceLoading.style.display = 'none';
      gexLoading.style.display = 'none';
      es.close();
    }
  });

  es.addEventListener('error', () => {
    if (stale()) return;
    priceLoading.style.display = 'none';
    gexLoading.style.display = 'none';
    es.close();
  });

  return es;
}
