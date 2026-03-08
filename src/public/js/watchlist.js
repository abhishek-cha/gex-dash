const panel = document.getElementById('watchlist-panel');
const listEl = document.getElementById('wl-panel-list');
const addBtn = document.getElementById('wl-add-btn');
const wlBtn = document.getElementById('watchlist-btn');

let onSelect = null;
let sections = [];
let quoteStreams = [];
let activeSymbol = null;

// --- Toggle indicator ---

function updateToggleBtn() {
  wlBtn.classList.toggle('active', panel.classList.contains('open'));
}

// --- Add to watchlist button visibility ---

function updateAddButton() {
  if (!activeSymbol) {
    addBtn.classList.remove('visible');
    return;
  }
  const inWatchlist = sections.some(s => s.symbols.includes(activeSymbol));
  addBtn.classList.toggle('visible', !inWatchlist);
}

// --- Quote fetching via SSE ---

function fetchQuoteForSymbol(sym) {
  const es = new EventSource(`/api/stream/${encodeURIComponent(sym)}?types=quote`);
  es.addEventListener('quote', (e) => {
    const data = JSON.parse(e.data);
    const row = listEl.querySelector(`.wl-row[data-symbol="${CSS.escape(sym)}"]`);
    if (row) applyQuoteToRow(row, data);
  });
  es.addEventListener('done', (e) => {
    const data = JSON.parse(e.data);
    if (!data.type) es.close();
  });
  es.addEventListener('error', () => es.close());
  quoteStreams.push(es);
}

function fetchAllQuotes() {
  closeQuoteStreams();
  for (const sec of sections) {
    for (const sym of sec.symbols) {
      fetchQuoteForSymbol(sym);
    }
  }
}

function closeQuoteStreams() {
  for (const es of quoteStreams) {
    try { es.close(); } catch {}
  }
  quoteStreams = [];
}

function applyQuoteToRow(row, data) {
  const price = data.price || 0;
  const change = data.change || 0;
  const pct = data.percentChange || 0;
  const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';

  const lastEl = row.querySelector('.wl-row-last');
  lastEl.textContent = price.toFixed(2);
  lastEl.classList.remove('wl-row-loading');
  const chgEl = row.querySelector('.wl-row-chg');
  chgEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2);
  chgEl.className = 'wl-row-chg ' + dir;
  const pctEl = row.querySelector('.wl-row-chgpct');
  pctEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  pctEl.className = 'wl-row-chgpct ' + dir;
}

// --- Row creation ---

function createRow(sym, si, ri) {
  const row = document.createElement('div');
  row.className = 'wl-row';
  if (sym === activeSymbol) row.classList.add('active');
  row.dataset.symbol = sym;
  row.dataset.section = si;
  row.dataset.index = ri;
  row.draggable = true;

  row.innerHTML = `
    <span class="wl-row-symbol">${sym}</span>
    <span class="wl-row-last wl-row-loading">--</span>
    <span class="wl-row-chg flat">--</span>
    <span class="wl-row-chgpct flat">--</span>
  `;

  const delBtn = document.createElement('button');
  delBtn.className = 'wl-row-delete';
  delBtn.textContent = '\u00d7';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeSymbol(sym);
  });
  row.appendChild(delBtn);

  row.addEventListener('click', () => {
    activeSymbol = sym;
    listEl.querySelectorAll('.wl-row.active').forEach(r => r.classList.remove('active'));
    row.classList.add('active');
    if (onSelect) onSelect(sym);
  });

  row.addEventListener('contextmenu', (e) => {
    const si = findSectionIndexForSymbol(sym);
    if (si >= 0) showCtxMenu(e, sym, si);
  });

  row.addEventListener('dragstart', onDragStart);
  row.addEventListener('dragover', onDragOver);
  row.addEventListener('dragleave', onDragLeave);
  row.addEventListener('drop', onDrop);
  row.addEventListener('dragend', onDragEnd);

  return row;
}

