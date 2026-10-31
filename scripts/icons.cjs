const sharp = require('sharp');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
Promise.all([16, 32, 48, 128].map(size => sharp(path.join(root, 'assets/texttweak-icon.svg'))
  .resize(size, size).png().toFile(path.join(root, `extension/icons/icon-${size}.png`))))
  .catch(error => { console.error(error); process.exitCode = 1; });
