import * as THREE from 'three';
import { checkAuth, openStream, getPriceParams } from '/js/api.js';
import { bus } from '/js/chart/EventBus.js';
import { ViewportModel } from '/js/chart/ViewportModel.js';
import { PriceChart } from '/js/chart/PriceChart.js';
import { GEXSection } from '/js/chart/GEXSection.js';
import { VolumeSection } from '/js/chart/VolumeSection.js';
import { setupWatchlistReorder } from '/mobile/touch.js';

const state = {
  currentSymbol: null,
  activeStream: null,
  activeFreq: '1D',
  activeRange: '1M',
  allExpirations: [],
  selectedExpirations: new Set(),
  gexPanelOpen: false,
  gexMode: 'gex',

  closeStream() {
    if (this.activeStream) {
      this.activeStream.close();
      this.activeStream = null;
    }
  },
};

let viewport = null;
let priceChart = null;
let gexSection = null;
let volumeSection = null;

function switchTab(tab) {
  document.querySelectorAll('.tab-view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
}

function initChart() {
  if (viewport) return;
  viewport = new ViewportModel();

  const priceWrap = document.getElementById('chart-price-wrap');
  const gexContainer = document.getElementById('gex-chart-container');

  const gexInner = document.createElement('div');
  gexInner.id = 'gex-inner';
  gexInner.style.cssText = 'position:absolute;inset:0;';
  gexContainer.appendChild(gexInner);

  const volInner = document.createElement('div');
  volInner.id = 'vol-inner';
  volInner.style.cssText = 'position:absolute;inset:0;display:none;';
  gexContainer.appendChild(volInner);

  priceChart = new PriceChart(priceWrap, viewport);
  gexSection = new GEXSection(gexInner, viewport);
  volumeSection = new VolumeSection(volInner, viewport);

  // Override chart backgrounds to pure black for mobile
  const black = new THREE.Color(0x000000);
  priceChart.scene.background = black;
  gexSection.scene.background = black;
  volumeSection.scene.background = black;
}

function updateGexMode() {
  const gexInner = document.getElementById('gex-inner');
  const volInner = document.getElementById('vol-inner');
  if (!gexInner || !volInner) return;

  if (state.gexMode === 'gex') {
    gexInner.style.display = '';
    volInner.style.display = 'none';
  } else {
    gexInner.style.display = 'none';
    volInner.style.display = '';
  }
}

function toggleGexPanel() {
  state.gexPanelOpen = !state.gexPanelOpen;
  const gexWrap = document.getElementById('chart-gex-wrap');
  const arrow = document.getElementById('gex-toggle-arrow');

  if (state.gexPanelOpen) {
    gexWrap.classList.remove('collapsed');
    gexWrap.classList.add('expanded');
    arrow.classList.remove('collapsed');
    arrow.classList.add('expanded');
    arrow.textContent = '›';
  } else {
    gexWrap.classList.remove('expanded');
    gexWrap.classList.add('collapsed');
    arrow.classList.remove('expanded');
    arrow.classList.add('collapsed');
    arrow.textContent = '‹';
  }
}

function loadSymbol(symbol) {
  state.currentSymbol = symbol;
  state.closeStream();
  initChart();

  state.allExpirations = [];
  state.selectedExpirations = new Set();

  document.getElementById('chart-name').textContent = symbol;
  // Scroll symbol picker to active symbol
  if (symbolPicker) {
    const allSymbols = watchlistData.flatMap((s) => s.symbols);
    const idx = allSymbols.indexOf(symbol);
    if (idx >= 0) symbolPicker.scrollTo(idx);
  }
  document.getElementById('chart-price').textContent = '--';
  document.getElementById('chart-change').textContent = '--';
  document.getElementById('chart-change').className = '';

  viewport.clearPrice();
  viewport.clearGEX();
  bus.emit('viewport:change');

  const priceParams = getPriceParams(state.activeFreq, state.activeRange);
  state.activeStream = openStream(symbol, {
    types: ['price', 'gex', 'quote', 'expiration'],
    viewport,
    priceParams,
  });

  switchTab('chart');
}

function setupBus() {
  bus.on('data:quote', ({ symbol, quote }) => {
    if (symbol !== state.currentSymbol) return;
    const price = quote.price || 0;
    const change = quote.change || 0;
    const pct = quote.percentChange || 0;

    if (quote.description) {
      document.getElementById('chart-name').textContent = quote.description;
    }
    document.getElementById('chart-price').textContent = price.toFixed(2);
    const sign = change >= 0 ? '+' : '';
    document.getElementById('chart-change').textContent = `${sign}${pct.toFixed(2)}%`;
    document.getElementById('chart-change').className = change >= 0 ? 'up' : 'down';

    updateWatchlistRowQuote(symbol, quote);
  });

  bus.on('data:gex-chunk', (gexData) => {
    if (gexData.selectedExpirations) {
      for (const d of gexData.selectedExpirations) state.selectedExpirations.add(d);
    }
  });

  bus.on('data:expirations', (expirationDates) => {
    state.allExpirations = expirationDates;
  });
}

let watchlistData = [];
let watchlistQuotes = new Map();

async function loadWatchlist() {
  try {
    const res = await fetch('/api/watchlist');
    watchlistData = await res.json();
  } catch {
    watchlistData = [];
  }
  renderWatchlist();
  populateSymbolScroller();
  openWatchlistStreams();
}

function renderWatchlist() {
  const container = document.getElementById('wl-sections');
  container.innerHTML = '';

  for (const section of watchlistData) {
    const header = document.createElement('div');
    header.className = 'wl-section-header';
    header.textContent = section.name;
    container.appendChild(header);

    for (const sym of section.symbols) {
      const row = createWatchlistRow(sym);
      container.appendChild(row);
    }
  }
}

function createWatchlistRow(symbol) {
  const row = document.createElement('div');
  row.className = 'wl-row';
  row.dataset.symbol = symbol;

  const quote = watchlistQuotes.get(symbol);
  const price = quote ? quote.price.toFixed(2) : '--';
  const name = quote ? (quote.description || '') : '';
  const change = quote ? quote.change : null;
  const pct = quote ? quote.percentChange : null;

  let changeClass = '';
  let changeText = '--';
  if (change !== null) {
    changeClass = change >= 0 ? 'up' : 'down';
    const sign = change >= 0 ? '+' : '';
    changeText = `${sign}${change.toFixed(2)} ${sign}${pct.toFixed(2)}%`;
  }

  row.innerHTML = `
    <div class="wl-row-top">
      <span class="ticker">${symbol}</span>
      <span class="price">${price}</span>
    </div>
    <div class="wl-row-bottom">
      <span class="name">${name}</span>
      <span class="change ${changeClass}">${changeText}</span>
    </div>
  `;

  row.addEventListener('click', () => loadSymbol(symbol));
  return row;
}

function updateWatchlistRowQuote(symbol, quote) {
  watchlistQuotes.set(symbol, quote);
  const row = document.querySelector(`.wl-row[data-symbol="${CSS.escape(symbol)}"]`);
  if (!row) return;

  row.querySelector('.price').textContent = (quote.price || 0).toFixed(2);
  row.querySelector('.name').textContent = quote.description || '';

  const changeEl = row.querySelector('.change');
  const chg = quote.change || 0;
  const pct = quote.percentChange || 0;
  const sign = chg >= 0 ? '+' : '';
  changeEl.textContent = `${sign}${chg.toFixed(2)} ${sign}${pct.toFixed(2)}%`;
  changeEl.className = `change ${chg >= 0 ? 'up' : 'down'}`;
}

let watchlistPollTimer = null;

function openWatchlistStreams() {
  closeWatchlistStreams();
  fetchAllQuotes();
  watchlistPollTimer = setInterval(fetchAllQuotes, 30000);
}

function fetchAllQuotes() {
  const allSymbols = watchlistData.flatMap((s) => s.symbols);
  for (const sym of allSymbols) {
    const es = new EventSource(`/api/stream/${encodeURIComponent(sym)}?types=quote`);
    es.addEventListener('quote', (e) => {
      const quote = JSON.parse(e.data);
      watchlistQuotes.set(sym, quote);
    });
    es.addEventListener('done', (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'quote') {
        const quote = watchlistQuotes.get(sym);
        if (quote) updateWatchlistRowQuote(sym, quote);
      }
      if (!data.type) es.close();
    });
    es.addEventListener('error', () => es.close());
  }
}