function findSectionIndexForSymbol(sym) {
  return sections.findIndex(s => s.symbols.includes(sym));
}

// --- Section creation ---

function createSectionEl(sec, si) {
  const sectionEl = document.createElement('div');
  sectionEl.className = 'wl-section';
  sectionEl.dataset.sectionName = sec.name;

  const header = document.createElement('div');
  header.className = 'wl-section-header';

  const arrow = document.createElement('span');
  arrow.className = 'wl-section-arrow';
  arrow.textContent = '\u25BC';

  const name = document.createElement('span');
  name.className = 'wl-section-name';
  name.textContent = sec.name;

  const count = document.createElement('span');
  count.className = 'wl-section-count';
  count.textContent = sec.symbols.length;

  const del = document.createElement('button');
  del.className = 'wl-section-delete';
  del.textContent = '\u00d7';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    removeSectionByName(sec.name);
  });

  header.appendChild(arrow);
  header.appendChild(name);
  header.appendChild(count);
  header.appendChild(del);
  header.addEventListener('click', () => {
    sectionEl.classList.toggle('collapsed');
  });
  sectionEl.appendChild(header);

  const body = document.createElement('div');
  body.className = 'wl-section-body';
  sectionEl.appendChild(body);

  return sectionEl;
}

function updateSectionCount(sectionEl) {
  const body = sectionEl.querySelector('.wl-section-body');
  const count = sectionEl.querySelector('.wl-section-count');
  count.textContent = body.children.length;
}

function getSectionEl(sectionName) {
  return listEl.querySelector(`.wl-section[data-section-name="${CSS.escape(sectionName)}"]`);
}

// --- Context menu ---

let ctxMenu = null;

function closeCtxMenu() {
  if (ctxMenu) {
    ctxMenu.remove();
    ctxMenu = null;
  }
  document.removeEventListener('click', onDocClickCtx);
}

function showCtxMenu(e, sym, sectionIdx) {
  e.preventDefault();
  closeCtxMenu();

  const menu = document.createElement('div');
  menu.className = 'wl-ctx-menu';

  const label = document.createElement('div');
  label.className = 'wl-ctx-label';
  label.textContent = 'Move to section';
  menu.appendChild(label);

  for (let i = 0; i < sections.length; i++) {
    if (i === sectionIdx) continue;
    const item = document.createElement('div');
    item.className = 'wl-ctx-item';
    item.textContent = sections[i].name;
    item.addEventListener('click', () => {
      moveSymbolToSection(sym, sections[i].name);
      closeCtxMenu();
    });
    menu.appendChild(item);
  }

  const sep = document.createElement('div');
  sep.className = 'wl-ctx-separator';
  menu.appendChild(sep);

  const inputRow = document.createElement('div');
  inputRow.className = 'wl-ctx-input';
  const input = document.createElement('input');
  input.placeholder = 'New section\u2026';
  const btn = document.createElement('button');
  btn.textContent = 'Create';
  const create = () => {
    const name = input.value.trim();
    if (!name) return;
    sections.push({ name, symbols: [] });
    listEl.appendChild(createSectionEl(sections[sections.length - 1], sections.length - 1));
    moveSymbolToSection(sym, name);
    closeCtxMenu();
  };
  btn.addEventListener('click', create);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') create(); });
  inputRow.appendChild(input);
  inputRow.appendChild(btn);
  menu.appendChild(inputRow);

  const sep2 = document.createElement('div');
  sep2.className = 'wl-ctx-separator';
  menu.appendChild(sep2);

  const del = document.createElement('div');
  del.className = 'wl-ctx-item danger';
  del.textContent = 'Remove ' + sym;
  del.addEventListener('click', () => {
    closeCtxMenu();
    removeSymbol(sym);
  });
  menu.appendChild(del);

  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  ctxMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
  }

  requestAnimationFrame(() => input.focus());
  setTimeout(() => document.addEventListener('click', onDocClickCtx), 0);
}

