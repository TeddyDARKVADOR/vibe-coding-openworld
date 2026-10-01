/**
 * Game server: one Colyseus server hosting the single shared WorldRoom.
 *
 *   npm run dev   (from the repository root) → server on :2567 + Vite client on :5173
 *   npm start     → this server only; also serves client/dist if it was built.
 */
import { defineRoom, defineServer } from 'colyseus';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SERVER_PORT, ROOM_NAME } from '@openworld/shared';
import { WorldRoom, serverStats } from './rooms/WorldRoom.ts';

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const clientDist = path.resolve(import.meta.dirname, '../../client/dist');

const server = defineServer({
  rooms: {
    [ROOM_NAME]: defineRoom(WorldRoom),
  },
  express: (app) => {
    app.get('/health', (_req, res) => { res.json({ ok: true }); });
    // Simulation cost since the last reset (?reset=1). No player data in here.
    app.get('/stats', (req, res) => {
      const { ticks, maxMs, players, summons, sim, avgMs } = serverStats;
      res.json({ ticks, avgMs: +avgMs.toFixed(3), maxMs: +maxMs.toFixed(3), players, summons, sim });
      if (req.query.reset) serverStats.reset();
    });
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      console.log(`[server] serving client build from ${clientDist}`);
    }
  },
});

await server.listen(port);
console.log(`[server] Colyseus listening on ws://localhost:${port}`);
