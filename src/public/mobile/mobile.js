import * as THREE from 'three';
import { checkAuth, openStream, getPriceParams } from '/js/api.js';
import { bus } from '/js/chart/EventBus.js';
import { ViewportModel } from '/js/chart/ViewportModel.js';
import { PriceChart } from '/js/chart/PriceChart.js';
import { GEXSection } from '/js/chart/GEXSection.js';
import { VolumeSection } from '/js/chart/VolumeSection.js';
import { setupWatchlistTouch, shouldSuppressClick } from '/mobile/touch.js';

const state = {
  currentSymbol: null,
  activeStream: null,
  activeFreq: null,
  activeRange: null,
  allExpirations: [],
  selectedExpirations: new Set(),

  closeStream() {
    if (this.activeStream) {
      this.activeStream.close();
      this.activeStream = null;
    }
  },
};

let viewport = null;
let priceChart = null;

const mobileLayout = { priceAxisWidth: 40, hideToggle: true };

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
  priceChart = new PriceChart(priceWrap, viewport, mobileLayout);
  priceChart.scene.background = new THREE.Color(0x000000);
}

let activePanel = null;

function setView(mode) {
  const gexWrap = document.getElementById('chart-gex-wrap');
  const expGroup = document.getElementById('exp-group');

  if (activePanel) {
    activePanel.dispose();
    activePanel = null;
    gexWrap.innerHTML = '';
  }

  if (mode === 'chart') {
    gexWrap.classList.remove('visible');
    expGroup.classList.add('hidden');
    return;
  }

  if (!viewport) {
    initChart();
  }

  gexWrap.classList.add('visible');
  expGroup.classList.remove('hidden');

  const black = new THREE.Color(0x000000);
  if (mode === 'gex' || mode === 'oi') {
    activePanel = new GEXSection(gexWrap, viewport, mobileLayout);
    if (mode === 'oi') activePanel._displayMode = 'oi';
  } else {
    activePanel = new VolumeSection(gexWrap, viewport, mobileLayout);
  }
  activePanel.scene.background = black;
  bus.emit('viewport:change');
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
  document.getElementById('chart-total-gex-val').textContent = '--';
  document.getElementById('chart-total-gex').className = 'total-gex';

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

function updateTotalGex() {
  const el = document.getElementById('chart-total-gex');
  const valEl = document.getElementById('chart-total-gex-val');
  if (!viewport || !viewport.gexLevels.length) {
    valEl.textContent = '--';
    el.className = 'total-gex';
    return;
  }
  let total = 0;
  for (const l of viewport.gexLevels) total += l.netGex;
  valEl.textContent = viewport.fmtGex(total);
  el.className = 'total-gex ' + (total >= 0 ? 'positive' : 'negative');
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
    populateExpSelect();
  });

  bus.on('done:gex', () => {
    populateExpSelect();
    updateTotalGex();
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

  row.addEventListener('click', () => {
    if (shouldSuppressClick()) return;
    loadSymbol(symbol);
  });
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

function handleAdd(value) {
  if (value === 'symbol') {
    showDialog('Ticker symbol', async (text) => {
      const ticker = text.trim().toUpperCase();
      if (!ticker) return;
      if (!watchlistData.length) {
        watchlistData.push({ name: 'Watchlist', symbols: [] });
      }
      const section = watchlistData[watchlistData.length - 1].name;
      await fetch(`/api/watchlist/${encodeURIComponent(section)}/${encodeURIComponent(ticker)}`, { method: 'POST' });
      await loadWatchlist();
    });
  } else if (value === 'section') {
    showDialog('Section name', async (text) => {
      const name = text.trim();
      if (!name) return;
      watchlistData.push({ name, symbols: [] });
      await fetch('/api/watchlist', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(watchlistData),
      });
      await loadWatchlist();
    });
  }
}

function showDialog(placeholder, onSubmit) {
  const dialog = document.createElement('dialog');
  dialog.className = 'wl-dialog';
  dialog.innerHTML = `
    <form method="dialog">
      <input type="text" placeholder="${placeholder}" autocapitalize="characters" />
      <div class="wl-dialog-actions">
        <button type="button" class="wl-dialog-cancel">Cancel</button>
        <button type="submit" class="wl-dialog-ok">OK</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);
  dialog.showModal();

  const input = dialog.querySelector('input');
  input.focus();

  dialog.querySelector('.wl-dialog-cancel').addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });

  dialog.addEventListener('close', () => {
    const val = input.value;
    dialog.remove();
    if (val) onSubmit(val);
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

function setupToolbar() {
  const freqSel = document.getElementById('picker-freq');
  const rangeSel = document.getElementById('picker-range');
  const symSel = document.getElementById('picker-symbol');

  state.activeFreq = freqSel.value;
  state.activeRange = rangeSel.value;

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

function populateExpSelect() {
  const sel = document.getElementById('picker-exp');
  sel.innerHTML = state.allExpirations.map((d) =>
    `<option value="${d}" ${state.selectedExpirations.has(d) ? 'selected' : ''}>${d}</option>`
  ).join('');
}

function setupExpSelect() {
  const sel = document.getElementById('picker-exp');
  sel.addEventListener('change', () => {
    state.selectedExpirations = new Set(
      [...sel.selectedOptions].map((o) => o.value)
    );
    reloadGexFiltered();
  });

  document.getElementById('exp-all').addEventListener('click', () => {
    [...sel.options].forEach((o) => o.selected = true);
    state.selectedExpirations = new Set(state.allExpirations);
    reloadGexFiltered();
  });

  document.getElementById('exp-clear').addEventListener('click', () => {
    [...sel.options].forEach((o) => o.selected = false);
    state.selectedExpirations = new Set();
    reloadGexFiltered();
  });
}

function reloadGexFiltered() {
  if (!state.currentSymbol || !viewport) return;
  state.closeStream();
  const priceParams = getPriceParams(state.activeFreq, state.activeRange);
  state.activeStream = openStream(state.currentSymbol, {
    types: ['gex', 'quote'],
    viewport,
    priceParams,
    expirations: state.selectedExpirations,
  });
}

async function init() {
  // Lock viewport height after browser settles to prevent keyboard resize.
  // Delayed to avoid stale innerHeight on iOS background restore.
  setTimeout(() => {
    const h = window.innerHeight + 'px';
    document.documentElement.style.height = h;
    document.body.style.height = h;
  }, 300);

  const authed = await checkAuth();
  if (!authed) {
    document.getElementById('login-screen').style.display = 'flex';
    return;
  }

  document.getElementById('app').classList.add('active');
  setupBus();
  setupToolbar();
  setupExpSelect();

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('picker-view').addEventListener('change', (e) => {
    setView(e.target.value);
  });

  const addSel = document.getElementById('wl-add-btn');
  addSel.addEventListener('change', () => {
    handleAdd(addSel.value);
    addSel.value = '';
  });

  await loadWatchlist();

  setupWatchlistTouch(document.getElementById('wl-sections'), {
    onReorder: async (newOrder) => {
      // Rebuild watchlistData from DOM order respecting section headers
      const container = document.getElementById('wl-sections');
      const newData = [];
      let currentSection = null;
      for (const el of container.children) {
        if (el.classList.contains('wl-section-header')) {
          currentSection = { name: el.textContent, symbols: [] };
          newData.push(currentSection);
        } else if (el.classList.contains('wl-row') && currentSection) {
          currentSection.symbols.push(el.dataset.symbol);
        }
      }
      if (newData.length) {
        watchlistData = newData;
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