function onDocClickCtx(e) {
  if (ctxMenu && !ctxMenu.contains(e.target)) {
    closeCtxMenu();
  }
}

// --- DOM mutations (no full re-render) ---

function moveSymbolToSection(sym, targetSectionName) {
  // Update data
  const fromIdx = findSectionIndexForSymbol(sym);
  if (fromIdx < 0) return;
  sections[fromIdx].symbols = sections[fromIdx].symbols.filter(s => s !== sym);

  let toSection = sections.find(s => s.name === targetSectionName);
  if (!toSection) return;
  if (!toSection.symbols.includes(sym)) {
    toSection.symbols.push(sym);
  }

  // Move DOM: take the row out and append to target section body
  const row = listEl.querySelector(`.wl-row[data-symbol="${CSS.escape(sym)}"]`);
  const fromSectionEl = getSectionEl(sections[fromIdx]?.name);
  const toSectionEl = getSectionEl(targetSectionName);

  if (row && toSectionEl) {
    toSectionEl.querySelector('.wl-section-body').appendChild(row);
    updateSectionCount(toSectionEl);
  }

  // Clean up empty source section
  if (sections[fromIdx].symbols.length === 0) {
    if (fromSectionEl) fromSectionEl.remove();
    sections.splice(fromIdx, 1);
  } else if (fromSectionEl) {
    updateSectionCount(fromSectionEl);
  }

  saveWatchlist();
  updateAddButton();
}

function removeSymbol(sym) {
  const si = findSectionIndexForSymbol(sym);
  if (si < 0) return;

  sections[si].symbols = sections[si].symbols.filter(s => s !== sym);

  // Remove row from DOM
  const row = listEl.querySelector(`.wl-row[data-symbol="${CSS.escape(sym)}"]`);
  const sectionEl = getSectionEl(sections[si].name);
  if (row) row.remove();

  // Clean up empty section
  if (sections[si].symbols.length === 0) {
    if (sectionEl) sectionEl.remove();
    sections.splice(si, 1);
  } else if (sectionEl) {
    updateSectionCount(sectionEl);
  }

  if (sections.length === 0) {
    listEl.innerHTML = '<div class="wl-empty">No symbols yet</div>';
  }

  saveWatchlist();
  updateAddButton();
}

function removeSectionByName(name) {
  const idx = sections.findIndex(s => s.name === name);
  if (idx < 0) return;

  const sectionEl = getSectionEl(name);
  if (sectionEl) sectionEl.remove();
  sections.splice(idx, 1);

  if (sections.length === 0) {
    listEl.innerHTML = '<div class="wl-empty">No symbols yet</div>';
  }

  saveWatchlist();
  updateAddButton();
}

async function addCurrentSymbol() {
  if (!activeSymbol) return;
  const exists = sections.some(s => s.symbols.includes(activeSymbol));
  if (exists) return;

  // Clear empty placeholder
  const empty = listEl.querySelector('.wl-empty');
  if (empty) empty.remove();

  if (sections.length === 0) {
    sections.push({ name: 'Watchlist', symbols: [] });
    listEl.appendChild(createSectionEl(sections[0], 0));
  }

  sections[0].symbols.push(activeSymbol);

  // Add row to DOM
  const sectionEl = getSectionEl(sections[0].name);
  const body = sectionEl.querySelector('.wl-section-body');
  const row = createRow(activeSymbol, 0, sections[0].symbols.length - 1);
  body.appendChild(row);
  updateSectionCount(sectionEl);

  // Fetch quote for just this symbol
  fetchQuoteForSymbol(activeSymbol);

  saveWatchlist();
  updateAddButton();
}

// --- Full render (only on open) ---

