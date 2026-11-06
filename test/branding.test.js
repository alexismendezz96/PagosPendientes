const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('la identidad y los iconos coinciden en la página, instalación y caché', () => {
  const html = read('index.html');
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const worker = read('service-worker.js');
  assert.match(html, /<title>Control de pagos pendientes<\/title>/);
  assert.match(html, /Creado por Alexis Mendez/);
  assert.equal(manifest.name, 'Control de pagos pendientes');
  assert.match(html, /rel="icon"[^>]*href="icons\/logo-192\.png"/);
  assert.match(html, /rel="apple-touch-icon"[^>]*href="icons\/logo-192\.png"/);
  for (const icon of manifest.icons) {
    const png = fs.readFileSync(path.join(root, icon.src));
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    assert.ok(worker.includes(`'${icon.src}'`));
  }
});
