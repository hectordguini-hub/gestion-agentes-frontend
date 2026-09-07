const supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const formateadorNumero = new Intl.NumberFormat('es-AR');
const formateadorPorcentaje = new Intl.NumberFormat('es-AR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

const COLOR_TINTA = '#25404a';
const COLOR_BRONCE = '#ca0130';
const COLOR_VERDE = '#3f6b4f';
const COLOR_ROJO = '#a23b2d';
const graficos = {};

function destruirSiExiste(id) {
  if (graficos[id]) { graficos[id].destroy(); delete graficos[id]; }
}

// ============================================================
// LOGIN / SESIÓN
// ============================================================
supabaseClient.auth.getSession().then(({ data: { session } }) => {
  if (session) mostrarApp(session);
});

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { errorEl.textContent = 'Email o contraseña incorrectos.'; return; }
  mostrarApp(data.session);
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  location.reload();
});

function mostrarApp(session) {
  document.getElementById('pantalla-login').classList.add('oculto');
  document.getElementById('app').classList.remove('oculto');
  document.getElementById('usuario-email').textContent = session.user.email;
  cargarVistaResumen();
  cargarLogCargas();
}

// ============================================================
// NAVEGACIÓN
// ============================================================
document.getElementById('nav-pestanas').addEventListener('click', (e) => {
  const boton = e.target.closest('.pestana');
  if (!boton) return;
  document.querySelectorAll('.pestana').forEach(b => b.classList.remove('activa'));
  boton.classList.add('activa');
  document.querySelectorAll('.vista').forEach(v => v.classList.add('oculto'));
  document.getElementById(`vista-${boton.dataset.vista}`).classList.remove('oculto');
  document.getElementById('nav-pestanas').classList.add('oculto-menu');
});

document.getElementById('btn-toggle-menu').addEventListener('click', () => {
  document.getElementById('nav-pestanas').classList.toggle('oculto-menu');
});

// ============================================================
// VISTA: RESUMEN
// ============================================================
function fechaDesdeRango(dias) {
  const hoy = new Date();
  const fecha = new Date(hoy);
  fecha.setDate(fecha.getDate() - dias);
  return fecha.toISOString().slice(0, 10);
}

document.getElementById('selector-rango-resumen').addEventListener('change', cargarVistaResumen);

