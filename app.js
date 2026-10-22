// ================== Súper Familiar - lógica de la app ==================
const { createClient } = supabase;
const $ = s => document.querySelector(s);
const fmt = n => new Intl.NumberFormat('es-PY').format(Number(n) || 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let db, canal;
let vista = 'lista';
const S = { productos: [], categorias: [], supermercados: [], compras: [] };

// ---------- reglas de negocio ----------
const falta = p => p.en_lista || p.cantidad_actual < p.cantidad_minima;
const aComprar = p => Math.max(p.cantidad_plan - p.cantidad_actual, 1);
const nombreCat = id => (S.categorias.find(c => c.id === id) || { nombre: 'Sin categoría' }).nombre;
const nombreSup = id => (S.supermercados.find(s => s.id === id) || { nombre: 'Sin supermercado' }).nombre;

function porCategoria(lista) {
  const g = new Map();
  for (const p of lista) {
    const n = nombreCat(p.categoria_id);
    if (!g.has(n)) g.set(n, []);
    g.get(n).push(p);
  }
  return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
}

// ---------- inicio y acceso ----------
async function iniciar() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const codigo = localStorage.getItem('codigo_familia');
  if (!codigo) return pantallaLogin();
  conectar(codigo);
  const { data, error } = await db.rpc('verificar_codigo');
  if (error || data !== true) {
    localStorage.removeItem('codigo_familia');
    return pantallaLogin(error ? 'No se pudo conectar. Revisá config.js e internet.' : 'Código incorrecto.');
  }
  $('#nav').hidden = false;
  suscribir();
  await cargar();
}

function conectar(codigo) {
  db = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
    global: { headers: { 'x-family-code': codigo } }
  });
}

function pantallaLogin(msg = '') {
  $('#nav').hidden = true;
  $('#main').innerHTML = `<div class="login">
    <h1>🛒</h1><h2>Código familiar</h2>
    <input id="cod" type="password" placeholder="Código" autocomplete="off">
    <p class="err">${esc(msg)}</p>
    <button class="grande" data-a="entrar">Entrar</button></div>`;
}

async function entrar() {
  const cod = $('#cod').value.trim();
  if (!cod) return;
  localStorage.setItem('codigo_familia', cod);
  iniciar();
}

// ---------- sincronización ----------
function suscribir() {
  canal = db.channel('familia');
  canal.on('broadcast', { event: 'cambio' }, () => cargar()).subscribe();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(); });
  setInterval(() => { if (!document.hidden && !$('#dlg').open) cargar(); }, 30000);
}

async function cargar() {
  const [p, c, s, k] = await Promise.all([
    db.from('productos').select('*').order('nombre'),
    db.from('categorias').select('*').order('nombre'),
    db.from('supermercados').select('*').order('nombre'),
    db.from('compras').select('*').order('fecha', { ascending: false }).order('id', { ascending: false })
  ]);
  if (p.error || c.error || s.error || k.error) {
    $('#main').innerHTML = `<p class="vacio">No se pudieron cargar los datos.<br>Revisá tu conexión.</p>`;
    return;
  }
  S.productos = p.data; S.categorias = c.data; S.supermercados = s.data; S.compras = k.data;
  if (!$('#dlg').open) render();
}

// Ejecuta una operación, avisa a los demás celulares y recarga
async function op(promesa) {
  const { error } = await promesa;
  if (error) { alert('Error: ' + error.message); await cargar(); return false; }
  canal && canal.send({ type: 'broadcast', event: 'cambio', payload: {} });
  await cargar();
  return true;
}

// ---------- vistas ----------
function render() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('act', b.dataset.v === vista));
  const f = { lista: vLista, despensa: vDespensa, plan: vPlan, gastos: vGastos, ajustes: vAjustes }[vista];
  $('#main').innerHTML = f();
}

function vLista() {
  const items = S.productos.filter(falta);
  const enCarrito = items.filter(p => p.comprado).length;
  let h = `<p class="sub">${items.length} por comprar · ${enCarrito} en el carrito</p>`;
  if (!items.length) h += `<p class="vacio">Nada falta por ahora 🎉</p>`;
  for (const [cat, ps] of porCategoria(items)) {
    h += `<h3>${esc(cat)}</h3>` + ps.map(p => `
      <label class="fila">
        <input type="checkbox" data-a="comprado" data-id="${p.id}" ${p.comprado ? 'checked' : ''}>
        <span class="n ${p.comprado ? 'tach' : ''}">${esc(p.nombre)}</span>
        <span class="c">× ${aComprar(p)}</span>
      </label>`).join('');
  }
  return h + `<button class="grande" data-a="fin-compra">Finalizar compra</button>`;
}