function closeWatchlistStreams() {
  if (watchlistPollTimer) {
    clearInterval(watchlistPollTimer);
    watchlistPollTimer = null;
  }
}

function showBottomSheet(content) {
  const sheet = document.getElementById('bottom-sheet');
  const body = document.getElementById('sheet-body');
  body.innerHTML = content;
  sheet.classList.remove('hidden');
  setupSheetSwipeDismiss();
}

function hideBottomSheet() {
  const sheet = document.getElementById('bottom-sheet');
  const sheetContent = sheet.querySelector('.sheet-content');
  sheetContent.style.transform = '';
  sheet.classList.add('hidden');
}

function setupSheetSwipeDismiss() {
  const sheet = document.getElementById('bottom-sheet');
  const content = sheet.querySelector('.sheet-content');
  let startY = 0;
  let currentY = 0;

  content.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    content.style.transition = 'none';
  }, { passive: true });

  content.addEventListener('touchmove', (e) => {
    currentY = e.touches[0].clientY;
    const dy = currentY - startY;
    if (dy > 0) {
      content.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: true });

  content.addEventListener('touchend', () => {
    content.style.transition = 'transform 0.2s ease';
    const dy = currentY - startY;
    if (dy > 80) {
      content.style.transform = `translateY(100%)`;
      setTimeout(hideBottomSheet, 200);
    } else {
      content.style.transform = '';
    }
    startY = 0;
    currentY = 0;
  });
}

