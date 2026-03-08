import { FREQ_MAP, RANGE_MAP } from './chart/constants.js';
import { bus } from './chart/EventBus.js';

export async function checkAuth() {
  const res = await fetch('/auth/status');
  const data = await res.json();
  return data.authenticated;
}

export function getPriceParams(freqVal, rangeVal) {
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

let _activeStreamId = 0;

export function openStream(symbol, { types, viewport, priceParams, expirations }) {
  const streamId = _activeStreamId = Date.now();
  const stale = () => streamId !== _activeStreamId;

  const qs = new URLSearchParams({ types: types.join(','), ...priceParams });
  if (expirations && expirations.size > 0) {
    qs.set('expirations', [...expirations].join(','));
  }

  bus.emit('stream:start', { types });

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
    viewport.mergeGEXChunk(gexData);
    bus.emit('data:gex-chunk', gexData);
  });

  es.addEventListener('expirations', (e) => {
    if (stale()) return;
    const data = JSON.parse(e.data);
    if (data.expirationDates) {
      bus.emit('data:expirations', data.expirationDates);
    }
  });

  es.addEventListener('done', (e) => {
    if (stale()) return;
    const data = JSON.parse(e.data);
    if (data.type === 'price' && pendingPrice) {
      viewport.loadPriceData(pendingPrice);
      pendingPrice = null;
      bus.emit('done:price');
    } else if (data.type === 'quote' && pendingQuote) {
      viewport.setSpotPrice(pendingQuote.price || 0);
      bus.emit('data:quote', { symbol, quote: pendingQuote });
      bus.emit('viewport:change');
      pendingQuote = null;
    } else if (data.type === 'gex') {
      viewport.commitGEX();
      bus.emit('viewport:change');
      bus.emit('done:gex');
    } else if (data.type === 'expiration') {
      bus.emit('done:expiration');
    } else if (!data.type) {
      bus.emit('stream:end');
      es.close();
    }
  });

  es.addEventListener('error', () => {
    if (stale()) return;
    bus.emit('stream:error');
    es.close();
  });

  return es;
}
