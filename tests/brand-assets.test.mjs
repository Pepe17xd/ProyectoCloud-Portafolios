import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const asset = name => readFileSync(new URL(`../frontend/public/brand/${name}`, import.meta.url));

test('Foli and folder logos are optimized transparent PNG variants', () => {
  const sizes = {
    'profiles-brand-mark.png': [768, 768],
    'profiles-foli.png': [768, 918],
    'profiles-foli-avatar.png': [256, 256],
    'favicon-16.png': [16, 16],
    'favicon-32.png': [32, 32],
    'favicon-64.png': [64, 64],
  };
  for (const [name, [width, height]] of Object.entries(sizes)) {
    const png = asset(name);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), width, `${name} width`);
    assert.equal(png.readUInt32BE(20), height, `${name} height`);
    assert.equal(png[25], 6, `${name} includes an RGBA alpha channel`);
  }
});

test('brand uses Foli assets with the original SVG fallback and keeps reference files excluded', () => {
  const brand = read('frontend/src/components/Brand.tsx');
  const css = read('frontend/src/brand.css');
  const index = read('frontend/index.html');
  const ignore = read('.gitignore');
  const provenance = read('docs/BRAND_ASSETS.md');
  assert.match(brand, /profiles-brand-mark\.png/);
  assert.match(brand, /profiles-foli-avatar\.png/);
  assert.match(brand, /profiles-foli\.png/);
  assert.match(brand, /brand-mark-fallback/);
  assert.match(css, /brand-folder-front/);
  assert.match(index, /favicon-32\.png/);
  assert.match(ignore, /^logo_web\.jpg$/m);
  assert.match(ignore, /^frontend\/public\/profiles-mascot\.png$/m);
  assert.match(provenance, /logo_web\.jpg.*not uploaded/i);
});