function showAddMenu() {
  showBottomSheet(`
    <div class="sheet-option" id="sheet-add-symbol">Add Symbol</div>
    <div class="sheet-option" id="sheet-add-section">New Section</div>
  `);
  document.getElementById('sheet-add-symbol').addEventListener('click', showAddSymbolForm);
  document.getElementById('sheet-add-section').addEventListener('click', showAddSectionForm);
}

function showAddSymbolForm() {
  const sectionOptions = watchlistData.map((s, i) =>
    `<div class="sheet-option" data-idx="${i}">${s.name}</div>`
  ).join('');

  showBottomSheet(`
    <h3>Add Symbol</h3>
    <input type="text" id="sheet-symbol-input" placeholder="Ticker (e.g. AAPL)" autocapitalize="characters" />
    <p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Add to section:</p>
    ${sectionOptions}
  `);

  const input = document.getElementById('sheet-symbol-input');
  input.focus();

  document.querySelectorAll('#sheet-body .sheet-option').forEach((opt) => {
    opt.addEventListener('click', async () => {
      const sym = input.value.trim().toUpperCase();
      if (!sym) return;
      const idx = parseInt(opt.dataset.idx);
      const section = watchlistData[idx];
      await fetch(`/api/watchlist/${encodeURIComponent(section.name)}/${encodeURIComponent(sym)}`, { method: 'POST' });
      hideBottomSheet();
      await loadWatchlist();
    });
  });
}

function showAddSectionForm() {
  showBottomSheet(`
    <h3>New Section</h3>
    <input type="text" id="sheet-section-input" placeholder="Section name" />
    <button class="sheet-action" id="sheet-create-section">Create</button>
  `);

  const input = document.getElementById('sheet-section-input');
  input.focus();

  document.getElementById('sheet-create-section').addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) return;
    watchlistData.push({ name, symbols: [] });
    await fetch('/api/watchlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(watchlistData),
    });
    hideBottomSheet();
    renderWatchlist();
  });
}

function reloadPrice() {
  if (!state.currentSymbol) return;
  state.closeStream();
  const priceParams = getPriceParams(state.activeFreq, state.activeRange);
  state.activeStream = openStream(state.currentSymbol, {
    types: ['price'],
    viewport,
    priceParams,
  });
}

const FREQ_OPTIONS = ['5m', '15m', '30m', '1D', '1W', '1M'];
const RANGE_OPTIONS = ['5D', '1M', '3M', '6M', '1Y', '2Y', '5Y'];

