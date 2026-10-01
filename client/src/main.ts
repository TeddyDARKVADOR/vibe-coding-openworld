import './style.css';
import { Game, UserFacingError } from './game/Game.ts';
import { showEntryScreen } from './game/EntryScreen.ts';
import { ui } from './game/ui.ts';
import { AssetLoadError } from './assets/AssetLibrary.ts';

const game = new Game(document.getElementById('app')!);
// ?name=…&character=0..4 skips the entry screen (handy for tests / bookmarks).
const params = new URLSearchParams(location.search);
const profile = params.has('name')
  ? Promise.resolve({ name: params.get('name') ?? '', character: Number(params.get('character') ?? -1) })
  : showEntryScreen(game.assets);
profile.then((p) => game.start(p)).catch((e) => {
  console.error(e);
  if (e instanceof UserFacingError) ui.error(e.title, e.message);
  else if (e instanceof AssetLoadError) ui.error('Ressource introuvable', `${e.message}\n\nVérifie que client/public/assets est complet (voir ASSETS.md).`);
  else ui.error('Erreur au démarrage', e instanceof Error ? e.message : String(e));
});

// Last-resort reporting: never let an unexpected error silently freeze the page.
addEventListener('unhandledrejection', (e) => console.error('[unhandled]', e.reason));
