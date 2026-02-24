const backdrop = document.getElementById('wl-dialog-backdrop');
const list = document.getElementById('wl-dialog-list');
const addInput = document.getElementById('wl-add-input');
const addBtn = document.getElementById('wl-add-btn');

let onSelect = null;

function render(symbols) {
  list.innerHTML = '';
  if (symbols.length === 0) {
    list.innerHTML = '<div class="wl-empty">No symbols yet</div>';
    return;
  }
  for (const sym of symbols) {
    const row = document.createElement('div');
    row.className = 'wl-row';

    const name = document.createElement('button');
    name.className = 'wl-symbol';
    name.textContent = sym;
    name.addEventListener('click', () => {
      closeWatchlist();
      if (onSelect) onSelect(sym);
    });

    const del = document.createElement('button');
    del.className = 'wl-delete';
    del.textContent = '\u00d7';
    del.addEventListener('click', async () => {
      const res = await fetch(`/api/watchlist/${encodeURIComponent(sym)}`, { method: 'DELETE' });
      render(await res.json());
    });

    row.appendChild(name);
    row.appendChild(del);
    list.appendChild(row);
  }
}

async function addSymbol() {
  const sym = addInput.value.trim().toUpperCase();
  if (!sym) return;
  addInput.value = '';
  const res = await fetch(`/api/watchlist/${encodeURIComponent(sym)}`, { method: 'POST' });
  render(await res.json());
}

addBtn.addEventListener('click', addSymbol);
addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSymbol(); });

export async function openWatchlist(selectCb) {
  onSelect = selectCb;
  const res = await fetch('/api/watchlist');
  render(await res.json());
  backdrop.classList.add('open');
  addInput.focus();
}

export function closeWatchlist() {
  backdrop.classList.remove('open');
}
