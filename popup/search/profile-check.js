let _lastProfilePollUrl = '';
let _profileWaitTimer = null;

function resetProfileUiState() {
  profileNotif.classList.remove('visible');
  profileNotifAddBtn.style.display = '';
  if (profileNotifEditWrap) profileNotifEditWrap.style.display = 'none';
  if (profileNotifText) profileNotifText.textContent = '';
  if (profileNotifSubtext) profileNotifSubtext.textContent = '';
  errorDiv.style.display = 'none';
}

function requestProfileCheck(tabId, withReconnect = false) {
  clearTimeout(_profileWaitTimer);
  resetProfileUiState();
  statusBox.textContent = 'Checking profile...';

  const send = () => chrome.tabs.sendMessage(tabId, { action: 'requestProfileState' });

  send().catch(async () => {
    if (!withReconnect) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          'aliases.js',
          'content/content-core.js',
          'content/profile/dom-readers.js',
          'content/profile/company-resolver.js',
          'content/profile-content.js'
        ]
      });
      setTimeout(() => chrome.tabs.sendMessage(tabId, { action: 'requestProfileState' }).catch(() => {}), 400);
    } catch {
      statusBox.textContent = 'Reload this LinkedIn tab to reconnect the extension.';
    }
  });

  _profileWaitTimer = setTimeout(() => {
    if (statusBox.textContent === 'Checking profile...') {
      statusBox.textContent = 'Could not read this profile yet. Refresh the panel or reload the LinkedIn tab.';
    }
  }, 7000);
}
