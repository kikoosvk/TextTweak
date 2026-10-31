const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
http.createServer((req, res) => {
  const file = path.join(__dirname, 'fixtures', req.url === '/frame.html' ? 'frame.html' : 'index.html');
  res.setHeader('Content-Type', 'text/html'); res.end(fs.readFileSync(file));
}).listen(8765, '0.0.0.0');