async function cargarVistaResumen() {
  const dias = Number(document.getElementById('selector-rango-resumen').value) || 30;
  const fechaDesde = fechaDesdeRango(dias);

  const [kpisResp, porAgenteDiaResp, efectividadResp, porCanalResp, porEfectoResp] = await Promise.all([
    supabaseClient.rpc('gestiones_kpis', { fecha_desde: fechaDesde }),
    supabaseClient.rpc('gestiones_por_agente_dia', { fecha_desde: fechaDesde }),
    supabaseClient.rpc('gestiones_efectividad_por_agente', { fecha_desde: fechaDesde }),
    supabaseClient.rpc('gestiones_por_canal', { fecha_desde: fechaDesde }),
    supabaseClient.rpc('gestiones_por_efecto', { fecha_desde: fechaDesde }),
  ]);

  const kpis = (kpisResp.data && kpisResp.data[0]) || {};
  const porAgenteDia = porAgenteDiaResp.data || [];
  const efectividad = efectividadResp.data || [];
  const porCanal = porCanalResp.data || [];
  const porEfecto = porEfectoResp.data || [];

  // ---- KPIs ----
  const totalContacto = Number(kpis.contacto_directo || 0) + Number(kpis.contacto_indirecto || 0) + Number(kpis.sin_contacto || 0);
  const pctEfectividad = totalContacto ? (Number(kpis.contacto_directo || 0) / totalContacto) : 0;
  const kpisHtml = [
    { etiqueta: 'Total gestiones', valor: formateadorNumero.format(kpis.total_gestiones || 0) },
    { etiqueta: 'Clientes únicos gestionados', valor: formateadorNumero.format(kpis.clientes_unicos || 0) },
    { etiqueta: 'Agentes activos', valor: formateadorNumero.format(kpis.agentes_activos || 0) },
    { etiqueta: 'Contacto directo', valor: formateadorNumero.format(kpis.contacto_directo || 0) },
    { etiqueta: '% Efectividad (contacto directo)', valor: formateadorPorcentaje.format(pctEfectividad) },
  ];
  document.getElementById('kpis-resumen').innerHTML = kpisHtml.map(k => `
    <div class="tarjeta-kpi"><span class="valor">${k.valor}</span><span class="etiqueta">${k.etiqueta}</span></div>`).join('');

  // ---- Gráfico: volumen por día (sumando todos los agentes/empresas) ----
  const volumenPorDia = {};
  porAgenteDia.forEach(f => { volumenPorDia[f.fecha] = (volumenPorDia[f.fecha] || 0) + Number(f.cantidad); });
  const diasOrdenados = Object.keys(volumenPorDia).sort();
  destruirSiExiste('grafico-volumen-dia');
  graficos['grafico-volumen-dia'] = new Chart(document.getElementById('grafico-volumen-dia'), {
    type: 'line',
    data: { labels: diasOrdenados, datasets: [{ label: 'Gestiones', data: diasOrdenados.map(d => volumenPorDia[d]), borderColor: COLOR_BRONCE, backgroundColor: COLOR_BRONCE + '22', tension: 0.25 }] },
    options: { responsive: true, plugins: { legend: { display: false } } },
  });

  // ---- Gráfico: efectividad total (torta) ----
  const totalesPorTipo = { 'CONTACTO DIRECTO': 0, 'CONTACTO INDIRECTO': 0, 'NO CONTACTO': 0 };
  efectividad.forEach(f => { if (f.tipo_contacto in totalesPorTipo) totalesPorTipo[f.tipo_contacto] += Number(f.cantidad); });
  destruirSiExiste('grafico-efectividad-total');
  graficos['grafico-efectividad-total'] = new Chart(document.getElementById('grafico-efectividad-total'), {
    type: 'doughnut',
    data: {
      labels: ['Contacto directo', 'Contacto indirecto', 'Sin contacto'],
      datasets: [{ data: Object.values(totalesPorTipo), backgroundColor: [COLOR_VERDE, COLOR_TINTA, COLOR_ROJO] }],
    },
    options: { responsive: true },
  });

  // ---- Gráfico: por canal (tipo de acción) ----
  const totalPorCanal = {};
  porCanal.forEach(f => { totalPorCanal[f.tipo_accion] = (totalPorCanal[f.tipo_accion] || 0) + Number(f.cantidad); });
  const canales = Object.keys(totalPorCanal);
  destruirSiExiste('grafico-por-canal');
  graficos['grafico-por-canal'] = new Chart(document.getElementById('grafico-por-canal'), {
    type: 'doughnut',
    data: { labels: canales, datasets: [{ data: canales.map(c => totalPorCanal[c]), backgroundColor: [COLOR_TINTA, COLOR_BRONCE, COLOR_VERDE, COLOR_ROJO, '#c9820a'] }] },
    options: { responsive: true },
  });

  // ---- Gráfico: por efecto (resultado de la gestión) ----
  const top15Efectos = porEfecto.slice(0, 15);
  destruirSiExiste('grafico-por-efecto');
  graficos['grafico-por-efecto'] = new Chart(document.getElementById('grafico-por-efecto'), {
    type: 'bar',
    data: { labels: top15Efectos.map(f => f.efecto), datasets: [{ label: 'Cantidad', data: top15Efectos.map(f => Number(f.cantidad)), backgroundColor: COLOR_TINTA }] },
    options: { responsive: true, plugins: { legend: { display: false } }, indexAxis: 'y' },
  });

  // ---- Tabla por agente ----
  const porAgente = {};
  porAgenteDia.forEach(f => {
    const clave = `${f.usuario}|${f.empresa || ''}`;
    if (!porAgente[clave]) porAgente[clave] = { usuario: f.usuario, empresa: f.empresa, gestiones: 0, directo: 0, indirecto: 0, sinContacto: 0 };
    porAgente[clave].gestiones += Number(f.cantidad);
  });
  efectividad.forEach(f => {
    const clave = `${f.usuario}|${f.empresa || ''}`;
    if (!porAgente[clave]) porAgente[clave] = { usuario: f.usuario, empresa: f.empresa, gestiones: 0, directo: 0, indirecto: 0, sinContacto: 0 };
    if (f.tipo_contacto === 'CONTACTO DIRECTO') porAgente[clave].directo += Number(f.cantidad);
    else if (f.tipo_contacto === 'CONTACTO INDIRECTO') porAgente[clave].indirecto += Number(f.cantidad);
    else if (f.tipo_contacto === 'NO CONTACTO') porAgente[clave].sinContacto += Number(f.cantidad);
  });
  const filasAgente = Object.values(porAgente).sort((a, b) => b.gestiones - a.gestiones);
  document.querySelector('#tabla-por-agente tbody').innerHTML = filasAgente.map(a => {
    const totalContactoAgente = a.directo + a.indirecto + a.sinContacto;
    const pct = totalContactoAgente ? a.directo / totalContactoAgente : 0;
    return `<tr>
      <td>${a.usuario}</td>
      <td>${a.empresa || ''}</td>
      <td class="numero">${formateadorNumero.format(a.gestiones)}</td>
      <td class="numero">${formateadorNumero.format(a.directo)}</td>
      <td class="numero">${formateadorNumero.format(a.indirecto)}</td>
      <td class="numero">${formateadorNumero.format(a.sinContacto)}</td>
      <td class="numero">${formateadorPorcentaje.format(pct)}</td>
    </tr>`;
  }).join('');
}

