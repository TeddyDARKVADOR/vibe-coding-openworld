import './style.css';
import { Game, UserFacingError } from './game/Game.ts';
import { ui } from './game/ui.ts';
import { AssetLoadError } from './assets/AssetLibrary.ts';

const game = new Game(document.getElementById('app')!);
game.start().catch((e) => {
  console.error(e);
  if (e instanceof UserFacingError) ui.error(e.title, e.message);
  else if (e instanceof AssetLoadError) ui.error('Ressource introuvable', `${e.message}\n\nVérifie que client/public/assets est complet (voir ASSETS.md).`);
  else ui.error('Erreur au démarrage', e instanceof Error ? e.message : String(e));
});

// Last-resort reporting: never let an unexpected error silently freeze the page.
addEventListener('unhandledrejection', (e) => console.error('[unhandled]', e.reason));
