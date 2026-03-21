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
  historyOptionsMenu?.classList.toggle('open');
  if (!historyOptionsMenu?.classList.contains('open')) closeHistorySubmenus();
});

manageMenuBtn?.addEventListener('click', e => {
  e.stopPropagation();
  const submenu = document.getElementById('manageSubmenu');
  const willOpen = !submenu?.classList.contains('open');
  closeHistorySubmenus();
  if (willOpen) submenu?.classList.add('open');
});

transferMenuBtn?.addEventListener('click', e => {
  e.stopPropagation();
  const submenu = document.getElementById('transferSubmenu');
  const willOpen = !submenu?.classList.contains('open');
  closeHistorySubmenus();
  if (willOpen) submenu?.classList.add('open');
});

document.addEventListener('click', e => {
  if (!historyOptionsMenu?.classList.contains('open')) return;
  if (historyOptionsMenu.contains(e.target) || historyOptionsBtn?.contains(e.target)) return;
  historyOptionsMenu.classList.remove('open');
  closeHistorySubmenus();
});

['addRecruiterBtn', 'refreshLogosBtn', 'updateSlugsBtn', 'exportCsvBtn', 'exportXlsxBtn', 'exportBackupBtn', 'importCsvBtn', 'importJsonBtn', 'importXlsxBtn', 'clearHistoryBtn']
  .forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      setTimeout(() => {
        historyOptionsMenu?.classList.remove('open');
        closeHistorySubmenus();
      }, 0);
    });
  });