function vDespensa() {
  let h = `<button class="grande sec" data-a="nuevo-prod" style="margin-top:0">+ Nuevo producto</button>`;
  if (!S.productos.length) h += `<p class="vacio">Todavía no hay productos.</p>`;
  for (const [cat, ps] of porCategoria(S.productos)) {
    h += `<h3>${esc(cat)}</h3>` + ps.map(p => `
      <div class="fila">
        <div class="n">${esc(p.nombre)}${falta(p) ? '<span class="tag">falta</span>' : ''}<small>mínimo ${p.cantidad_minima}</small></div>
        <div class="step">
          <button data-a="ajustar" data-id="${p.id}" data-campo="cantidad_actual" data-d="-1">−</button>
          <b>${p.cantidad_actual}</b>
          <button data-a="ajustar" data-id="${p.id}" data-campo="cantidad_actual" data-d="1">+</button>
        </div>
        <button class="ic ${p.en_lista ? 'on' : ''}" title="Agregar a la lista" data-a="toggle-lista" data-id="${p.id}">🛒</button>
        <button class="ic on" data-a="editar" data-id="${p.id}">✏️</button>
      </div>`).join('');
  }
  return h;
}

function vPlan() {
  const unidades = S.productos.reduce((a, p) => a + p.cantidad_plan, 0);
  let h = `<p class="sub">Plan mensual (igual todos los meses): ${S.productos.length} productos, ${unidades} unidades</p>`;
  for (const [cat, ps] of porCategoria(S.productos)) {
    h += `<h3>${esc(cat)}</h3>` + ps.map(p => `
      <div class="fila">
        <div class="n">${esc(p.nombre)}</div>
        <div class="step">
          <button data-a="ajustar" data-id="${p.id}" data-campo="cantidad_plan" data-d="-1">−</button>
          <b>${p.cantidad_plan}</b>
          <button data-a="ajustar" data-id="${p.id}" data-campo="cantidad_plan" data-d="1">+</button>
        </div>
      </div>`).join('');
  }
  return h;
}

function vGastos() {
  const meses = {};
  S.compras.forEach(c => { (meses[c.fecha.slice(0, 7)] ||= []).push(c); });
  const claves = Object.keys(meses).sort().reverse();
  if (!claves.length) return `<p class="vacio">Todavía no hay compras registradas.<br>Se registran al tocar “Finalizar compra”.</p>`;
  const total = k => meses[k].reduce((a, c) => a + Number(c.total), 0);
  return claves.map((k, i) => {
    const t = total(k);
    const ant = claves[i + 1];
    let dif = '';
    if (ant) {
      const d = t - total(ant);
      dif = `<span class="dif ${d > 0 ? 'sube' : 'baja'}">${d > 0 ? '▲ +' : '▼ '}${fmt(d)} Gs vs mes anterior</span>`;
    }
    const nombreMes = new Date(k + '-15T12:00:00').toLocaleDateString('es-PY', { month: 'long', year: 'numeric' });
    return `<div class="mes">
      <div class="tot"><span class="mn">${nombreMes}</span><b>${fmt(t)} Gs</b></div>
      <div class="sub">${meses[k].length} compra(s) ${dif}</div>
      ${meses[k].map(c => `<div class="compra">
        <span>${c.fecha.slice(8, 10)}/${c.fecha.slice(5, 7)} · ${esc(nombreSup(c.supermercado_id))}</span>
        <span>${fmt(c.total)} Gs <button class="ic on" data-a="del-compra" data-id="${c.id}">🗑️</button></span>
      </div>`).join('')}
    </div>`;
  }).join('');
}

function vAjustes() {
  const bloque = (titulo, tabla, items) => `
    <h3>${titulo}</h3>
    ${items.map(x => `<div class="fila"><span class="n">${esc(x.nombre)}</span>
      <button class="ic on" data-a="edit-aux" data-t="${tabla}" data-id="${x.id}">✏️</button>
      <button class="ic on" data-a="del-aux" data-t="${tabla}" data-id="${x.id}">🗑️</button></div>`).join('')}
    <button class="grande sec" style="margin-top:6px" data-a="nuevo-aux" data-t="${tabla}">+ Agregar</button>`;
  return bloque('Categorías', 'categorias', S.categorias) +
         bloque('Supermercados', 'supermercados', S.supermercados) +
         `<h3>Este dispositivo</h3><button class="grande sec" data-a="salir" style="margin-top:0">Cerrar sesión (cambiar código)</button>`;
}

// ---------- diálogos ----------
const dlg = $('#dlg');
const abrir = html => { dlg.innerHTML = html; dlg.showModal(); };
const cerrar = () => { dlg.close(); render(); };