function render() {
  listEl.innerHTML = '';
  updateAddButton();
  if (sections.length === 0) {
    listEl.innerHTML = '<div class="wl-empty">No symbols yet</div>';
    return;
  }
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const sectionEl = createSectionEl(sec, si);
    const body = sectionEl.querySelector('.wl-section-body');

    for (let ri = 0; ri < sec.symbols.length; ri++) {
      body.appendChild(createRow(sec.symbols[ri], si, ri));
    }

    listEl.appendChild(sectionEl);
  }
}

// --- Drag and drop ---

let dragData = null;

function onDragStart(e) {
  const row = e.currentTarget;
  dragData = { symbol: row.dataset.symbol, row };
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.currentTarget;
  const rect = row.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  row.classList.remove('drag-over-top', 'drag-over-bottom');
  if (e.clientY < midY) {
    row.classList.add('drag-over-top');
  } else {
    row.classList.add('drag-over-bottom');
  }
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
}

function onDrop(e) {
  e.preventDefault();
  const target = e.currentTarget;
  target.classList.remove('drag-over-top', 'drag-over-bottom');
  if (!dragData) return;

  const sym = dragData.symbol;
  const dragRow = dragData.row;
  const targetSym = target.dataset.symbol;
  if (sym === targetSym) return;

  const rect = target.getBoundingClientRect();
  const below = e.clientY > rect.top + rect.height / 2;

  // Remove from data model
  const fromSi = findSectionIndexForSymbol(sym);
  if (fromSi < 0) return;
  sections[fromSi].symbols = sections[fromSi].symbols.filter(s => s !== sym);
  const fromSectionEl = getSectionEl(sections[fromSi].name);

  // Find target section and insert position
  const toSi = findSectionIndexForSymbol(targetSym);
  if (toSi < 0) return;
  const targetIdx = sections[toSi].symbols.indexOf(targetSym);
  const insertIdx = below ? targetIdx + 1 : targetIdx;
  sections[toSi].symbols.splice(insertIdx, 0, sym);

  // Move DOM element
  const targetBody = target.parentElement;
  if (below) {
    target.after(dragRow);
  } else {
    target.before(dragRow);
  }

  // Update section counts
  const toSectionEl = getSectionEl(sections[toSi].name);
  if (toSectionEl) updateSectionCount(toSectionEl);

  // Clean up empty source section
  if (sections[fromSi].symbols.length === 0) {
    if (fromSectionEl) fromSectionEl.remove();
    sections.splice(fromSi, 1);
  } else if (fromSectionEl) {
    updateSectionCount(fromSectionEl);
  }

  saveWatchlist();
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  listEl.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  dragData = null;
}

// --- API ---

async function loadWatchlist() {
  const res = await fetch('/api/watchlist');
  sections = await res.json();
}

function saveWatchlist() {
  fetch('/api/watchlist', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sections),
  });
}

// --- Event listeners ---

addBtn.addEventListener('click', addCurrentSymbol);

// --- Public API ---

export async function openWatchlist(selectCb) {
  onSelect = selectCb;
  await loadWatchlist();
  render();
  panel.classList.add('open');
  document.getElementById('wl-resize-handle').classList.add('visible');
  updateToggleBtn();
  fetchAllQuotes();
}

export function closeWatchlist() {
  panel.classList.remove('open');
  document.getElementById('wl-resize-handle').classList.remove('visible');
  updateToggleBtn();
  closeQuoteStreams();
  closeCtxMenu();
}

export function updateWatchlistQuote(sym, quoteData) {
  const row = listEl.querySelector(`.wl-row[data-symbol="${CSS.escape(sym)}"]`);
  if (row) applyQuoteToRow(row, quoteData);
}

export function setActiveSymbol(sym) {
  activeSymbol = sym;
  listEl.querySelectorAll('.wl-row.active').forEach(r => r.classList.remove('active'));
  const row = listEl.querySelector(`.wl-row[data-symbol="${CSS.escape(sym)}"]`);
  if (row) row.classList.add('active');
  updateAddButton();
}