// ============================================================
// CARGA DE GESTIONES
// ============================================================
document.getElementById('form-cargar-gestiones').addEventListener('submit', async (e) => {
  e.preventDefault();
  const estadoEl = document.getElementById('carga-estado');
  const boton = document.getElementById('btn-cargar-gestiones');
  estadoEl.textContent = 'Subiendo…';
  estadoEl.className = 'mensaje-estado';
  boton.disabled = true;
  const horaInicio = new Date().toISOString();

  const { data: { session } } = await supabaseClient.auth.getSession();
  const formData = new FormData();
  formData.append('archivo', document.getElementById('archivo-gestiones').files[0]);

  try {
    const respuesta = await fetch(`${CONFIG.BACKEND_URL}/upload-gestiones`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: formData,
    });
    const resultado = await respuesta.json();
    if (!respuesta.ok) throw new Error(resultado.detail || 'Error desconocido');

    estadoEl.textContent = 'Procesando… esta pantalla se va a actualizar sola cuando termine.';
    estadoEl.className = 'mensaje-estado ok';
    cargarLogCargas();
    esperarFinalizacionYRefrescar(estadoEl, horaInicio, 'Listo — las gestiones ya están cargadas.');
  } catch (err) {
    estadoEl.textContent = `Error: ${err.message}`;
    estadoEl.className = 'mensaje-estado error';
  } finally {
    boton.disabled = false;
  }
});

async function esperarFinalizacionYRefrescar(estadoEl, horaInicioIso, mensajeExito) {
  const maxIntentos = 60; // 60 x 8s = 8 minutos como máximo
  for (let intento = 0; intento < maxIntentos; intento++) {
    await new Promise(r => setTimeout(r, 8000));
    const { data } = await supabaseClient
      .from('cargas_log')
      .select('subido_en, estado, mensaje')
      .gt('subido_en', horaInicioIso)
      .order('subido_en', { ascending: false })
      .limit(5);
    const filaFinal = (data || []).find(f => f.estado === 'ok' || f.estado === 'error');
    if (filaFinal) {
      if (filaFinal.estado === 'ok') {
        estadoEl.textContent = mensajeExito || `Listo: ${filaFinal.mensaje}`;
        estadoEl.className = 'mensaje-estado ok';
        cargarVistaResumen();
      } else {
        estadoEl.textContent = `Error: ${filaFinal.mensaje}`;
        estadoEl.className = 'mensaje-estado error';
      }
      cargarLogCargas();
      return;
    }
  }
  estadoEl.textContent = 'Sigue procesando hace rato — revisá el Historial de Cargas o los logs de Render.';
  estadoEl.className = 'mensaje-estado';
  cargarLogCargas();
}

