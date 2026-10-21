import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReminder } from '../services/identity-service/orbital.mjs';

test('limited reminder parser handles relative dates and defaults omitted minutes', () => {
  const result = parseReminder('Recuérdame revisar el presupuesto mañana a las 9', 'America/Lima');
  assert.equal(result.recurrence, undefined);
  assert.match(result.dueAt, /T14:00:00\.000Z$/);
  assert.equal(result.title, 'revisar el presupuesto');
});

test('limited reminder parser resolves a weekly weekday in the requested timezone', () => {
  const result = parseReminder('Recuérdame revisar el proyecto todos los lunes a las 9', 'America/Lima');
  assert.equal(result.recurrence, 'WEEKLY');
  assert.equal(result.dueAt.slice(11, 16), '14:00');
  assert.equal(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', weekday: 'long' }).format(new Date(result.dueAt)), 'Monday');
});

test('limited reminder parser rejects ambiguous requests and invalid time zones', () => {
  assert.throws(() => parseReminder('Hazlo pronto', 'America/Lima'), (error) => error.status === 422);
  assert.throws(() => parseReminder('Recuérdame revisar mañana a las 25', 'America/Lima'), (error) => error.status === 400);
  assert.throws(() => parseReminder('Recuérdame revisar mañana a las 9', 'Not/AZone'), RangeError);
});
