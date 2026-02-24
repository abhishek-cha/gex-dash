import { GEXChart } from './chart/GEXChart.js';
import { checkAuth, openStream } from './api.js';
import { openExpDialog, closeExpDialog, applyExpFilter } from './expDialog.js';

// --- App state ---

const state = {
  currentSymbol: 'AAPL',
  allExpirations: [],
  selectedExpirations: new Set(),
  activeStream: null,

  updateFilterButton() {
    const btn = document.getElementById('exp-filter-btn');
    const count = this.selectedExpirations.size;
    const total = this.allExpirations.length;
    if (total === 0) {
      btn.innerHTML = 'Expirations';
    } else if (count === total) {
      btn.innerHTML = `Expirations <span class="badge">${total}</span>`;
    } else {
      btn.innerHTML = `Expirations <span class="badge">${count}/${total}</span>`;
    }
  },

  closeStream() {
    if (this.activeStream) {
      this.activeStream.close();
      this.activeStream = null;
    }
  },
};

// --- Chart singleton ---

let chart = null;

function ensureChart() {
  if (!chart) {
    chart = new GEXChart(document.getElementById('chart-wrap'));
  }
  return chart;
}

// --- Load orchestration ---

function loadSymbol(symbol) {
  state.currentSymbol = symbol;
  state.closeStream();
  const c = ensureChart();

  state.allExpirations = [];
  state.selectedExpirations = new Set();
  state.updateFilterButton();

  document.getElementById('hdr-symbol').textContent = symbol;
  document.getElementById('hdr-price').textContent = '--';
  document.getElementById('hdr-change').textContent = '--';
  document.getElementById('hdr-change').className = 'change';
  c.clearGEX();

  state.activeStream = openStream(symbol, {
    types: ['price', 'gex'],
    chart: c,
    state,
  });
}

function reloadPrice() {
  state.closeStream();
  const c = ensureChart();
  state.activeStream = openStream(state.currentSymbol, {
    types: ['price'],
    chart: c,
    state,
  });
}

function reloadGEXFiltered() {
  state.closeStream();
  const c = ensureChart();
  state.activeStream = openStream(state.currentSymbol, {
    types: ['gex'],
    chart: c,
    state,
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

  const input = document.getElementById('symbol-input');
  const btn = document.getElementById('load-btn');
  const freqSel = document.getElementById('freq-select');
  const rangeSel = document.getElementById('range-select');

  const go = () => {
    const sym = (input.value.trim() || 'AAPL').toUpperCase();
    input.value = sym;
    loadSymbol(sym);
  };

  btn.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  freqSel.addEventListener('change', () => {
    if (state.currentSymbol) reloadPrice();
  });
  rangeSel.addEventListener('change', () => {
    if (state.currentSymbol) reloadPrice();
  });

  document.getElementById('exp-filter-btn').addEventListener('click', () => openExpDialog(state));
  document.getElementById('exp-dialog-close').addEventListener('click', closeExpDialog);
  document.getElementById('exp-dialog-apply').addEventListener('click', () => {
    applyExpFilter(state, () => {
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

  input.value = 'AAPL';
  go();
}

init();
