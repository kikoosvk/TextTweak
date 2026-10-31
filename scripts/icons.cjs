const sharp = require('sharp');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/texttweak-icon.svg'), 'utf8');
Promise.all([16, 32, 48, 128].map(size => {
  // The artwork occupies 4..124 in the source. Frame that artwork at 96px
  // with 16px transparent padding for the Chrome Web Store's 128px icon.
  const icon = size === 128
    ? sharp(Buffer.from(source.replace('viewBox="0 0 128 128"', 'viewBox="4 4 120 120"')))
      .resize(96, 96).extend({ top: 16, bottom: 16, left: 16, right: 16,
        background: { r: 0, g: 0, b: 0, alpha: 0 } })
    : sharp(Buffer.from(source)).resize(size, size);
  return icon.png().toFile(path.join(root, `extension/icons/icon-${size}.png`));
}))
  .catch(error => { console.error(error); process.exitCode = 1; });
