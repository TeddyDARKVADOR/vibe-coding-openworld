/**
 * Stable anonymous identity: a random playerId kept in localStorage, so the
 * same browser finds its saved position / friends / summons again. It is a
 * secret (never shown to others) — a real account system can replace it later.
 *
 * Two tabs of the same browser would share it and replace each other on the
 * server, so a second tab uses its own id (kept in sessionStorage).
 */
const KEY = 'openworld.playerId';
const TAB_KEY = 'openworld.tabPlayerId';

function newId(): string {
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function read(storage: Storage, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}

function write(storage: Storage, key: string, v: string): void {
  try { storage.setItem(key, v); } catch { /* private mode: id lasts for this page only */ }
}

export async function resolvePlayerId(): Promise<string> {
  const tabId = read(sessionStorage, TAB_KEY);
  if (tabId) return tabId;
  let main = read(localStorage, KEY);
  if (!main) { main = newId(); write(localStorage, KEY, main); }
  if (!('BroadcastChannel' in window)) return main;

  // Is another open tab already playing with the main id?
  const channel = new BroadcastChannel('openworld-identity');
  const taken = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 250);
    channel.onmessage = (e) => { if (e.data === 'taken') { clearTimeout(t); resolve(true); } };
    channel.postMessage('who');
  });
  if (taken) {
    channel.close();
    const own = newId();
    write(sessionStorage, TAB_KEY, own);
    return own;
  }
  channel.onmessage = (e) => { if (e.data === 'who') channel.postMessage('taken'); };
  return main;
}
