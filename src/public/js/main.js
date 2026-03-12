import { LayoutManager } from './layout.js';
import { bus } from './chart/EventBus.js';
import { checkAuth, openStream, getPriceParams } from './api.js';
import { openExpDialog, closeExpDialog, applyExpFilter } from './expDialog.js';
import { openWatchlist, closeWatchlist, setActiveSymbol, updateWatchlistQuote } from './watchlist.js';
import { setupWatchlistResize } from './resize.js';

// --- DOM refs ---

const els = {};

function cacheDOM() {
  els.hdrSymbol = document.getElementById('hdr-symbol');
  els.hdrPrice = document.getElementById('hdr-price');
  els.hdrChange = document.getElementById('hdr-change');
  els.freqSel = document.getElementById('freq-select');
  els.rangeSel = document.getElementById('range-select');
  els.input = document.getElementById('symbol-input');
  els.loadBtn = document.getElementById('load-btn');
  els.hdrTotalGex = document.getElementById('hdr-total-gex');
  els.hdrTotalGexVal = document.getElementById('hdr-total-gex-val');
  els.expFilterBtn = document.getElementById('exp-filter-btn');
  els.watchlistBtn = document.getElementById('watchlist-btn');
}

// --- App state ---

const state = {
  currentSymbol: 'AAPL',
  allExpirations: [],
  selectedExpirations: new Set(),
  activeStream: null,

  closeStream() {
    if (this.activeStream) {
      this.activeStream.close();
      this.activeStream = null;
    }
  },
};

// --- Layout ---

let layout = null;

function ensureLayout() {
  if (!layout) {
    layout = new LayoutManager(document.getElementById('chart-wrap'));
    layout.init();
  }
  return layout;
}

function currentPriceParams() {
  return getPriceParams(els.freqSel.value, els.rangeSel.value);
}

// --- Bus subscribers (DOM side-effects) ---

