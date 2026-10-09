import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, Plugin } from 'vite';

/**
 * Dev-only relay for the remote opponent (src/utils/remoteOpponent.ts).
 * The page posts each position to .remote/state.txt (+ state.json with its token);
 * an outside agent answers by writing .remote/move.json: {"token": "...", "index": N}.
 */
function remoteOpponentRelay(): Plugin {
  const dir = path.resolve('.remote');
  const moveFile = path.join(dir, 'move.json');

  return {
    name: 'remote-opponent-relay',
    configureServer(server) {
      server.middlewares.use('/__remote', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (req.method === 'POST' && url.pathname === '/state') {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            const { token, text, moveCount } = JSON.parse(body);
            fs.mkdirSync(dir, { recursive: true });
            fs.rmSync(moveFile, { force: true });
            fs.writeFileSync(path.join(dir, 'state.txt'), `token: ${token}\n\n${text}\n`);
            fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ token, moveCount }));
            res.statusCode = 204;
            res.end();
          });
          return;
        }

        if (req.method === 'GET' && url.pathname === '/move') {
          try {
            const move = JSON.parse(fs.readFileSync(moveFile, 'utf8'));
            if (move.token === url.searchParams.get('token')) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ index: move.index }));
              return;
            }
          } catch {
            // No answer yet
          }
          res.statusCode = 204;
          res.end();
          return;
        }

        res.statusCode = 404;
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), remoteOpponentRelay()],
});
