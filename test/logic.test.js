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
  const collected = { ...p, Estado: 'Cobrado', FechaCobro: '2026-03-20' };
  assert.strictEqual(L.matchesPayment(collected, g, { ...filters, status: 'Cobrado', collectedFrom: '2026-03-20', collectedTo: '2026-03-20' }), true);
  assert.strictEqual(L.matchesPayment(collected, g, { ...filters, status: 'Cobrado', collectedFrom: '2026-03-21' }), false);
  assert.strictEqual(L.matchesPayment(p, g, { ...filters, collectedFrom: '2026-03-01' }), false);
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

test('la limpieza usa tres meses de calendario y solo fechas de cobro válidas anteriores al límite', () => {
  const cutoff = L.threeMonthsBefore(new Date(2026, 4, 31));
  assert.strictEqual(cutoff, '2026-02-28');
  assert.strictEqual(L.threeMonthsBefore(new Date(2024, 4, 31)), '2024-02-29');
  assert.strictEqual(L.threeMonthsBefore(new Date(2026, 0, 15)), '2025-10-15');
  assert.strictEqual(L.oldCollected({ Estado: 'Cobrado', FechaCobro: '2026-02-27' }, cutoff), true);
  for (const payment of [
    { Estado: 'Cobrado', FechaCobro: '2026-02-28' },
    { Estado: 'Cobrado', FechaCobro: '2026-02-30' },
    { Estado: 'Cobrado', FechaCobro: '' },
    { Estado: 'Pendiente', FechaCobro: '2026-01-01' },
  ]) assert.strictEqual(L.oldCollected(payment, cutoff), false);
});

test('pendiente antiguo cuenta un mes calendario e ignora cobrados y fechas inválidas', () => {
  const cutoff = L.monthsBefore(new Date(2026, 2, 31), 1);
  assert.strictEqual(cutoff, '2026-02-28');
  assert.strictEqual(L.monthsBefore(new Date(2024, 2, 31), 1), '2024-02-29');
  assert.strictEqual(L.monthsBefore(new Date(2026, 0, 15), 1), '2025-12-15');
  assert.strictEqual(L.oldPending({ Estado: 'Pendiente' }, { Fecha: '2026-02-28' }, cutoff), true);
  assert.strictEqual(L.oldPending({ Estado: 'Pendiente' }, { Fecha: '2026-03-01' }, cutoff), false);
  assert.strictEqual(L.oldPending({ Estado: 'Cobrado' }, { Fecha: '2026-01-01' }, cutoff), false);
  assert.strictEqual(L.oldPending({ Estado: 'Pendiente' }, { Fecha: '2026-02-30' }, cutoff), false);
  assert.strictEqual(L.oldPending({ Estado: 'Pendiente' }, {}, cutoff), false);
});

test('ordena pagos por fecha, monto o persona sin alterar los índices originales', () => {
  const rows = [
    { i: 0, p: { Persona: 'Zoe', Monto: 5 }, gasto: { Fecha: '2026-03-01' } },
    { i: 1, p: { Persona: 'Ana', Monto: 12 }, gasto: { Fecha: '2026-01-01' } },
    { i: 2, p: { Persona: 'ana', Monto: 2 }, gasto: { Fecha: '2026-01-01' } },
    { i: 3, p: { Persona: 'Luis', Monto: 7 }, gasto: { Fecha: '2026-02-30' } },
    { i: 4, p: { Persona: 'Eva', Monto: 1 }, gasto: {} },
  ];
  const indices = (sort) => L.sortPaymentRows(rows, sort).map((row) => row.i);
  assert.deepStrictEqual(indices('date-asc'), [1, 2, 0, 3, 4]);
  assert.deepStrictEqual(indices('date-desc'), [0, 1, 2, 3, 4]);
  assert.deepStrictEqual(indices('amount-desc'), [1, 3, 0, 2, 4]);
  assert.deepStrictEqual(indices('amount-asc'), [4, 2, 0, 3, 1]);
  assert.deepStrictEqual(indices('person-asc'), [1, 2, 4, 3, 0]);
  assert.deepStrictEqual(indices('person-desc'), [0, 3, 4, 1, 2]);
  assert.deepStrictEqual(indices('no-valido'), [1, 2, 0, 3, 4]);
  assert.deepStrictEqual(rows.map((row) => row.i), [0, 1, 2, 3, 4]);
});
