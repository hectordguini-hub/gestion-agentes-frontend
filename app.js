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
  cargarSelectorUnidadNegocio();
  cargarVistaResumen();
  cargarLogCargas();
}

async function cargarSelectorUnidadNegocio() {
  const { data } = await supabaseClient.rpc('unidades_negocio_disponibles');
  const selects = [document.getElementById('selector-unidad-resumen'), document.getElementById('cartera-resumen-unidad')];
  (data || []).forEach(f => {
    selects.forEach((select, i) => {
      const opt = document.createElement('option');
      opt.value = f.unidad_negocio;
      opt.textContent = f.unidad_negocio;
      select.appendChild(opt);
    });
  });
}

// ============================================================
// VISTA: CARTERA (composicion y resumen)
// ============================================================
document.getElementById('cartera-resumen-unidad').addEventListener('change', cargarVistaCarteraResumen);
document.getElementById('cartera-resumen-incluir-pagos').addEventListener('change', cargarVistaCarteraResumen);

async function cargarVistaCarteraResumen() {
  const unidad = document.getElementById('cartera-resumen-unidad').value;
  if (!unidad) return;
  const incluirPagos = document.getElementById('cartera-resumen-incluir-pagos').checked;

  const [totalesResp, porBoxResp, porRangoResp] = await Promise.all([
    supabaseClient.rpc('cartera_totales', { p_unidad_negocio: unidad, p_incluir_pagos_vigentes: incluirPagos }),
    supabaseClient.rpc('cartera_resumen_por_box', { p_unidad_negocio: unidad, p_incluir_pagos_vigentes: incluirPagos }),
    supabaseClient.rpc('cartera_resumen_por_rango', { p_unidad_negocio: unidad, p_incluir_pagos_vigentes: incluirPagos }),
  ]);

  const totales = (totalesResp.data && totalesResp.data[0]) || {};
  const formateadorMoneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

  document.getElementById('cartera-resumen-totales').innerHTML = [
    { etiqueta: 'Créditos/Fichas totales', valor: formateadorNumero.format(totales.creditos || 0) },
    { etiqueta: 'DNI totales (sin duplicar)', valor: formateadorNumero.format(totales.dni || 0) },
    { etiqueta: 'Saldo total', valor: formateadorMoneda.format(totales.saldo || 0) },
  ].map(k => `<div class="tarjeta-kpi"><span class="valor">${k.valor}</span><span class="etiqueta">${k.etiqueta}</span></div>`).join('');

  const filaHtml = f => `
    <tr>
      <td>${f.box || f.rango}</td>
      <td class="numero">${formateadorNumero.format(f.creditos)}</td>
      <td class="numero">${formateadorNumero.format(f.dni)}</td>
      <td class="numero">${formateadorMoneda.format(f.saldo)}</td>
      <td class="numero">${formateadorPorcentaje.format(f.pct_creditos)}</td>
      <td class="numero">${formateadorPorcentaje.format(f.pct_dni)}</td>
      <td class="numero">${formateadorPorcentaje.format(f.pct_saldo)}</td>
    </tr>`;

  const filaTotalHtml = filas => {
    if (!filas.length) return '';
    const sum = campo => filas.reduce((acc, f) => acc + Number(f[campo] || 0), 0);
    return `
      <tr class="fila-mes-actual">
        <td><strong>Total</strong></td>
        <td class="numero"><strong>${formateadorNumero.format(sum('creditos'))}</strong></td>
        <td class="numero"><strong>${formateadorNumero.format(sum('dni'))}</strong></td>
        <td class="numero"><strong>${formateadorMoneda.format(sum('saldo'))}</strong></td>
        <td class="numero"><strong>${formateadorPorcentaje.format(sum('pct_creditos'))}</strong></td>
        <td class="numero"><strong>${formateadorPorcentaje.format(sum('pct_dni'))}</strong></td>
        <td class="numero"><strong>${formateadorPorcentaje.format(sum('pct_saldo'))}</strong></td>
      </tr>`;
  };

  const filasBox = porBoxResp.data || [];
  const filasRango = porRangoResp.data || [];
  document.querySelector('#tabla-cartera-por-box tbody').innerHTML = filasBox.map(filaHtml).join('') + filaTotalHtml(filasBox);
  document.querySelector('#tabla-cartera-por-rango tbody').innerHTML = filasRango.map(filaHtml).join('') + filaTotalHtml(filasRango);
}

