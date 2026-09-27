const app = require('../server');

module.exports = (req, res) => {
  try {
    const rawUrl = req.url || '';
    const parsed = new URL(rawUrl, 'http://localhost');

    // 1. Reconstruct true API route if rewritten by Vercel to /api/index.js?__path=$1
    if (parsed.searchParams.has('__path')) {
      let apiPath = parsed.searchParams.get('__path').replace(/^\/+/, '');
      if (apiPath.startsWith('api/')) {
        apiPath = apiPath.slice(4);
      }
      parsed.searchParams.delete('__path');
      const qs = parsed.searchParams.toString();
      req.url = '/api/' + (apiPath ? apiPath : '') + (qs ? '?' + qs : '');
      if (req.url === '/api/') req.url = '/api';

      if (req.query && req.query.__path !== undefined) {
        delete req.query.__path;
      }
    } else if (req.headers && req.headers['x-matched-path'] && req.headers['x-matched-path'].startsWith('/api/') && req.headers['x-matched-path'] !== '/api/index.js') {
      const qIndex = rawUrl.indexOf('?');
      const qs = qIndex !== -1 ? rawUrl.slice(qIndex) : '';
      req.url = req.headers['x-matched-path'] + qs;
    } else if (rawUrl === '/api/index.js' || rawUrl === '/api/index' || rawUrl.startsWith('/api/index.js?')) {
      const routeMatches = req.headers ? req.headers['x-now-route-matches'] : null;
      if (routeMatches) {
        const match = routeMatches.match(/1=([^&;]+)/);
        if (match && match[1]) {
          const pathPart = decodeURIComponent(match[1]).replace(/^\/+/, '');
          const qIndex = rawUrl.indexOf('?');
          const qs = qIndex !== -1 ? rawUrl.slice(qIndex) : '';
          req.url = '/api/' + pathPart + qs;
        } else {
          req.url = '/api';
        }
      } else {
        req.url = '/api';
      }
    }
  } catch (err) {
    console.error('[Vercel Route Adapt Error]:', err);
  }

  return app(req, res);
};
