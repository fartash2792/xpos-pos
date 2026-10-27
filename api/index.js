// Vercel serverless function: every /api/* request is rewritten here (see vercel.json)
// and handled by the same Express app the Node server uses. The original URL is preserved,
// so Express routes match /api/... as usual.
import { app, ready } from '../server/src/index.js';

export default async function handler(req, res) {
  try {
    await ready({ quiet: false }); // migrations + seed-if-empty, once per cold start
  } catch (e) {
    console.error('XPOS init failed:', e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'Server initialisation failed: ' + (e.message || e) }));
  }
  return app(req, res);
}
