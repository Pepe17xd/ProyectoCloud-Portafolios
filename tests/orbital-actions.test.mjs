import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReminder, zonedInstant } from '../services/identity-service/orbital.mjs';

test('reminder interpreter accepts its documented explicit template and a valid timezone', () => {
  const reminder = parseReminder('Recuérdame revisar el presupuesto mañana a las 09:00', 'America/Lima');
  assert.equal(reminder.title, 'revisar el presupuesto');
  assert.ok(Date.parse(reminder.dueAt) > Date.now());
});

test('reminder interpreter rejects unsupported or ambiguous language', () => {
  assert.throws(() => parseReminder('Revisa algo pronto', 'America/Lima'), (error) => error.status === 422);
});

test('reminder interpreter rejects invalid clock values and nonexistent daylight-saving local times', () => {
  assert.throws(() => parseReminder('Recuérdame revisar el presupuesto mañana a las 29:00', 'America/Lima'), (error) => error.status === 400);
  assert.throws(() => zonedInstant('2026-03-08', '02:30', 'America/New_York'), /no existe/);
});