function dlgProducto(id) {
  const p = id ? S.productos.find(x => x.id == id) : { nombre: '', categoria_id: null, cantidad_actual: 0, cantidad_minima: 1, cantidad_plan: 1 };
  abrir(`<h3>${id ? 'Editar' : 'Nuevo'} producto</h3>
    <label class="campo">Nombre<input id="f_nombre" value="${esc(p.nombre)}"></label>
    <label class="campo">Categoría<select id="f_cat"><option value="">Sin categoría</option>
      ${S.categorias.map(c => `<option value="${c.id}" ${c.id === p.categoria_id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
    <div class="tres">
      <label class="campo">Hay<input id="f_act" type="number" min="0" inputmode="numeric" value="${p.cantidad_actual}"></label>
      <label class="campo">Mínimo<input id="f_min" type="number" min="0" inputmode="numeric" value="${p.cantidad_minima}"></label>
      <label class="campo">Plan mes<input id="f_plan" type="number" min="0" inputmode="numeric" value="${p.cantidad_plan}"></label>
    </div>
    <div class="acc">
      ${id ? `<button class="rojo" data-a="borrar-prod" data-id="${id}">Eliminar</button>` : ''}
      <button data-a="cerrar">Cancelar</button>
      <button class="ok" data-a="guardar-prod" data-id="${id || ''}">Guardar</button>
    </div>`);
}

function dlgFinCompra() {
  const n = S.productos.filter(p => p.comprado).length;
  abrir(`<h3>Finalizar compra</h3>
    <p class="sub">${n} producto(s) en el carrito se sumarán a la despensa.</p>
    <label class="campo">Supermercado<select id="f_sup"><option value="">Sin especificar</option>
      ${S.supermercados.map(s => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('')}</select></label>
    <label class="campo">Total gastado (Gs)<input id="f_total" type="number" min="0" inputmode="numeric" placeholder="0"></label>
    <div class="acc"><button data-a="cerrar">Cancelar</button><button class="ok" data-a="confirmar-compra">Confirmar</button></div>`);
}

// ---------- acciones ----------
const num = id => Math.max(0, parseInt($(id).value, 10) || 0);

const acciones = {
  async vista(el) { vista = el.dataset.v; render(); window.scrollTo(0, 0); },
  entrar,
  salir() { if (confirm('¿Cerrar sesión en este celular?')) { localStorage.removeItem('codigo_familia'); location.reload(); } },
  cerrar,

  async comprado(el) {
    const p = S.productos.find(x => x.id == el.dataset.id);
    p.comprado = el.checked; render();
    await op(db.from('productos').update({ comprado: el.checked }).eq('id', p.id));
  },
  async ajustar(el) {
    const p = S.productos.find(x => x.id == el.dataset.id);
    const campo = el.dataset.campo;
    p[campo] = Math.max(0, p[campo] + Number(el.dataset.d)); render();
    await op(db.from('productos').update({ [campo]: p[campo] }).eq('id', p.id));
  },
  async 'toggle-lista'(el) {
    const p = S.productos.find(x => x.id == el.dataset.id);
    await op(db.from('productos').update({ en_lista: !p.en_lista }).eq('id', p.id));
  },

  'nuevo-prod': () => dlgProducto(null),
  editar: el => dlgProducto(el.dataset.id),
  async 'guardar-prod'(el) {
    const nombre = $('#f_nombre').value.trim();
    if (!nombre) return alert('Escribí el nombre del producto');
    const fila = {
      nombre, categoria_id: $('#f_cat').value || null,
      cantidad_actual: num('#f_act'), cantidad_minima: num('#f_min'), cantidad_plan: num('#f_plan')
    };
    const id = el.dataset.id;
    const ok = await op(id ? db.from('productos').update(fila).eq('id', id) : db.from('productos').insert(fila));
    if (ok) dlg.close();
  },
  async 'borrar-prod'(el) {
    if (!confirm('¿Eliminar este producto?')) return;
    if (await op(db.from('productos').delete().eq('id', el.dataset.id))) dlg.close();
  },

  'fin-compra': dlgFinCompra,
  async 'confirmar-compra'() {
    const total = num('#f_total');
    const sup = $('#f_sup').value || null;
    if (!total && !confirm('El total es 0. ¿Registrar igual?')) return;
    const fecha = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD en hora local
    const ok = await op(db.rpc('finalizar_compra', { p_supermercado: sup, p_total: total, p_fecha: fecha }));
    if (ok) { dlg.close(); vista = 'gastos'; render(); }
  },
  async 'del-compra'(el) {
    if (confirm('¿Eliminar esta compra del historial?')) await op(db.from('compras').delete().eq('id', el.dataset.id));
  },

  async 'nuevo-aux'(el) {
    const nombre = (prompt('Nombre:') || '').trim();
    if (nombre) await op(db.from(el.dataset.t).insert({ nombre }));
  },
  async 'edit-aux'(el) {
    const x = S[el.dataset.t].find(i => i.id == el.dataset.id);
    const nombre = (prompt('Nuevo nombre:', x.nombre) || '').trim();
    if (nombre && nombre !== x.nombre) await op(db.from(el.dataset.t).update({ nombre }).eq('id', x.id));
  },
  async 'del-aux'(el) {
    if (confirm('¿Eliminar? (los productos quedarán sin categoría / las compras sin supermercado)'))
      await op(db.from(el.dataset.t).delete().eq('id', el.dataset.id));
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.type === 'checkbox') return;
  acciones[el.dataset.a]?.(el);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.type === 'checkbox' && el.dataset.a) acciones[el.dataset.a]?.(el);
});
dlg.addEventListener('close', () => render());

iniciar();
