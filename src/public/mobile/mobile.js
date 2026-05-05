import * as THREE from 'three';
import { checkAuth, openStream, getPriceParams } from '/js/api.js';
import { bus } from '/js/chart/EventBus.js';
import { ViewportModel } from '/js/chart/ViewportModel.js';
import { PriceChart } from '/js/chart/PriceChart.js';
import { GEXSection } from '/js/chart/GEXSection.js';
import { VolumeSection } from '/js/chart/VolumeSection.js';
import { setupWatchlistTouch } from '/mobile/touch.js';

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
  priceChart = new PriceChart(priceWrap, viewport);
  priceChart.scene.background = new THREE.Color(0x000000);
}

function initGexPanel() {
  if (gexSection) return;
  const gexContainer = document.getElementById('gex-chart-container');

  const gexInner = document.createElement('div');
  gexInner.id = 'gex-inner';
  gexInner.style.cssText = 'position:absolute;inset:0;';
  gexContainer.appendChild(gexInner);

  const volInner = document.createElement('div');
  volInner.id = 'vol-inner';
  volInner.style.cssText = 'position:absolute;inset:0;display:none;';
  gexContainer.appendChild(volInner);

  const black = new THREE.Color(0x000000);
  gexSection = new GEXSection(gexInner, viewport);
  volumeSection = new VolumeSection(volInner, viewport);
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
    // Init GEX sections after panel finishes expanding
    gexWrap.addEventListener('transitionend', () => {
      initGexPanel();
      updateGexMode();
    }, { once: true });
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
  document.getElementById('picker-symbol').value = symbol;
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

function showAddPicker() {
  removeAddRow();
  const select = document.createElement('select');
  select.id = 'wl-add-picker';
  select.className = 'wl-add-picker';
  select.innerHTML = `
    <option value="" disabled selected>Add...</option>
    <option value="symbol">Add Symbol</option>
    <option value="section">New Section</option>
  `;
  select.addEventListener('change', () => {
    if (select.value === 'symbol') {
      select.remove();
      showAddSymbolRow();
    } else if (select.value === 'section') {
      select.remove();
      showAddSectionRow();
    }
  });

  const container = document.getElementById('wl-sections');
  container.parentNode.insertBefore(select, container);
  select.focus();
  select.click();
}

function showAddSymbolRow() {
  removeAddRow();
  const container = document.getElementById('wl-sections');
  const row = document.createElement('div');
  row.className = 'wl-row wl-add-inline';
  row.innerHTML = `
    <input type="text" class="wl-inline-input" placeholder="Ticker" autocapitalize="characters" />
    <button class="wl-inline-add-btn">+</button>
  `;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;

  const input = row.querySelector('input');
  const btn = row.querySelector('button');
  input.focus();

  const doAdd = async () => {
    const sym = input.value.trim().toUpperCase();
    if (!sym) return;
    const section = watchlistData[0]?.name || 'Watchlist';
    if (!watchlistData.length) {
      watchlistData.push({ name: section, symbols: [] });
    }
    await fetch(`/api/watchlist/${encodeURIComponent(section)}/${encodeURIComponent(sym)}`, { method: 'POST' });
    removeAddRow();
    await loadWatchlist();
  };

  btn.addEventListener('click', doAdd);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
}

function showAddSectionRow() {
  removeAddRow();
  const container = document.getElementById('wl-sections');
  const row = document.createElement('div');
  row.className = 'wl-section-header wl-add-inline';
  row.innerHTML = `
    <input type="text" class="wl-inline-input" placeholder="Section name" />
    <button class="wl-inline-add-btn">+</button>
  `;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;

  const input = row.querySelector('input');
  const btn = row.querySelector('button');
  input.focus();

  const doAdd = async () => {
    const name = input.value.trim();
    if (!name) return;
    watchlistData.push({ name, symbols: [] });
    await fetch('/api/watchlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(watchlistData),
    });
    removeAddRow();
    await loadWatchlist();
  };

  btn.addEventListener('click', doAdd);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
}

function removeAddRow() {
  document.getElementById('wl-add-picker')?.remove();
  document.querySelectorAll('.wl-add-inline').forEach((el) => el.remove());
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

function setupToolbar() {
  const freqSel = document.getElementById('picker-freq');
  const rangeSel = document.getElementById('picker-range');
  const symSel = document.getElementById('picker-symbol');

  freqSel.addEventListener('change', () => {
    state.activeFreq = freqSel.value;
    reloadPrice();
  });

  rangeSel.addEventListener('change', () => {
    state.activeRange = rangeSel.value;
    reloadPrice();
  });

  symSel.addEventListener('change', () => {
    loadSymbol(symSel.value);
  });
}

function populateSymbolScroller() {
  const symSel = document.getElementById('picker-symbol');
  const allSymbols = watchlistData.flatMap((s) => s.symbols);
  symSel.innerHTML = allSymbols.map((s) =>
    `<option value="${s}" ${s === state.currentSymbol ? 'selected' : ''}>${s}</option>`
  ).join('');
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

  document.getElementById('wl-add-btn').addEventListener('click', showAddPicker);

  await loadWatchlist();

  setupWatchlistTouch(document.getElementById('wl-sections'), {
    onReorder: async (newOrder) => {
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
    },
    onDelete: async ({ type, symbol }) => {
      if (type === 'symbol') {
        for (const sec of watchlistData) {
          const idx = sec.symbols.indexOf(symbol);
          if (idx >= 0) {
            await fetch(`/api/watchlist/${encodeURIComponent(sec.name)}/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
            break;
          }
        }
      }
      await loadWatchlist();
    },
  });
}

init();
