(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const personKey = (name) => String(name || '').trim().normalize('NFC').toLowerCase();

  function monthsBefore(date, months) {
    const year = date.getFullYear();
    const month = date.getMonth() - months;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const cutoff = new Date(year, month, Math.min(date.getDate(), lastDay));
    return [cutoff.getFullYear(), String(cutoff.getMonth() + 1).padStart(2, '0'), String(cutoff.getDate()).padStart(2, '0')].join('-');
  }

  const threeMonthsBefore = (date) => monthsBefore(date, 3);

  function validIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function oldCollected(payment, cutoff) {
    return payment.Estado === 'Cobrado' && validIsoDate(payment.FechaCobro) && payment.FechaCobro < cutoff;
  }

  function oldPending(payment, expense, cutoff) {
    return payment.Estado === 'Pendiente' && validIsoDate(expense.Fecha) && expense.Fecha <= cutoff;
  }

  // Divide el total en partes iguales (en centavos) entre las personas; el resto se reparte de a 1 centavo.
  function splitEqual(total, people) {
    if (!people.length) throw new Error('Se requiere al menos una persona');
    const cents = Math.round(total * 100);
    const base = Math.floor(cents / people.length);
    const rest = cents - base * people.length;
    return people.map((name, i) => ({ persona: name, monto: (base + (i < rest ? 1 : 0)) / 100 }));
  }

  // Valida reparto manual: la suma debe coincidir con el total.
  function manualSplit(total, parts) {
    if (!parts.length) throw new Error('Se requiere al menos una persona');
    const sum = round2(parts.reduce((a, p) => a + Number(p.monto), 0));
    if (parts.some((p) => !(Number(p.monto) >= 0))) throw new Error('Monto inválido');
    if (sum !== round2(total)) throw new Error(`La suma (${sum}) no coincide con el total (${round2(total)})`);
    return parts.map((p) => ({ persona: p.persona, monto: round2(Number(p.monto)) }));
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Crea filas para las hojas "Gastos" y "Pendientes".
  function buildExpense({ descripcion, total, fecha, cobrado, parts }) {
    const id = newId();
    const estado = cobrado ? 'Cobrado' : 'Pendiente';
    const fechaCobro = cobrado ? fecha : '';
    return {
      gasto: { ID: id, Fecha: fecha, Descripcion: descripcion, Total: round2(total) },
      pendientes: parts.map((p) => ({
        ID: id, Persona: p.persona, Monto: p.monto, Estado: estado, FechaCobro: fechaCobro,
      })),
    };
  }

  // Total pendiente por persona.
  function pendingByPerson(pendientes) {
    const names = new Map();
    pendientes.forEach((r) => {
      if (r.Estado !== 'Pendiente') return;
      const key = personKey(r.Persona);
      const item = names.get(key) || { name: String(r.Persona).trim(), total: 0 };
      item.total = round2(item.total + Number(r.Monto));
      names.set(key, item);
    });
    return Object.fromEntries([...names.values()].map(({ name, total }) => [name, total]));
  }

  function markCollected(pendientes, id, persona, fecha) {
    pendientes.forEach((r) => {
      if (r.ID === id && (persona == null || personKey(r.Persona) === personKey(persona)) && r.Estado === 'Pendiente') {
        r.Estado = 'Cobrado';
        r.FechaCobro = fecha;
      }
    });
  }

  function matchesPayment(payment, expense, { status, from, to, collectedFrom, collectedTo, person, exactPerson }) {
    const date = String(expense.Fecha || '');
    const collected = String(payment.FechaCobro || '');
    const name = String(payment.Persona || '');
    const query = personKey(person);
    return (!status || payment.Estado === status) &&
      (!from || (!!date && date >= from)) && (!to || (!!date && date <= to)) &&
      (!(collectedFrom || collectedTo) || (validIsoDate(collected) &&
        (!collectedFrom || collected >= collectedFrom) && (!collectedTo || collected <= collectedTo))) &&
      (exactPerson !== null ? personKey(name) === personKey(exactPerson) : personKey(name).includes(query));
  }

  const paymentSortOptions = ['date-asc', 'date-desc', 'amount-desc', 'amount-asc', 'person-asc', 'person-desc'];
  const personCollator = new Intl.Collator('es', { sensitivity: 'base' });
  function sortPaymentRows(rows, order) {
    const sort = paymentSortOptions.includes(order) ? order : 'date-asc';
    const compare = (a, b) => {
      if (sort.startsWith('date-')) {
        const first = a.gasto.Fecha, second = b.gasto.Fecha;
        const firstValid = validIsoDate(first), secondValid = validIsoDate(second);
        if (firstValid !== secondValid) return firstValid ? -1 : 1;
        if (!firstValid) return 0;
        return (first < second ? -1 : first > second ? 1 : 0) * (sort === 'date-desc' ? -1 : 1);
      }
      if (sort.startsWith('amount-')) {
        const first = Number(a.p.Monto), second = Number(b.p.Monto);
        if (Number.isFinite(first) !== Number.isFinite(second)) return Number.isFinite(first) ? -1 : 1;
        if (!Number.isFinite(first)) return 0;
        return (first - second) * (sort === 'amount-desc' ? -1 : 1);
      }
      return personCollator.compare(personKey(a.p.Persona), personKey(b.p.Persona)) * (sort === 'person-desc' ? -1 : 1);
    };
    return [...rows].sort((a, b) => compare(a, b) || a.i - b.i);
  }

  return { splitEqual, manualSplit, buildExpense, pendingByPerson, markCollected, matchesPayment, round2, personKey, monthsBefore, threeMonthsBefore, oldCollected, oldPending, paymentSortOptions, sortPaymentRows };
});
