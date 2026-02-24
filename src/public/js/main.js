import { GEXChart } from './chart/GEXChart.js';
import { checkAuth, loadPrice, loadGEX } from './api.js';
import { openExpDialog, closeExpDialog, applyExpFilter } from './expDialog.js';

// --- App state ---

const state = {
  currentSymbol: 'AAPL',
  allExpirations: [],
  selectedExpirations: new Set(),

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

  updateExpirationsFromData(dates) {
    this.allExpirations = dates;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 60);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const within60 = this.allExpirations.filter(d => d <= cutoffStr);
    this.selectedExpirations = new Set(within60.length > 0 ? within60 : this.allExpirations);
    this.updateFilterButton();
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

async function loadSymbol(symbol) {
  state.currentSymbol = symbol;
  const c = ensureChart();

  state.allExpirations = [];
  state.selectedExpirations = new Set();
  state.updateFilterButton();

  document.getElementById('hdr-symbol').textContent = symbol;
  document.getElementById('hdr-price').textContent = '--';
  document.getElementById('hdr-change').textContent = '--';
  document.getElementById('hdr-change').className = 'change';
  c.clearGEX();

  loadPrice(symbol, c);
  loadGEX(symbol, c, state);
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
    if (state.currentSymbol) loadPrice(state.currentSymbol, ensureChart());
  });
  rangeSel.addEventListener('change', () => {
    if (state.currentSymbol) loadPrice(state.currentSymbol, ensureChart());
  });

  document.getElementById('exp-filter-btn').addEventListener('click', () => openExpDialog(state));
  document.getElementById('exp-dialog-close').addEventListener('click', closeExpDialog);
  document.getElementById('exp-dialog-apply').addEventListener('click', () => {
    applyExpFilter(state, () => {
      if (state.currentSymbol) loadGEX(state.currentSymbol, ensureChart(), state, { useFilter: true });
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
