// Minimal static file server for local development.
// The site uses ES modules, so it must be served over http:// (file:// blocks them).
//   usage: node tools/serve.cjs [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

// project root = parent of tools/
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 8731;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';

    // resolve first, then confirm the result is still inside ROOT (path traversal guard)
    const f = path.resolve(path.join(ROOT, p));
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404); res.end('Not found'); return;
    }

    res.writeHead(200, {
        'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
        // always revalidate so edits show up on reload during development
        'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
    console.log(`Safyron dev server → http://127.0.0.1:${PORT}/`);
});