function createPickerWheel(container, items, activeValue, onChange) {
  const ITEM_H = 18;
  let activeIdx = items.indexOf(activeValue);
  if (activeIdx < 0) activeIdx = 0;

  const track = document.createElement('div');
  track.className = 'picker-track';

  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'picker-item';
    el.textContent = item;
    if (item === activeValue) el.classList.add('active');
    track.appendChild(el);
  }

  container.innerHTML = '';
  container.appendChild(track);

  function scrollTo(idx) {
    idx = Math.max(0, Math.min(items.length - 1, idx));
    activeIdx = idx;
    const offset = -(idx * ITEM_H) + ITEM_H * 0.5;
    track.style.transform = `translateY(${offset}px)`;
    track.querySelectorAll('.picker-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });
  }

  scrollTo(activeIdx);

  let startY = 0;
  let startIdx = 0;

  container.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    startIdx = activeIdx;
    track.style.transition = 'none';
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    const dy = startY - e.touches[0].clientY;
    const idxOffset = Math.round(dy / ITEM_H);
    const newIdx = Math.max(0, Math.min(items.length - 1, startIdx + idxOffset));
    const offset = -(newIdx * ITEM_H) + ITEM_H * 0.5;
    track.style.transform = `translateY(${offset}px)`;
    track.querySelectorAll('.picker-item').forEach((el, i) => {
      el.classList.toggle('active', i === newIdx);
    });
  }, { passive: true });

  container.addEventListener('touchend', () => {
    track.style.transition = 'transform 0.2s ease';
    const dy = startY - (event.changedTouches?.[0]?.clientY ?? startY);
    const idxOffset = Math.round(dy / ITEM_H);
    const newIdx = Math.max(0, Math.min(items.length - 1, startIdx + idxOffset));
    scrollTo(newIdx);
    if (newIdx !== startIdx) onChange(items[newIdx]);
  });

  return { scrollTo, getIndex: () => activeIdx };
}

let symbolPicker = null;
let freqPicker = null;
let rangePicker = null;

function setupToolbar() {
  freqPicker = createPickerWheel(
    document.getElementById('picker-freq'),
    FREQ_OPTIONS,
    state.activeFreq,
    (val) => { state.activeFreq = val; reloadPrice(); }
  );

  rangePicker = createPickerWheel(
    document.getElementById('picker-range'),
    RANGE_OPTIONS,
    state.activeRange,
    (val) => { state.activeRange = val; reloadPrice(); }
  );
}

function populateSymbolScroller() {
  const allSymbols = watchlistData.flatMap((s) => s.symbols);
  if (allSymbols.length === 0) return;

  symbolPicker = createPickerWheel(
    document.getElementById('picker-symbol'),
    allSymbols,
    state.currentSymbol || allSymbols[0],
    (sym) => loadSymbol(sym)
  );
}

async function init() {
  const authed = await checkAuth();
  if (!authed) {
    document.getElementById('login-screen').style.display = 'flex';
    return;
  }

  document.getElementById('app').classList.add('active');
  setupBus();
  setupToolbar();

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('gex-toggle-arrow').addEventListener('click', toggleGexPanel);

  document.querySelectorAll('#gex-mode-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#gex-mode-toggle button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.gexMode = btn.dataset.mode;
      updateGexMode();
    });
  });

  document.getElementById('wl-add-btn').addEventListener('click', showAddMenu);
  document.querySelector('.sheet-backdrop')?.addEventListener('click', hideBottomSheet);
  document.getElementById('sheet-cancel')?.addEventListener('click', hideBottomSheet);

  await loadWatchlist();

  setupWatchlistReorder(document.getElementById('wl-sections'), async (newOrder) => {
    const flat = watchlistData.flatMap((s) => s.symbols);
    if (flat.join(',') !== newOrder.join(',')) {
      watchlistData[0].symbols = newOrder.filter((s) => watchlistData.some((sec) => sec.symbols.includes(s)));
      for (let i = 1; i < watchlistData.length; i++) {
        watchlistData[i].symbols = watchlistData[i].symbols.filter((s) => !watchlistData[0].symbols.includes(s));
      }
      await fetch('/api/watchlist', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(watchlistData),
      });
    }
  });
}

init();
