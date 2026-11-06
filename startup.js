'use strict';

window.addEventListener('beforeinstallprompt', (event) => event.preventDefault());

window.addEventListener('load', () => {
  if (!window.appReady) {
    document.getElementById('startupError').classList.remove('hidden');
    document.getElementById('btnLogin').disabled = true;
    document.getElementById('btnTheme').disabled = true;
  }
});
