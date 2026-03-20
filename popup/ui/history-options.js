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

historyOptionsBtn?.addEventListener('click', e => {
  e.stopPropagation();
  historyOptionsMenu?.classList.toggle('open');
});

document.addEventListener('click', e => {
  if (!historyOptionsMenu?.classList.contains('open')) return;
  if (historyOptionsMenu.contains(e.target) || historyOptionsBtn?.contains(e.target)) return;
  historyOptionsMenu.classList.remove('open');
});

['addRecruiterBtn', 'refreshLogosBtn', 'updateSlugsBtn', 'exportCsvBtn', 'exportBackupBtn', 'importBackupBtn', 'clearHistoryBtn']
  .forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      setTimeout(() => historyOptionsMenu?.classList.remove('open'), 0);
    });
  });
