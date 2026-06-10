let _historyActionStatusTimer = null;

function setHistoryActionStatus(text = '', timeoutMs = 2500) {
  if (!historyActionStatus) return;
  clearTimeout(_historyActionStatusTimer);
  historyActionStatus.textContent = text;
  if (text && timeoutMs > 0) {
    _historyActionStatusTimer = setTimeout(() => {
      if (historyActionStatus.textContent === text) historyActionStatus.textContent = '';
    }, timeoutMs);
  }
}

globalThis.setHistoryActionStatus = setHistoryActionStatus;

function closeHistorySubmenus() {
  document.getElementById('manageSubmenu')?.classList.remove('open');
  document.getElementById('transferSubmenu')?.classList.remove('open');
}

historyOptionsBtn?.addEventListener('click', e => {
  e.stopPropagation();
  const isOpen = historyOptionsMenu?.style.display !== 'none';
  historyOptionsMenu.style.display = isOpen ? 'none' : '';
  if (isOpen) closeHistorySubmenus();
});

document.getElementById('manageMenuBtn')?.addEventListener('click', e => {
  e.stopPropagation();
  const submenu = document.getElementById('manageSubmenu');
  const willOpen = !submenu?.classList.contains('open');
  closeHistorySubmenus();
  if (willOpen) submenu?.classList.add('open');
});

document.getElementById('transferMenuBtn')?.addEventListener('click', e => {
  e.stopPropagation();
  const submenu = document.getElementById('transferSubmenu');
  const willOpen = !submenu?.classList.contains('open');
  closeHistorySubmenus();
  if (willOpen) submenu?.classList.add('open');
});

document.addEventListener('click', e => {
  if (!historyOptionsMenu || historyOptionsMenu.style.display === 'none') return;
  if (historyOptionsMenu.contains(e.target) || historyOptionsBtn?.contains(e.target)) return;
  historyOptionsMenu.style.display = 'none';
  closeHistorySubmenus();
});

['addRecruiterBtn', 'refreshLogosBtn', 'updateSlugsBtn', 'exportCsvBtn', 'exportXlsxBtn', 'exportBackupBtn', 'importCsvBtn', 'importJsonBtn', 'importXlsxBtn', 'clearHistoryBtn']
  .forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      setTimeout(() => {
        historyOptionsMenu.style.display = 'none';
        closeHistorySubmenus();
      }, 0);
    });
  });
