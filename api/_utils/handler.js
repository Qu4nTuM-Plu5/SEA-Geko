import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { handleNamedRoute } = require('../../server/server.cjs');

export function makeHandler(name) {
  return async function handler(req, res) {
    return handleNamedRoute(name, req, res);
  };
}
