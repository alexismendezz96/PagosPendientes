(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

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
    const out = {};
    pendientes.forEach((r) => {
      if (r.Estado === 'Pendiente') out[r.Persona] = round2((out[r.Persona] || 0) + Number(r.Monto));
    });
    return out;
  }

  function markCollected(pendientes, id, persona, fecha) {
    pendientes.forEach((r) => {
      if (r.ID === id && (persona == null || r.Persona === persona) && r.Estado === 'Pendiente') {
        r.Estado = 'Cobrado';
        r.FechaCobro = fecha;
      }
    });
  }

  return { splitEqual, manualSplit, buildExpense, pendingByPerson, markCollected, round2 };
});
