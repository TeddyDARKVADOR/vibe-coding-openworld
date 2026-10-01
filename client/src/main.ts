import './style.css';
import { Game, UserFacingError } from './game/Game.ts';
import { ui } from './game/ui.ts';

const game = new Game(document.getElementById('app')!);
game.start().catch((e) => {
  console.error(e);
  if (e instanceof UserFacingError) ui.error(e.title, e.message);
  else ui.error('Erreur au démarrage', e instanceof Error ? e.message : String(e));
});

// Last-resort reporting: never let an unexpected error silently freeze the page.
addEventListener('unhandledrejection', (e) => console.error('[unhandled]', e.reason));
