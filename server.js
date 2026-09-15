// server.js — Local development server for AI for Secure 6G Workshop website
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Handle local mock for /api/register so the registration form is testable locally
  if (req.method === 'POST' && req.url === '/api/register') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const amount = data.amount || 3000;
        console.log(`[Local API /api/register] Received: ${data.fullName || 'User'} (${data.email || 'no-email'}) - Cat: ${data.category} - ₹${amount}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, amount, email: (data.email || '').trim().toLowerCase() }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // Handle local mock for /api/submit-payment
  if (req.method === 'POST' && req.url === '/api/submit-payment') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        console.log(`[Local API /api/submit-payment] Payment Proof: ${data.email} - Ref: ${data.reference}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Static file delivery with clean URLs support
  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  const serveFile = (fileToServe) => {
    const ext = path.extname(fileToServe).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const headers = { 'Content-Type': contentType };
    if (['.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.ico', '.pdf'].includes(ext)) {
      headers['Cache-Control'] = 'public, max-age=86400, stale-while-revalidate=604800';
    } else {
      headers['Cache-Control'] = 'no-cache';
    }

    fs.readFile(fileToServe, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
        return;
      }
      res.writeHead(200, headers);
      res.end(content);
    });
  };

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      fs.stat(filePath, (subErr, subStats) => {
        if (!subErr && subStats.isFile()) {
          serveFile(filePath);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>404 Not Found</h1>');
        }
      });
      return;
    }

    if (!err && stats.isFile()) {
      serveFile(filePath);
      return;
    }

    // Clean URL resolution: try appending .html if direct path doesn't exist
    const htmlPath = filePath + '.html';
    fs.stat(htmlPath, (htmlErr, htmlStats) => {
      if (!htmlErr && htmlStats.isFile()) {
        serveFile(htmlPath);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 Not Found</h1><p>The requested page does not exist.</p>');
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 AI for Secure 6G Workshop website is live!`);
  console.log(`👉 http://localhost:${PORT}/`);
  console.log(`👉 http://127.0.0.1:${PORT}/`);
  console.log(`======================================================\n`);
});