function setupBusSubscriptions() {
  bus.on('stream:start', ({ types }) => {
    const priceLoading = document.getElementById('loading-price');
    const gexLoading = document.getElementById('loading-gex');
    const volLoading = document.getElementById('loading-volume');
    if (types.includes('price')) priceLoading.style.display = 'block';
    if (types.includes('gex')) {
      gexLoading.style.display = 'block';
      volLoading.style.display = 'block';
    }
  });

  bus.on('done:price', () => {
    document.getElementById('loading-price').style.display = 'none';
  });

  bus.on('done:gex', () => {
    document.getElementById('loading-gex').style.display = 'none';
    document.getElementById('loading-volume').style.display = 'none';
    updateFilterButton();
    updateTotalGex();
  });

  bus.on('done:expiration', () => {
    updateFilterButton();
  });

  bus.on('stream:end', () => {
    document.getElementById('loading-price').style.display = 'none';
    document.getElementById('loading-gex').style.display = 'none';
    document.getElementById('loading-volume').style.display = 'none';
  });

  bus.on('stream:error', () => {
    document.getElementById('loading-price').style.display = 'none';
    document.getElementById('loading-gex').style.display = 'none';
    document.getElementById('loading-volume').style.display = 'none';
  });

  bus.on('data:quote', ({ symbol, quote }) => {
    const price = quote.price || 0;
    const change = quote.change || 0;
    const pctChange = quote.percentChange || 0;

    els.hdrPrice.textContent = '$' + price.toFixed(2);
    const sign = change >= 0 ? '+' : '';
    els.hdrChange.textContent = `${sign}${change.toFixed(2)} (${sign}${pctChange.toFixed(2)}%)`;
    els.hdrChange.className = 'change ' + (change >= 0 ? 'up' : 'down');

    updateWatchlistQuote(symbol, quote);
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

function updateFilterButton() {
  const count = state.selectedExpirations.size;
  const total = state.allExpirations.length;
  if (total === 0) {
    els.expFilterBtn.innerHTML = 'Expirations';
  } else if (count === total) {
    els.expFilterBtn.innerHTML = `Expirations <span class="badge">${total}</span>`;
  } else {
    els.expFilterBtn.innerHTML = `Expirations <span class="badge">${count}/${total}</span>`;
  }
}

function updateTotalGex() {
  const vp = layout && layout.viewport;
  if (!vp || !vp.gexLevels.length) {
    els.hdrTotalGexVal.textContent = '--';
    els.hdrTotalGex.className = 'total-gex';
    return;
  }
  let total = 0;
  for (const l of vp.gexLevels) total += l.netGex;
  els.hdrTotalGexVal.textContent = vp.fmtGex(total);
  els.hdrTotalGex.className = 'total-gex ' + (total >= 0 ? 'positive' : 'negative');
}

// --- Load orchestration ---

function loadSymbol(symbol) {
  state.currentSymbol = symbol;
  state.closeStream();
  const l = ensureLayout();

  state.allExpirations = [];
  state.selectedExpirations = new Set();
  updateFilterButton();

  setActiveSymbol(symbol);
  els.hdrSymbol.textContent = symbol;
  els.hdrPrice.textContent = '--';
  els.hdrChange.textContent = '-- (--%)';
  els.hdrChange.className = 'change';
  els.hdrTotalGexVal.textContent = '--';
  els.hdrTotalGex.className = 'total-gex';

  l.viewport.clearPrice();
  l.viewport.clearGEX();
  bus.emit('viewport:change');

  state.activeStream = openStream(symbol, {
    types: ['price', 'gex', 'quote', 'expiration'],
    viewport: l.viewport,
    priceParams: currentPriceParams(),
  });
}

function reloadPrice() {
  state.closeStream();
  const l = ensureLayout();
  state.activeStream = openStream(state.currentSymbol, {
    types: ['price'],
    viewport: l.viewport,
    priceParams: currentPriceParams(),
  });
}

function reloadGEXFiltered() {
  state.closeStream();
  const l = ensureLayout();
  state.activeStream = openStream(state.currentSymbol, {
    types: ['gex', 'quote'],
    viewport: l.viewport,
    priceParams: currentPriceParams(),
    expirations: state.selectedExpirations,
  });
}

// --- Init ---

async function init() {
  const authed = await checkAuth();
  if (!authed) {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').classList.remove('active');
    return;
  }

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('active');

  cacheDOM();
  setupBusSubscriptions();

  const go = () => {
    const sym = (els.input.value.trim() || 'AAPL').toUpperCase();
    els.input.value = sym;
    loadSymbol(sym);
  };

  els.loadBtn.addEventListener('click', go);
  els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  els.freqSel.addEventListener('change', () => {
    if (state.currentSymbol) reloadPrice();
  });
  els.rangeSel.addEventListener('change', () => {
    if (state.currentSymbol) reloadPrice();
  });

  els.expFilterBtn.addEventListener('click', () => openExpDialog(state));
  document.getElementById('exp-dialog-close').addEventListener('click', closeExpDialog);
  document.getElementById('exp-dialog-apply').addEventListener('click', () => {
    applyExpFilter(state, () => {
      updateFilterButton();
      if (state.currentSymbol) reloadGEXFiltered();
    });
  });
  document.getElementById('exp-select-all').addEventListener('click', () => {
    document.querySelectorAll('#exp-dialog-list input[type="checkbox"]').forEach(cb => cb.checked = true);
  });
  document.getElementById('exp-select-none').addEventListener('click', () => {
    document.querySelectorAll('#exp-dialog-list input[type="checkbox"]').forEach(cb => cb.checked = false);
  });
  document.getElementById('exp-dialog-backdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeExpDialog();
  });

  const wlSelectCb = (sym) => {
    els.input.value = sym;
    loadSymbol(sym);
  };

  els.watchlistBtn.addEventListener('click', () => {
    const panel = document.getElementById('watchlist-panel');
    if (panel.classList.contains('open')) {
      closeWatchlist();
    } else {
      openWatchlist(wlSelectCb);
    }
  });

  // Open watchlist by default
  await openWatchlist(wlSelectCb);

  setupWatchlistResize();

  els.input.value = 'AAPL';
  go();
}

init();
