import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = [
  'frontend/index.html',
  'frontend/src/main.tsx',
  'frontend/src/style.css',
  'frontend/src/features/auth/AuthPage.tsx',
  'frontend/src/features/landing/Landing.tsx',
  'frontend/src/features/landing/Landing.css',
  'frontend/src/features/workspace/Workspace.tsx',
  'frontend/src/DecisionLab.tsx',
  'frontend/src/DecisionLab.css',
];

test('frontend sources are valid UTF-8 and HTML declares the matching charset', async () => {
  const contents = await Promise.all(files.map((file) => readFile(new URL(`../${file}`, import.meta.url))));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const decoded = contents.map((bytes) => decoder.decode(bytes));
  assert.match(decoded[0], /<meta charset="UTF-8"\s*\/>/i);
});

test('auth and public routes keep Spanish text readable and local registration real', async () => {
  const [source, router] = await Promise.all([
    readFile(new URL('../frontend/src/features/auth/AuthPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/main.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /Contraseña/);
  assert.match(source, /Iniciar sesión/);
  assert.match(source, /Correo o contraseña incorrectos/);
  assert.match(source, /auth\/\$\{register \? 'register' : 'login'\}/);
  assert.match(source, /Nombre de la organización/);
  assert.match(source, /Confirma la contraseña/);
  assert.doesNotMatch(source, /El registro de organizaciones todavía no está disponible/);
  assert.match(router, /pathname === '\/login'/);
  assert.match(router, /pathname === '\/register'/);
  assert.match(router, /pathname === '\/app'/);
  assert.doesNotMatch(source + router, /[\u00c3\u00c2][\u0080-\u00bf]/);
});
