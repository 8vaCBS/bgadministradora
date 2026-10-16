/* BG Administradora — registro de contactos en Google Sheet (CRM)
 * 1) Clic en WhatsApp: ventana opcional (nombre + teléfono) antes de abrir WhatsApp.
 *    Siempre hay un enlace "Ir directo a WhatsApp sin dejar datos".
 * 2) Formularios del sitio: cada envío se copia también al Sheet.
 * Si ENDPOINT está vacío, este archivo no hace nada (el sitio funciona igual que antes).
 */
(function () {
  'use strict';
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbw3hf_orQjN8Nrap73itwnSsX5NGP0-KHv3Yx8KB3F8PG69WrKDPCA1RS3kvevf089Bwg/exec'; // URL de la app web de Apps Script (termina en /exec)
  if (!ENDPOINT) return;
  if (/^\/(admin|tarjeta)(\/|$)/.test(location.pathname)) return;

  var SS_ORIGEN = 'bgOrigen', SS_DATOS = 'bgDatosWA';
  var ss = {
    get: function (k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  // ---------- origen de la visita (primera página de la sesión) ----------
  (function () {
    if (ss.get(SS_ORIGEN)) return;
    var q = new URLSearchParams(location.search), ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    if (ref === location.hostname) ref = '';
    ss.set(SS_ORIGEN, {
      fuente: q.get('utm_source') || (q.get('gclid') ? 'google' : '') || ref || 'directo',
      medio: q.get('utm_medium') || (q.get('gclid') ? 'cpc' : (ref ? 'referral' : '')),
      campana: q.get('utm_campaign') || '',
      gclid: q.get('gclid') || '',
      entrada: location.pathname
    });
  })();

  function enviar(datos) {
    var o = ss.get(SS_ORIGEN) || {};
    datos.pagina = location.href.split('#')[0];
    datos.fuente = o.fuente || ''; datos.medio = o.medio || ''; datos.campana = o.campana || '';
    datos.gclid = o.gclid || ''; datos.entrada = o.entrada || '';
    var body = JSON.stringify(datos);
    try { if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return; } catch (e) {}
    try { fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body }); } catch (e) {}
  }
  function track(n, p) { if (window.bgTrack) window.bgTrack(n, p); }
  function zona(el) {
    if (el.closest('header')) return 'header';
    if (el.closest('footer')) return 'footer';
    var s = el.closest('section[id]');
    return s ? s.id : 'otro';
  }
  function propiedadActual() {
    var f = document.querySelector('form[data-propiedad]');
    if (f && f.dataset.propiedad && f.dataset.propiedad.indexOf('Consulta general') !== 0) return f.dataset.propiedad;
    return '';
  }
  function txtSelect(el) {
    var o = el.options && el.options[el.selectedIndex];
    return o ? o.text.split(' (')[0].trim() : el.value;
  }

  // ---------- 1. formularios ----------
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM' || f.closest('.bgw')) return;
    if (f._honey && f._honey.value) return;
    var d = {
      origen: f.id === 'venta-form' ? 'Formulario vender' : (f.dataset.propiedad ? 'Formulario propiedad' : 'Formulario contacto'),
      interes: f.dataset.propiedad || ''
    };
    ['nombre', 'telefono', 'email', 'comuna', 'mensaje', 'unidades'].forEach(function (k) {
      if (f.elements[k]) d[k] = f.elements[k].value;
    });
    if (f.elements.tipo) d.tipo = txtSelect(f.elements.tipo);
    if (f.elements.situacion) d.situacion = txtSelect(f.elements.situacion);
    if (f.elements.destino) d.interes = txtSelect(f.elements.destino);
    enviar(d);
  }, true);

  // ---------- 2. ventana antes de WhatsApp ----------
  var css = '.bgw-bg{position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px}'
    + '.bgw{background:#fff;border-radius:18px;max-width:380px;width:100%;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:inherit;position:relative;color:#0f172a}'
    + '.bgw h2{font-size:18px;font-weight:800;margin:0 0 4px}.bgw p{font-size:13px;color:#475569;margin:0 0 16px;line-height:1.45}'
    + '.bgw label{display:block;font-size:12px;font-weight:700;color:#334155;margin:0 0 4px}'
    + '.bgw input{width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid #cbd5e1;border-radius:12px;font-size:14px;margin:0 0 12px;color:#0f172a;background:#fff}'
    + '.bgw input:focus{outline:2px solid #C81D25;border-color:transparent}'
    + '.bgw .bgw-ok{width:100%;border:0;border-radius:12px;background:#059669;color:#fff;font-weight:800;font-size:14px;padding:12px;cursor:pointer;display:flex;gap:8px;align-items:center;justify-content:center}'
    + '.bgw .bgw-ok:hover{background:#047857}'
    + '.bgw .bgw-dir{display:block;width:100%;margin-top:12px;background:none;border:0;color:#64748b;font-size:12px;text-decoration:underline;cursor:pointer}'
    + '.bgw .bgw-x{position:absolute;top:10px;right:12px;background:none;border:0;font-size:22px;color:#94a3b8;cursor:pointer;line-height:1}'
    + '.bgw small{display:block;font-size:11px;color:#94a3b8;margin:-4px 0 14px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function conNombre(href, nombre) {
    try {
      var u = new URL(href, location.href), t = u.searchParams.get('text') || '';
      var cap = function (x) { return x.charAt(0).toUpperCase() + x.slice(1); };
      if (/^Hola Bárbara,?/i.test(t)) t = 'Hola Bárbara, soy ' + nombre + '. ' + cap(t.replace(/^Hola Bárbara,?\s*/i, ''));
      else if (t) t = 'Soy ' + nombre + '. ' + t;
      else t = 'Hola Bárbara, soy ' + nombre + '.';
      u.searchParams.delete('text');
      var resto = u.searchParams.toString();
      return u.origin + u.pathname + '?' + (resto ? resto + '&' : '') + 'text=' + encodeURIComponent(t.trim());
    } catch (e) { return href; }
  }
  function abrir(a, href) {
    if (a.target === '_blank' || /wa\.me|whatsapp\.com/.test(href)) {
      var w = window.open(href, '_blank');
      if (w) { try { w.opener = null; } catch (e) {} } else { location.href = href; }
    } else { location.href = href; }
  }

  function modal(a) {
    var href = a.href, base = { link_location: zona(a), page_section: location.pathname };
    var bg = document.createElement('div');
    bg.className = 'bgw-bg';
    bg.innerHTML = '<div class="bgw" role="dialog" aria-modal="true" aria-labelledby="bgw-t">'
      + '<button type="button" class="bgw-x" aria-label="Cerrar">&times;</button>'
      + '<h2 id="bgw-t">Antes de abrir WhatsApp</h2>'
      + '<p>Déjanos tu nombre y teléfono para responderte más rápido.</p>'
      + '<form novalidate>'
      + '<label for="bgw-n">Nombre</label><input id="bgw-n" name="nombre" autocomplete="name" required placeholder="Ej: Juan Pérez">'
      + '<label for="bgw-t2">Teléfono</label><input id="bgw-t2" name="telefono" type="tel" autocomplete="tel" required placeholder="+56 9 1234 5678">'
      + '<small>Usaremos tus datos solo para responder tu consulta.</small>'
      + '<button type="submit" class="bgw-ok"><i class="fa-brands fa-whatsapp"></i> Continuar a WhatsApp</button>'
      + '</form>'
      + '<button type="button" class="bgw-dir">Ir directo a WhatsApp sin dejar datos</button>'
      + '</div>';
    document.body.appendChild(bg);
    var form = bg.querySelector('form'), n = form.nombre, t = form.telefono;
    setTimeout(function () { n.focus(); }, 50);
    function cerrar() { document.removeEventListener('keydown', esc); bg.remove(); }
    function esc(e) { if (e.key === 'Escape') { cerrar(); track('whatsapp_form_close', base); } }
    document.addEventListener('keydown', esc);
    bg.addEventListener('click', function (e) { if (e.target === bg) { cerrar(); track('whatsapp_form_close', base); } });
    bg.querySelector('.bgw-x').onclick = function () { cerrar(); track('whatsapp_form_close', base); };
    bg.querySelector('.bgw-dir').onclick = function () {
      base.con_datos = 'no'; track('contact_whatsapp', base);
      cerrar(); abrir(a, href);
    };
    form.onsubmit = function (e) {
      e.preventDefault();
      var nom = n.value.trim(), tel = t.value.trim(), digitos = tel.replace(/\D/g, '');
      n.style.borderColor = nom.length < 2 ? '#C81D25' : '';
      t.style.borderColor = digitos.length < 8 ? '#C81D25' : '';
      if (nom.length < 2) return n.focus();
      if (digitos.length < 8) return t.focus();
      ss.set(SS_DATOS, { nombre: nom, telefono: tel });
      enviar({ origen: 'WhatsApp', nombre: nom, telefono: tel, interes: propiedadActual(), mensaje: (function () { try { return new URL(href).searchParams.get('text') || ''; } catch (x) { return ''; } })() });
      base.con_datos = 'si'; track('contact_whatsapp', base);
      cerrar(); abrir(a, conNombre(href, nom));
    };
    track('whatsapp_form_view', { link_location: base.link_location, page_section: base.page_section });
  }

  // Se registra en window (fase de captura) para actuar antes que la medición del sitio:
  // contact_whatsapp se envía recién cuando la persona realmente sigue a WhatsApp.
  window.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('wa.me') === -1 && href.indexOf('api.whatsapp.com') === -1) return;
    e.preventDefault(); e.stopPropagation();
    var previo = ss.get(SS_DATOS);
    if (previo && previo.nombre) { // ya dejó sus datos en esta visita: directo
      var p = { link_location: zona(a), page_section: location.pathname, con_datos: 'previo' };
      track('contact_whatsapp', p);
      abrir(a, conNombre(a.href, previo.nombre));
      return;
    }
    modal(a);
  }, true);
})();
