const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

test('splitEqual reparte centavos', () => {
  const r = L.splitEqual(10, ['a', 'b', 'c']);
  assert.deepStrictEqual(r.map((x) => x.monto), [3.34, 3.33, 3.33]);
});
test('manualSplit valida suma', () => {
  assert.throws(() => L.manualSplit(10, [{ persona: 'a', monto: 4 }]));
  assert.strictEqual(L.manualSplit(10, [{ persona: 'a', monto: 4 }, { persona: 'b', monto: 6 }]).length, 2);
});
test('pendientes y cobro', () => {
  const e = L.buildExpense({ descripcion: 'Almuerzo', total: 20, fecha: '2026-01-01', cobrado: false, parts: L.splitEqual(20, ['a', 'b']) });
  assert.deepStrictEqual(L.pendingByPerson(e.pendientes), { a: 10, b: 10 });
  L.markCollected(e.pendientes, e.gasto.ID, 'a', '2026-01-02');
  assert.deepStrictEqual(L.pendingByPerson(e.pendientes), { b: 10 });
  const c = L.buildExpense({ descripcion: 'x', total: 5, fecha: '2026-01-01', cobrado: true, parts: L.splitEqual(5, ['a']) });
  assert.deepStrictEqual(L.pendingByPerson(c.pendientes), {});
});

test('filtros combinan estado, fechas del gasto y persona', () => {
  const p = { Persona: 'Ana María', Estado: 'Pendiente' };
  const g = { Fecha: '2026-03-15' };
  const filters = { status: 'Pendiente', from: '2026-03-15', to: '2026-03-15', person: 'ANA', exactPerson: null };
  assert.strictEqual(L.matchesPayment(p, g, filters), true);
  assert.strictEqual(L.matchesPayment(p, g, { ...filters, status: 'Cobrado' }), false);
  assert.strictEqual(L.matchesPayment(p, g, { ...filters, from: '2026-03-16' }), false);
  assert.strictEqual(L.matchesPayment(p, {}, filters), false);
  assert.strictEqual(L.matchesPayment(p, g, { ...filters, person: 'Ana', exactPerson: 'Ana' }), false);
  assert.strictEqual(L.matchesPayment(p, g, { ...filters, person: '', status: '', from: '', to: '' }), true);
});

test('agrupa y filtra personas sin distinguir mayúsculas ni normalización Unicode', () => {
  const rows = [
    { Persona: 'ANA', Estado: 'Pendiente', Monto: 5, ID: '1' },
    { Persona: 'ana', Estado: 'Pendiente', Monto: 7, ID: '2' },
  ];
  assert.deepStrictEqual(L.pendingByPerson(rows), { ANA: 12 });
  assert.strictEqual(L.matchesPayment(rows[1], {}, { status: 'Pendiente', from: '', to: '', person: 'ANA', exactPerson: 'ANA' }), true);
  assert.strictEqual(L.personKey(' MARÍA '), L.personKey('mari\u0301a'));
  L.markCollected(rows, '2', 'Ana', '2026-01-01');
  assert.strictEqual(rows[1].Estado, 'Cobrado');
});