async function cargarLogCargas() {
  // cargas_log es una sola tabla compartida por los 3 tipos de carga
  // (Gestiones, Recupero, Cartera) — se muestra el mismo historial en
  // las 3 pestañas, así siempre se ve todo lo que se subió, sin
  // importar desde qué pestaña se hizo.
  const { data: log } = await supabaseClient
    .from('cargas_log')
    .select('subido_en, subido_por, estado, mensaje')
    .order('subido_en', { ascending: false })
    .limit(20);
  const filasHtml = (log || []).map(f => `
    <tr>
      <td>${new Date(f.subido_en).toLocaleString('es-AR')}</td>
      <td>${f.subido_por || ''}</td>
      <td>${f.estado}</td>
      <td>${f.mensaje || ''}</td>
    </tr>`).join('');
  ['#tabla-log', '#tabla-log-recupero', '#tabla-log-cartera'].forEach(selector => {
    const tbody = document.querySelector(`${selector} tbody`);
    if (tbody) tbody.innerHTML = filasHtml;
  });
}

// ============================================================
// CARGA DE RECUPERO
// ============================================================
document.getElementById('form-cargar-recupero').addEventListener('submit', async (e) => {
  e.preventDefault();
  const estadoEl = document.getElementById('recupero-estado');
  const boton = document.getElementById('btn-cargar-recupero');
  estadoEl.textContent = 'Subiendo…';
  estadoEl.className = 'mensaje-estado';
  boton.disabled = true;
  const horaInicio = new Date().toISOString();

  const { data: { session } } = await supabaseClient.auth.getSession();
  const formData = new FormData();
  formData.append('archivo', document.getElementById('archivo-recupero').files[0]);

  try {
    const respuesta = await fetch(`${CONFIG.BACKEND_URL}/upload-recupero`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: formData,
    });
    const resultado = await respuesta.json();
    if (!respuesta.ok) throw new Error(resultado.detail || 'Error desconocido');

    estadoEl.textContent = 'Procesando… esta pantalla se va a actualizar sola cuando termine.';
    estadoEl.className = 'mensaje-estado ok';
    cargarLogCargas();
    esperarFinalizacionYRefrescar(estadoEl, horaInicio, 'Listo — el Recupero ya está cargado.');
  } catch (err) {
    estadoEl.textContent = `Error: ${err.message}`;
    estadoEl.className = 'mensaje-estado error';
  } finally {
    boton.disabled = false;
  }
});

// ============================================================
// CARGA DE CARTERA (semanal, por unidad de negocio)
// ============================================================
document.getElementById('form-cargar-cartera').addEventListener('submit', async (e) => {
  e.preventDefault();
  const estadoEl = document.getElementById('cartera-estado');
  const boton = document.getElementById('btn-cargar-cartera');
  estadoEl.textContent = 'Subiendo…';
  estadoEl.className = 'mensaje-estado';
  boton.disabled = true;
  const horaInicio = new Date().toISOString();

  const { data: { session } } = await supabaseClient.auth.getSession();
  const formData = new FormData();
  formData.append('archivo', document.getElementById('archivo-cartera').files[0]);
  formData.append('unidad_negocio', document.getElementById('cartera-unidad-negocio').value);

  try {
    const respuesta = await fetch(`${CONFIG.BACKEND_URL}/upload-cartera`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: formData,
    });
    const resultado = await respuesta.json();
    if (!respuesta.ok) throw new Error(resultado.detail || 'Error desconocido');

    estadoEl.textContent = 'Procesando… esta pantalla se va a actualizar sola cuando termine (puede tardar un poco más porque también calcula la reasignación por días).';
    estadoEl.className = 'mensaje-estado ok';
    cargarLogCargas();
    esperarFinalizacionYRefrescar(estadoEl, horaInicio, 'Listo — la Cartera ya está cargada.');
  } catch (err) {
    estadoEl.textContent = `Error: ${err.message}`;
    estadoEl.className = 'mensaje-estado error';
  } finally {
    boton.disabled = false;
  }
});
