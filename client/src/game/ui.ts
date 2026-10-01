/** Minimal DOM UI: loading screen, discreet connection status, debug panel, error overlay. */
const $ = (id: string) => document.getElementById(id)!;

export const ui = {
  loading(progress: number, text: string) {
    $('loading-bar').style.width = `${Math.round(progress * 100)}%`;
    $('loading-text').textContent = text;
  },
  hideLoading() {
    const el = $('loading');
    el.classList.add('fade');
    setTimeout(() => el.classList.add('hidden'), 700);
  },

  status(text: string, autoHide = false) {
    const el = $('status');
    el.textContent = text;
    el.classList.remove('hidden', 'fade');
    clearTimeout((el as any)._t);
    if (autoHide) (el as any)._t = setTimeout(() => el.classList.add('fade'), 1500);
  },

  showHint() {
    const el = $('hint');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('fade'), 9000);
  },

  debug(text: string | null) {
    const el = $('debug');
    el.classList.toggle('hidden', text === null);
    if (text !== null) el.textContent = text;
  },

  error(title: string, text: string, retry: (() => void) | null = () => location.reload()) {
    $('error-title').textContent = title;
    $('error-text').textContent = text;
    const btn = $('error-retry') as HTMLButtonElement;
    btn.classList.toggle('hidden', !retry);
    btn.onclick = () => { $('error').classList.add('hidden'); retry?.(); };
    $('error').classList.remove('hidden');
  },
  hideError() {
    $('error').classList.add('hidden');
  },
};