document.getElementById('btn-descargar-cartera').addEventListener('click', async () => {
  const unidad = document.getElementById('cartera-resumen-unidad').value;
  const estadoEl = document.getElementById('cartera-descarga-estado');
  if (!unidad) {
    estadoEl.textContent = 'Elegí una unidad de negocio primero.';
    estadoEl.className = 'mensaje-estado error';
    return;
  }
  const boton = document.getElementById('btn-descargar-cartera');
  boton.disabled = true;
  estadoEl.className = 'mensaje-estado';

  try {
    // Se pagina de a 1000 filas (limite de Supabase por consulta) hasta
    // traer toda la cartera de la unidad, que en algunas unidades supera
    // las 50.000 fichas.
    const filas = [];
    const tamanoPagina = 1000;
    let desde = 0;
    while (true) {
      estadoEl.textContent = `Descargando… ${filas.length} fichas traídas`;
      const { data, error } = await supabaseClient
        .from('cartera_asignada')
        .select('compania, ficha, box, nro_documento, nombre_causa, deuda_total, fecha_inicio_estudio, provincia, rango, estado')
        .eq('unidad_negocio', unidad)
        .order('id', { ascending: true })
        .range(desde, desde + tamanoPagina - 1);
      if (error) throw new Error(error.message);
      filas.push(...data);
      if (data.length < tamanoPagina) break;
      desde += tamanoPagina;
    }

    if (filas.length === 0) {
      estadoEl.textContent = 'No hay fichas cargadas todavía para esta unidad.';
      estadoEl.className = 'mensaje-estado error';
      return;
    }

    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, unidad.slice(0, 31));
    const nombreArchivo = `Cartera_${unidad.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(libro, nombreArchivo);

    estadoEl.textContent = `Listo — ${filas.length} fichas descargadas.`;
    estadoEl.className = 'mensaje-estado ok';
  } catch (err) {
    estadoEl.textContent = `Error: ${err.message}`;
    estadoEl.className = 'mensaje-estado error';
  } finally {
    boton.disabled = false;
  }
});

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
function llenarSelectorMeses() {
  const select = document.getElementById('selector-rango-resumen');
  const hoy = new Date();
  const nombresMes = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  for (let i = 0; i < 6; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const valor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const opt = document.createElement('option');
    opt.value = valor;
    opt.textContent = i === 0 ? `${nombresMes[d.getMonth()]} ${d.getFullYear()} (actual)` : `${nombresMes[d.getMonth()]} ${d.getFullYear()}`;
    if (i === 0) opt.selected = true;
    select.appendChild(opt);
  }
}
llenarSelectorMeses();

function fechasDelMesSeleccionado() {
  const [anio, mes] = document.getElementById('selector-rango-resumen').value.split('-').map(Number);
  const hoy = new Date();
  const esMesActual = (anio === hoy.getFullYear() && mes === hoy.getMonth() + 1);
  const desde = new Date(anio, mes - 1, 1);
  // Si es el mes en curso, corta hoy; si es un mes anterior, va hasta el ultimo dia de ese mes.
  const hasta = esMesActual ? hoy : new Date(anio, mes, 0);
  const aISO = f => f.toISOString().slice(0, 10);
  return { fechaDesde: aISO(desde), fechaHasta: aISO(hasta) };
}

document.getElementById('selector-rango-resumen').addEventListener('change', cargarVistaResumen);
document.getElementById('selector-unidad-resumen').addEventListener('change', cargarVistaResumen);

async function cargarVistaResumen() {
  const { fechaDesde, fechaHasta } = fechasDelMesSeleccionado();
  const unidadNegocio = document.getElementById('selector-unidad-resumen').value || null;

  const [kpisResp, porAgenteDiaResp, efectividadResp, porCanalResp, porEfectoResp, extendidoResp, masividadResp] = await Promise.all([
    supabaseClient.rpc('gestiones_kpis', { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, p_unidad_negocio: unidadNegocio }),
    supabaseClient.rpc('gestiones_por_agente_dia', { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, p_unidad_negocio: unidadNegocio }),
    supabaseClient.rpc('gestiones_efectividad_por_agente', { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, p_unidad_negocio: unidadNegocio }),
    supabaseClient.rpc('gestiones_por_canal', { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, p_unidad_negocio: unidadNegocio }),
    supabaseClient.rpc('gestiones_por_efecto', { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, p_unidad_negocio: unidadNegocio }),
    supabaseClient.rpc('gestiones_extendido_por_agente', { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, p_unidad_negocio: unidadNegocio }),
    supabaseClient.rpc('gestiones_masividad', { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, p_unidad_negocio: unidadNegocio }),
  ]);

  const extendidoPorUsuario = {};
  (extendidoResp.data || []).forEach(f => { extendidoPorUsuario[f.usuario] = f; });

  const kpis = (kpisResp.data && kpisResp.data[0]) || {};
  const porAgenteDia = porAgenteDiaResp.data || [];
  const efectividad = efectividadResp.data || [];
  const porCanal = porCanalResp.data || [];
  const porEfecto = porEfectoResp.data || [];

  // ---- KPIs ----
  const totalContacto = Number(kpis.contacto_directo || 0) + Number(kpis.contacto_indirecto || 0) + Number(kpis.sin_contacto || 0);
  const pctEfectividad = totalContacto ? (Number(kpis.contacto_directo || 0) / totalContacto) : 0;
  const masividad = (masividadResp.data && masividadResp.data[0]) || {};
  const formateadorMonedaMasividad = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const kpisHtml = [
    { etiqueta: 'Total gestiones', valor: formateadorNumero.format(kpis.total_gestiones || 0) },
    { etiqueta: 'Clientes únicos gestionados', valor: formateadorNumero.format(kpis.clientes_unicos || 0) },
    { etiqueta: 'Agentes activos', valor: formateadorNumero.format(kpis.agentes_activos || 0) },
    { etiqueta: 'Contacto directo', valor: formateadorNumero.format(kpis.contacto_directo || 0) },
    { etiqueta: '% Efectividad (contacto directo)', valor: formateadorPorcentaje.format(pctEfectividad) },
    { etiqueta: 'Pagos por mensajes masivos', valor: `${formateadorNumero.format(masividad.dni_con_pago || 0)} (${formateadorMonedaMasividad.format(masividad.monto_recaudado || 0)})` },
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
  const formateadorMonedaRecupero = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  document.querySelector('#tabla-por-agente tbody').innerHTML = filasAgente.map(a => {
    const totalContactoAgente = a.directo + a.indirecto + a.sinContacto;
    const pct = totalContactoAgente ? a.directo / totalContactoAgente : 0;
    const ext = extendidoPorUsuario[a.usuario] || { promesas: 0, promesas_cumplidas: 0, recupero_total: 0 };
    const pctCumplidas = ext.promesas ? ext.promesas_cumplidas / ext.promesas : 0;
    return `<tr>
      <td>${a.usuario}</td>
      <td>${a.empresa || ''}</td>
      <td class="numero">${formateadorNumero.format(a.gestiones)}</td>
      <td class="numero">${formateadorNumero.format(a.directo)}</td>
      <td class="numero">${formateadorNumero.format(a.indirecto)}</td>
      <td class="numero">${formateadorNumero.format(a.sinContacto)}</td>
      <td class="numero">${formateadorPorcentaje.format(pct)}</td>
      <td class="numero">${formateadorNumero.format(ext.promesas)}</td>
      <td class="numero">${formateadorNumero.format(ext.promesas_cumplidas)}</td>
      <td class="numero">${formateadorPorcentaje.format(pctCumplidas)}</td>
      <td class="numero">${formateadorMonedaRecupero.format(ext.recupero_total)}</td>
    </tr>`;
  }).join('');

  await cargarEmbudoYContactabilidad(unidadNegocio, fechaDesde, fechaHasta);
}

// ============================================================
// EMBUDO DE EFECTIVIDAD Y CONTACTABILIDAD DE LA CARTERA
// ============================================================
const OBJETIVOS_EMBUDO = { contacto: 0.20, promesas: 0.50, cumplidas: 0.60, recaudacion: 0.02 };

async function cargarEmbudoYContactabilidad(unidadNegocio, fechaDesde, fechaHasta) {
  const mensajeSinUnidad = document.getElementById('embudo-mensaje-sin-unidad');
  const contenido = document.getElementById('embudo-contenido');

  if (!unidadNegocio) {
    mensajeSinUnidad.classList.remove('oculto');
    contenido.classList.add('oculto');
    return;
  }
  mensajeSinUnidad.classList.add('oculto');
  contenido.classList.remove('oculto');

  const [embudoResp, contactabilidadResp] = await Promise.all([
    supabaseClient.rpc('cartera_embudo_efectividad', { p_unidad_negocio: unidadNegocio, fecha_desde: fechaDesde, fecha_hasta: fechaHasta }),
    supabaseClient.rpc('cartera_contactabilidad', { p_unidad_negocio: unidadNegocio, fecha_desde: fechaDesde, fecha_hasta: fechaHasta }),
  ]);

  const e = (embudoResp.data && embudoResp.data[0]) || {};
  const formateadorMoneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

  const pctContacto = e.dni_cartera ? e.dni_contactados_titular / e.dni_cartera : 0;
  const pctPromesas = e.dni_contactados_titular ? e.dni_promesas / e.dni_contactados_titular : 0;
  const pctCumplidas = e.dni_promesas ? e.dni_promesas_cumplidas / e.dni_promesas : 0;
  const pctRecaudacion = e.deuda_cartera ? e.recaudacion / e.deuda_cartera : 0;

  const filaEmbudo = (etapa, cantidad, pct, objetivo, esMoneda) => `
    <tr>
      <td>${etapa}</td>
      <td class="numero">${esMoneda ? formateadorMoneda.format(cantidad) : formateadorNumero.format(cantidad)}</td>
      <td class="numero">${formateadorPorcentaje.format(pct)}</td>
      <td class="numero">${formateadorPorcentaje.format(objetivo)}</td>
    </tr>`;

  document.querySelector('#tabla-embudo tbody').innerHTML =
    `<tr><td><strong>Cartera Asignada (DNI)</strong></td><td class="numero"><strong>${formateadorNumero.format(e.dni_cartera || 0)}</strong></td><td class="numero">—</td><td class="numero">—</td></tr>` +
    filaEmbudo('Contacto a Titular', e.dni_contactados_titular || 0, pctContacto, OBJETIVOS_EMBUDO.contacto, false) +
    filaEmbudo('Promesas de Pago', e.dni_promesas || 0, pctPromesas, OBJETIVOS_EMBUDO.promesas, false) +
    filaEmbudo('Promesas Cumplidas', e.dni_promesas_cumplidas || 0, pctCumplidas, OBJETIVOS_EMBUDO.cumplidas, false) +
    filaEmbudo('Recaudación', e.recaudacion || 0, pctRecaudacion, OBJETIVOS_EMBUDO.recaudacion, true);

  const c = (contactabilidadResp.data && contactabilidadResp.data[0]) || {};
  destruirSiExiste('grafico-contactabilidad');
  graficos['grafico-contactabilidad'] = new Chart(document.getElementById('grafico-contactabilidad'), {
    type: 'doughnut',
    data: {
      labels: ['DNI gestionados', 'DNI sin gestión'],
      datasets: [{ data: [c.dni_gestionados || 0, c.dni_sin_gestion || 0], backgroundColor: [COLOR_VERDE, COLOR_ROJO] }],
    },
    options: { responsive: true },
  });
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
  ['#tabla-log', '#tabla-log-recupero', '#tabla-log-cartera', '#tabla-log-baja-cartera'].forEach(selector => {
    const tbody = document.querySelector(`${selector} tbody`);
    if (tbody) tbody.innerHTML = filasHtml;
  });
}

// ============================================================
// DAR DE BAJA CARTERA (mensual, unidades Tercerizadas)
// ============================================================
document.getElementById('form-baja-cartera').addEventListener('submit', async (e) => {
  e.preventDefault();
  const estadoEl = document.getElementById('baja-cartera-estado');
  const boton = document.getElementById('btn-baja-cartera');
  estadoEl.textContent = 'Subiendo…';
  estadoEl.className = 'mensaje-estado';
  boton.disabled = true;
  const horaInicio = new Date().toISOString();

  const { data: { session } } = await supabaseClient.auth.getSession();
  const formData = new FormData();
  formData.append('archivo', document.getElementById('archivo-baja-cartera').files[0]);
  formData.append('unidad_negocio', document.getElementById('baja-unidad-negocio').value);

  try {
    const respuesta = await fetch(`${CONFIG.BACKEND_URL}/baja-cartera`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: formData,
    });
    const resultado = await respuesta.json();
    if (!respuesta.ok) throw new Error(resultado.detail || 'Error desconocido');

    estadoEl.textContent = 'Procesando… esta pantalla se va a actualizar sola cuando termine.';
    estadoEl.className = 'mensaje-estado ok';
    cargarLogCargas();
    esperarFinalizacionYRefrescar(estadoEl, horaInicio, 'Listo — las bajas ya se aplicaron.');
  } catch (err) {
    estadoEl.textContent = `Error: ${err.message}`;
    estadoEl.className = 'mensaje-estado error';
  } finally {
    boton.disabled = false;
  }
});

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
