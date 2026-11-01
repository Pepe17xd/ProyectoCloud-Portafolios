import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('brand keeps the original folder SVG and has an opt-in mascot slot only', () => {
  const brand = read('frontend/src/components/Brand.tsx');
  const ignored = read('.gitignore');
  assert.match(brand, /brand-folder-back/);
  assert.match(brand, /brand-folder-front/);
  assert.match(brand, /mascotSrc\?/);
  assert.match(brand, /data-mascot-slot/);
  assert.doesNotMatch(brand, /logo_web|profiles-mascot\.png/);
  assert.match(ignored, /^logo_web\.jpg$/m);
  assert.match(ignored, /^frontend\/public\/profiles-mascot\.png$/m);
});

test('public landing explains the team, purpose, organization spaces, MIT and repository', () => {
  const landing = read('frontend/src/features/landing/Landing.tsx');
  assert.match(landing, /id="equipo"/);
  assert.match(landing, /CloudComputin-utec2026-02/);
  assert.match(landing, /id="organizaciones"/);
  assert.match(landing, /permisos de cada persona/);
  assert.match(landing, /seguridad efectiva también depende/);
  assert.match(landing, /Software libre · Licencia MIT/);
  assert.match(landing, /github\.com\/Pepe17xd\/ProyectoCloud-Portafolios/);
  assert.match(landing, /href="\/register"/);
  assert.match(landing, /href="\/login"/);
});

test('registration keeps safe, stage-specific feedback and styling without exposing provider details', () => {
  const page = read('frontend/src/features/auth/AuthPage.tsx');
  const style = read('frontend/src/features/auth/auth-registration.css');
  assert.match(page, /CodeMismatchException/);
  assert.match(page, /ExpiredCodeException/);
  assert.match(page, /LimitExceededException/);
  assert.match(page, /TypeError.*NetworkError/);
  assert.match(page, /err\.stage === 'provision'/);
  assert.match(page, /Reintentar configuración/);
  assert.match(page, /auth-progress/);
  assert.match(style, /\.auth-progress/);
  assert.match(style, /@media\(max-width:600px\)/);
});
