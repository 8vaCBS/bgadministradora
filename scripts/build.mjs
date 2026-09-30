// Genera el sitio en /dist: copia las páginas estáticas y crea /propiedades
// a partir de las fichas en content/propiedades/*.json (editadas desde /admin).
// Si una ficha tiene errores, se omite y el resto del sitio se publica igual.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { marked } from 'marked';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const SITE = 'https://www.bgadministradora.cl';
const IS_PROD = process.env.VERCEL_ENV === 'production';
const WA = '56981749481';
const IGNORE = new Set(['dist', 'node_modules', 'scripts', 'templates', 'content', 'api', '.git', '.github', '.vercel',
  'package.json', 'package-lock.json', 'vercel.json', 'README.md', '.gitignore']);

// ---------- utilidades ----------
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nf = new Intl.NumberFormat('es-CL');
const precioTxt = (p) => {
  if (!p.precio) return 'Precio a consultar';
  if (p.moneda === 'CLP') return `$ ${nf.format(Math.round(p.precio))}`;
  const uf = Number.isInteger(p.precio) ? nf.format(p.precio)
    : new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.precio);
  return `UF ${uf}`;
};
const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const waLink = (msg) => `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`;
// Números al estilo chileno: punto = miles, coma = decimales ("5.200,50" → 5200.5; "70,8" → 70.8).
// También acepta "70.8" (punto decimal) y números ya guardados como número.
const parseNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v).replace(/\s|\$|UF|m2|m²/gi, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
// Acepta enlaces de YouTube: youtu.be/ID, watch?v=ID, /shorts/ID, /embed/ID, /live/ID
const youtubeId = (url) => {
  if (!url) return null;
  const m = String(url).trim().match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
};
const jsonld = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
const ESTADOS = { 'Disponible': 0, 'Reservada': 1, 'Vendida': 2, 'Arrendada': 2 };
const badgeClase = (e) => ({
  'Disponible': 'bg-emerald-600 text-white',
  'Reservada': 'bg-amber-500 text-white',
  'Vendida': 'bg-slate-700 text-white',
  'Arrendada': 'bg-slate-700 text-white',
}[e] || 'bg-slate-700 text-white');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (src === ROOT && (IGNORE.has(e.name) || e.name.startsWith('.'))) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    // Las fotos originales de propiedades no se publican: solo las versiones con marca de agua
    if (!e.isDirectory() && src === path.join(ROOT, 'assets', 'propiedades')) continue;
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// ---------- 1. copiar sitio estático ----------
fs.rmSync(DIST, { recursive: true, force: true });
copyDir(ROOT, DIST);

// ---------- 2. leer fichas ----------
const dir = path.join(ROOT, 'content', 'propiedades');
const fichas = [];
if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      p.slug = slugify(f.replace(/\.json$/, ''));
      if (!p.titulo || !p.slug) throw new Error('falta el título');
      if (p.publicado === false) continue;
      if (p.ejemplo && IS_PROD) continue; // las fichas de ejemplo solo se ven en la vista previa
      p.estado = p.estado || 'Disponible';
      p.operacion = p.operacion || 'Venta';
      p.moneda = p.moneda || 'UF';
      p.fotos = (p.fotos || []).filter((x) => x && x.imagen);
      if (p.portada) p.fotos.unshift({ imagen: p.portada, texto: p.titulo });
      p.fecha = p.fecha || new Date().toISOString();
      for (const k of ['precio', 'm2_utiles', 'm2_totales', 'm2_terreno', 'gastos_comunes', 'dormitorios', 'banos', 'estacionamientos', 'bodegas', 'anio']) {
        const n = parseNum(p[k]);
        if (p[k] !== undefined && p[k] !== null && p[k] !== '' && n === null) console.warn(`⚠ ${f}: "${k}" no es un número válido (${p[k]})`);
        p[k] = n;
      }
      p.url = `${SITE}/propiedades/${p.slug}`;
      fichas.push(p);
    } catch (err) {
      console.warn(`⚠ Ficha omitida (${f}): ${err.message}`);
    }
  }
}
fichas.sort((a, b) => (ESTADOS[a.estado] ?? 3) - (ESTADOS[b.estado] ?? 3)
  || (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0)
  || String(b.fecha).localeCompare(String(a.fecha)));
console.log(`Propiedades publicadas: ${fichas.length}`);

// ---------- 3. optimizar fotos ----------
const imgCache = new Map();
// ---------- marca de agua ----------
// Logo de BG sobre una placa blanca semitransparente, abajo a la derecha.
// Se usa assets/brand/logo-bg.png si existe; si no, se descarga el logo del sitio al compilar.
// Si no hay logo disponible, las fotos se publican sin marca (y se avisa en el log).
const LOGO_URL = 'https://cdn.shopify.com/s/files/1/0773/9683/6592/files/Diseno_sin_titulo_sin_fondo.png?v=1784933992&width=800';
let logoBuf = null;
{
  const local = path.join(ROOT, 'assets', 'brand', 'logo-bg.png');
  try {
    if (fs.existsSync(local)) logoBuf = fs.readFileSync(local);
    else {
      const r = await fetch(LOGO_URL);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      logoBuf = Buffer.from(await r.arrayBuffer());
    }
    logoBuf = await sharp(logoBuf).trim().png().toBuffer();
  } catch (err) {
    console.warn(`⚠ Sin logo para la marca de agua: ${err.message}`);
    logoBuf = null;
  }
}
async function conMarca(pipeline) {
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  if (!logoBuf) return sharp(data);
  const W = info.width, H = info.height;
  const logoW = Math.max(90, Math.round(Math.min(W, H * 1.5) * 0.14));
  const logo = await sharp(logoBuf).resize({ width: logoW }).png().toBuffer({ resolveWithObject: true });
  const pad = Math.round(logoW * 0.08);
  const bw = logo.info.width + pad * 2, bh = logo.info.height + pad * 2;
  const margin = Math.round(Math.min(W, H) * 0.035);
  const left = W - bw - margin, top = H - bh - margin;
  const placa = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}"><rect width="${bw}" height="${bh}" rx="${Math.round(bh * 0.12)}" fill="#ffffff" fill-opacity="0.72"/></svg>`);
  return sharp(data).composite([
    { input: placa, left, top },
    { input: logo.data, left: left + pad, top: top + pad },
  ]);
}

async function foto(ruta) {
  if (!ruta) return null;
  if (imgCache.has(ruta)) return imgCache.get(ruta);
  const src = path.join(ROOT, ruta.replace(/^\//, ''));
  if (!fs.existsSync(src)) { console.warn(`⚠ Foto no encontrada: ${ruta}`); imgCache.set(ruta, null); return null; }
  const base = path.basename(src).replace(/\.[^.]+$/, '');
  const outDir = path.join(DIST, 'assets', 'propiedades', 'web');
  fs.mkdirSync(outDir, { recursive: true });
  try {
    const img = sharp(src).rotate();
    const meta = await img.metadata();
    const ratio = (meta.orientation >= 5 ? meta.width / meta.height : meta.height / meta.width) || 0.75;
    const out = {};
    for (const w of [800, 1600]) {
      const file = `${base}-${w}-wm.webp`;
      const img2 = await conMarca(sharp(src).rotate().resize({ width: w, withoutEnlargement: true }));
      await img2.webp({ quality: 78 }).toFile(path.join(outDir, file));
      out[w] = `/assets/propiedades/web/${file}`;
    }
    const og = `${base}-og-wm.jpg`;
    const ogImg = await conMarca(sharp(src).rotate().resize(1200, 630, { fit: 'cover' }));
    await ogImg.jpeg({ quality: 80 }).toFile(path.join(outDir, og));
    const r = { s: out[800], l: out[1600], og: `/assets/propiedades/web/${og}`, w: 800, h: Math.round(800 * ratio) };
    imgCache.set(ruta, r);
    return r;
  } catch (err) {
    console.warn(`⚠ No se pudo procesar ${ruta}: ${err.message}`);
    imgCache.set(ruta, null);
    return null;
  }
}
for (const p of fichas) {
  p.imgs = [];
  for (const f of p.fotos) {
    const r = await foto(f.imagen);
    if (r) p.imgs.push({ ...r, alt: f.texto || `${p.tipo || 'Propiedad'} en ${p.comuna || ''} - ${p.titulo}` });
  }
}

// ---------- 4. plantilla ----------
const layout = fs.readFileSync(path.join(ROOT, 'templates', 'layout.html'), 'utf8');
const NAV_ON = 'transition-colors flex items-center gap-1.5 bg-brand-red text-white px-3 py-1 rounded-full text-xs font-semibold';
function render(v) {
  const map = {
    TITLE: esc(v.title), DESC: esc(v.desc), CANONICAL: v.canonical, OG_IMAGE: v.og || 'https://cdn.shopify.com/s/files/1/0773/9683/6592/files/Diseno_sin_titulo_sin_fondo.png?v=1784933992',
    ROBOTS: v.robots || 'index, follow, max-image-preview:large', JSONLD: jsonld(v.ld), MAIN: v.main,
    WA_URL: esc(v.wa || waLink('Hola Bárbara, quisiera información sobre sus propiedades en venta')),
    NAV_PROP_CLASS: NAV_ON, PAGE_SCRIPTS: v.scripts || '',
  };
  return layout.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in map ? map[k] : m));
}
const write = (rel, html) => {
  const f = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
};

const tipoSchema = (t) => ({ 'Departamento': 'Apartment', 'Casa': 'SingleFamilyResidence', 'Oficina': 'Place',
  'Local comercial': 'Place', 'Terreno': 'Place', 'Parcela': 'Place', 'Estacionamiento / Bodega': 'Place' }[t] || 'Place');
const opVerbo = (p) => (p.operacion === 'Arriendo' ? 'en arriendo' : 'en venta');

function datos(p) {
  const d = [];
  if (p.dormitorios) d.push(['fa-bed', 'Dormitorios', p.dormitorios]);
  if (p.banos) d.push(['fa-bath', 'Baños', p.banos]);
  if (p.m2_utiles) d.push(['fa-ruler-combined', 'Superficie útil', `${nf.format(p.m2_utiles)} m²`]);
  if (p.m2_totales) d.push(['fa-vector-square', 'Superficie total', `${nf.format(p.m2_totales)} m²`]);
  if (p.m2_terreno) d.push(['fa-map', 'Terreno', `${nf.format(p.m2_terreno)} m²`]);
  if (p.estacionamientos) d.push(['fa-car', 'Estacionamientos', p.estacionamientos]);
  if (p.bodegas) d.push(['fa-box-archive', 'Bodegas', p.bodegas]);
  if (p.gastos_comunes) d.push(['fa-receipt', 'Gastos comunes aprox.', `$ ${nf.format(p.gastos_comunes)}`]);
  if (p.anio) d.push(['fa-calendar', 'Año de construcción', p.anio]);
  if (p.piso) d.push(['fa-building', 'Piso', p.piso]);
  if (p.orientacion) d.push(['fa-compass', 'Orientación', p.orientacion]);
  return d;
}
const resumenDatos = (p) => [
  p.dormitorios && `${p.dormitorios}D`, p.banos && `${p.banos}B`, p.m2_utiles && `${nf.format(p.m2_utiles)} m²`,
  p.estacionamientos && `${p.estacionamientos} est.`].filter(Boolean).join(' · ');

function tarjeta(p) {
  const img = p.imgs[0];
  return `<a href="/propiedades/${p.slug}" class="prop-card bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm hover:shadow-md hover:border-brand-red transition-all group flex flex-col" data-tipo="${esc(p.tipo || '')}" data-comuna="${esc(p.comuna || '')}" data-estado="${esc(p.estado)}">
    <div class="relative aspect-[4/3] bg-slate-100 overflow-hidden">
      ${img ? `<img src="${img.s}" alt="${esc(img.alt)}" width="${img.w}" height="${img.h}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">` : `<div class="w-full h-full flex items-center justify-center text-slate-300 text-4xl"><i class="fa-solid fa-house"></i></div>`}
      <span class="absolute top-3 left-3 text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full shadow ${badgeClase(p.estado)}">${esc(p.estado)}</span>
    </div>
    <div class="p-5 flex flex-col gap-1.5 flex-grow">
      <p class="text-[11px] font-bold text-brand-red uppercase tracking-wider">${esc(p.tipo || 'Propiedad')} ${opVerbo(p)} · ${esc(p.comuna || '')}</p>
      <h3 class="font-heading font-bold text-slate-900 leading-snug">${esc(p.titulo)}</h3>
      <p class="text-xs text-slate-500">${esc(resumenDatos(p))}</p>
      <p class="font-heading font-extrabold text-lg text-slate-900 mt-auto pt-2">${esc(precioTxt(p))}</p>
    </div>
  </a>`;
}

const FORM_JS = `    <script>
        async function handlePropSubmit(event) {
            event.preventDefault();
            const form = event.target, btn = form.querySelector('button[type="submit"]');
            const ok = form.parentElement.querySelector('.prop-ok'), err = form.parentElement.querySelector('.prop-error');
            ok.classList.add('hidden'); err.classList.add('hidden');
            if (form._honey && form._honey.value) return;
            const prop = form.dataset.propiedad || 'Consulta general de propiedades';
            const datos = {
                _subject: 'Nueva solicitud web BG - Propiedades - ' + prop,
                _template: 'table', _captcha: 'false', _replyto: form.email.value,
                'Nombre': form.nombre.value, 'Teléfono': form.telefono.value, 'Correo': form.email.value,
                'Propiedad': prop, 'Página': location.href, 'Mensaje': form.mensaje.value,
                'Área seleccionada': 'Venta y Corretaje de Propiedades (barbaragc@bgadministradora.cl)'
            };
            const txt = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
            try {
                const r = await fetch('https://formsubmit.co/ajax/barbaragc@bgadministradora.cl', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(datos) });
                const j = await r.json().catch(() => ({}));
                if (r.ok && String(j.success) === 'true') {
                    if (window.bgTrack) window.bgTrack('generate_lead', { form_area: 'propiedad', propiedad: prop.slice(0, 90), link_location: location.pathname });
                    form.reset(); ok.classList.remove('hidden');
                } else { throw new Error(j.message || ('HTTP ' + r.status)); }
            } catch (e) {
                if (window.bgTrack) window.bgTrack('form_error', { form_area: 'propiedad', error_message: String(e.message).slice(0, 90) });
                err.classList.remove('hidden');
            } finally { btn.disabled = false; btn.innerHTML = txt; }
        }
    </script>`;

function formulario(propTitulo, mensajeInicial) {
  const inp = 'w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 focus:ring-2 focus:ring-brand-red focus:outline-none';
  return `<form onsubmit="handlePropSubmit(event)" data-propiedad="${esc(propTitulo)}" class="space-y-3">
      <div><label class="block text-xs font-bold text-slate-700 mb-1">Nombre *</label><input name="nombre" required class="${inp}" placeholder="Ej: Juan Pérez"></div>
      <div class="grid sm:grid-cols-2 gap-3">
        <div><label class="block text-xs font-bold text-slate-700 mb-1">Teléfono *</label><input name="telefono" type="tel" required class="${inp}" placeholder="+56 9 1234 5678"></div>
        <div><label class="block text-xs font-bold text-slate-700 mb-1">Correo *</label><input name="email" type="email" required class="${inp}" placeholder="ejemplo@correo.cl"></div>
      </div>
      <div><label class="block text-xs font-bold text-slate-700 mb-1">Mensaje *</label><textarea name="mensaje" rows="3" required class="${inp}">${esc(mensajeInicial)}</textarea></div>
      <input type="text" name="_honey" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
      <button type="submit" class="w-full bg-brand-red hover:bg-brand-darkred text-white font-bold py-3 px-6 rounded-xl text-xs uppercase tracking-wider shadow-md transition-all flex items-center justify-center gap-2"><i class="fa-solid fa-paper-plane"></i> Enviar consulta</button>
    </form>
    <div class="prop-ok hidden mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 text-center"><strong>¡Consulta enviada!</strong> Te contactaremos a la brevedad.</div>
    <div class="prop-error hidden mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 text-center" role="alert"><strong>No pudimos enviar tu consulta.</strong> Escríbenos por <a href="https://wa.me/${WA}" class="underline font-bold">WhatsApp</a>.</div>`;
}

const breadcrumbLd = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([n, u], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: u })) });

// ---------- 5. ficha de cada propiedad ----------
for (const p of fichas) {
  const titulo = `${p.titulo} | ${p.tipo || 'Propiedad'} ${opVerbo(p)} en ${p.comuna || 'Chile'} | BG Administradora`;
  const desc = (p.resumen || `${p.tipo || 'Propiedad'} ${opVerbo(p)} en ${p.comuna || ''}. ${resumenDatos(p)}. ${precioTxt(p)}.`).slice(0, 160);
  const waMsg = `Hola Bárbara, me interesa la propiedad "${p.titulo}" (${p.url}). ¿Me puedes dar más información?`;
  const [first, ...rest] = p.imgs;
  const galeria = p.imgs.length ? `
      <div class="space-y-3">
        <div class="relative rounded-2xl overflow-hidden bg-slate-900 aspect-[4/3]">
          <img id="foto-principal" src="${first.l}" srcset="${first.s} 800w, ${first.l} 1600w" sizes="(min-width:1024px) 60vw, 100vw" alt="${esc(first.alt)}" width="${first.w}" height="${first.h}" fetchpriority="high" class="w-full h-full object-contain">
          <span class="absolute top-4 left-4 text-xs font-extrabold uppercase tracking-wider px-3 py-1 rounded-full shadow ${badgeClase(p.estado)}">${esc(p.estado)}</span>
          ${p.imgs.length > 1 ? `<button type="button" onclick="cambiarFoto(-1)" aria-label="Foto anterior" class="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-slate-800 shadow flex items-center justify-center"><i class="fa-solid fa-chevron-left"></i></button>
          <button type="button" onclick="cambiarFoto(1)" aria-label="Foto siguiente" class="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-slate-800 shadow flex items-center justify-center"><i class="fa-solid fa-chevron-right"></i></button>
          <span id="foto-contador" class="absolute bottom-3 right-3 text-[11px] font-bold bg-black/60 text-white px-2 py-0.5 rounded-full">1 / ${p.imgs.length}</span>` : ''}
        </div>
        ${p.imgs.length > 1 ? `<div class="flex gap-2 overflow-x-auto pb-1 max-w-full overscroll-x-contain snap-x">${p.imgs.map((im, i) => `<button type="button" onclick="verFoto(${i})" class="miniatura flex-shrink-0 w-20 h-16 sm:w-24 sm:h-20 rounded-lg overflow-hidden border-2 ${i ? 'border-transparent' : 'border-brand-red'}" aria-label="Ver foto ${i + 1}"><img src="${im.s}" alt="" loading="lazy" class="w-full h-full object-cover"></button>`).join('')}</div>` : ''}
      </div>` : '';
  const fotosJs = p.imgs.length > 1 ? `    <script>
        const FOTOS = ${JSON.stringify(p.imgs.map((i) => ({ s: i.s, l: i.l, alt: i.alt })))};
        let fotoActual = 0;
        function verFoto(i) {
            fotoActual = (i + FOTOS.length) % FOTOS.length;
            const f = FOTOS[fotoActual], el = document.getElementById('foto-principal');
            el.src = f.l; el.srcset = f.s + ' 800w, ' + f.l + ' 1600w'; el.alt = f.alt;
            document.getElementById('foto-contador').textContent = (fotoActual + 1) + ' / ' + FOTOS.length;
            document.querySelectorAll('.miniatura').forEach((b, j) => { b.classList.toggle('border-brand-red', j === fotoActual); b.classList.toggle('border-transparent', j !== fotoActual); });
        }
        function cambiarFoto(d) { verFoto(fotoActual + d); }
        // Deslizar con el dedo para cambiar de foto (celular)
        (function () {
            const z = document.getElementById('foto-principal').parentElement; let x0 = null, y0 = null;
            z.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
            z.addEventListener('touchend', e => {
                if (x0 === null) return;
                const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
                if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) cambiarFoto(dx < 0 ? 1 : -1);
                x0 = null;
            }, { passive: true });
        })();
        // Mantener visible la miniatura activa
        const _ver = verFoto; verFoto = function (i) { _ver(i); const m = document.querySelectorAll('.miniatura')[fotoActual]; if (m) m.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); };
    </script>` : '';
  const caracteristicas = (p.caracteristicas || []).filter(Boolean);
  const ytId = youtubeId(p.video);
  if (p.video && !ytId) console.warn(`⚠ Enlace de video no reconocido en ${p.slug}: ${p.video}`);
  const videoHtml = ytId ? `
              <div>
                <h2 class="font-heading text-xl font-bold text-slate-900 mb-3">Video</h2>
                <button type="button" id="video-facade" data-yt="${ytId}" onclick="cargarVideo(this)" aria-label="Reproducir video de la propiedad" class="relative block w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 group">
                  <img src="https://i.ytimg.com/vi/${ytId}/hqdefault.jpg" alt="Video de ${esc(p.titulo)}" loading="lazy" class="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity">
                  <span class="absolute inset-0 flex items-center justify-center"><span class="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-brand-red text-white flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform"><i class="fa-solid fa-play text-2xl sm:text-3xl ml-1"></i></span></span>
                </button>
              </div>` : '';
  const videoJs = ytId ? `    <script>
        function cargarVideo(btn) {
            const f = document.createElement('iframe');
            f.src = 'https://www.youtube-nocookie.com/embed/' + btn.dataset.yt + '?autoplay=1&rel=0&playsinline=1';
            f.title = 'Video de la propiedad';
            f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
            f.allowFullscreen = true;
            f.className = 'w-full aspect-video rounded-2xl';
            btn.replaceWith(f);
            if (window.bgTrack) window.bgTrack('video_play', { propiedad: document.title.slice(0, 90) });
        }
    </script>` : '';
  const otras = fichas.filter((o) => o !== p && o.estado !== 'Vendida').slice(0, 3);
  const main = `    <main class="flex-grow overflow-x-clip">
      <section class="bg-slate-50 py-8 sm:py-12">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav aria-label="Ruta de navegación" class="text-xs text-slate-500 mb-5"><a href="/" class="hover:text-brand-red">Inicio</a> <span class="mx-1">/</span> <a href="/propiedades" class="hover:text-brand-red">Propiedades</a> <span class="mx-1">/</span> <span class="text-slate-800">${esc(p.titulo)}</span></nav>
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div class="lg:col-span-8 space-y-8 min-w-0">
              ${galeria}
              ${videoHtml}
              <div>
                <p class="text-xs font-bold text-brand-red uppercase tracking-wider">${esc(p.tipo || 'Propiedad')} ${opVerbo(p)} · ${esc([p.sector, p.comuna].filter(Boolean).join(', '))}</p>
                <h1 class="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1">${esc(p.titulo)}</h1>
                <p class="font-heading text-2xl font-extrabold text-slate-900 mt-3 lg:hidden">${esc(precioTxt(p))}</p>
                <a href="${esc(waLink(waMsg))}" target="_blank" rel="noopener" class="lg:hidden mt-4 w-full inline-flex justify-center items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl text-sm shadow-md"><i class="fa-brands fa-whatsapp text-lg"></i> Consultar por WhatsApp</a>
              </div>
              ${datos(p).length ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">${datos(p).map(([ic, l, v]) => `<div class="bg-white border border-slate-200 rounded-xl p-4"><i class="fa-solid ${ic} text-brand-red"></i><p class="text-[11px] text-slate-500 mt-1">${l}</p><p class="font-bold text-slate-900 text-sm">${esc(v)}</p></div>`).join('')}</div>` : ''}
              ${p.descripcion ? `<div><h2 class="font-heading text-xl font-bold text-slate-900 mb-3">Descripción</h2><div class="prosa text-sm text-slate-700 leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_strong]:font-bold [&_h3]:font-heading [&_h3]:font-bold [&_h3]:text-slate-900">${marked.parse(String(p.descripcion).replace(/<[^>]*>/g, ''))}</div></div>` : ''}
              ${caracteristicas.length ? `<div><h2 class="font-heading text-xl font-bold text-slate-900 mb-3">Características</h2><ul class="grid sm:grid-cols-2 gap-2 text-sm text-slate-700">${caracteristicas.map((c) => `<li class="flex gap-2"><i class="fa-solid fa-check text-brand-red mt-1"></i>${esc(c)}</li>`).join('')}</ul></div>` : ''}
              <div class="bg-white border border-slate-200 rounded-2xl p-5 text-sm text-slate-700"><p class="font-heading font-bold text-slate-900 mb-1"><i class="fa-solid fa-location-dot text-brand-red mr-1.5"></i>Ubicación</p><p>${esc([p.sector, p.comuna, p.region].filter(Boolean).join(', ') || 'Consultar')}. La dirección exacta se entrega al coordinar la visita.</p></div>
            </div>
            <aside class="lg:col-span-4 min-w-0">
              <div id="contacto-propiedad" class="lg:sticky lg:top-28 bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4 scroll-mt-28">
                <div class="hidden lg:block"><p class="text-xs text-slate-500">${p.operacion === 'Arriendo' ? 'Arriendo mensual' : 'Precio de venta'}</p><p class="font-heading text-3xl font-extrabold text-slate-900">${esc(precioTxt(p))}</p></div>
                <a href="${esc(waLink(waMsg))}" target="_blank" rel="noopener" class="w-full inline-flex justify-center items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl text-sm shadow-md"><i class="fa-brands fa-whatsapp text-lg"></i> Consultar por WhatsApp</a>
                <p class="text-xs text-slate-500 text-center">o déjanos tus datos y te contactamos</p>
                ${formulario(p.titulo, `Hola, me interesa la propiedad "${p.titulo}". Quisiera coordinar una visita.`)}
                <div class="flex items-center gap-3 pt-3 border-t border-slate-100">
                  <img src="https://cdn.shopify.com/s/files/1/0773/9683/6592/files/Diseno_sin_titulo_9.png?v=1784934146" alt="Bárbara Gutiérrez" class="w-11 h-11 rounded-full object-cover border-2 border-brand-red">
                  <div><p class="text-sm font-bold text-slate-900">Bárbara Gutiérrez</p><p class="text-[11px] text-slate-500">BG Administradora Inmobiliaria</p></div>
                </div>
              </div>
            </aside>
          </div>
          <p class="text-[11px] text-slate-400 mt-8">Precio y condiciones sujetos a confirmación. Publicado el ${new Date(p.fecha).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric' })}.</p>
        </div>
      </section>
      ${otras.length ? `<section class="py-12 bg-white"><div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"><h2 class="font-heading text-2xl font-extrabold text-slate-900 mb-6">Otras propiedades</h2><div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">${otras.map(tarjeta).join('')}</div></div></section>` : ''}
    </main>`;
  const offer = { '@type': 'Offer', price: p.precio || undefined, priceCurrency: p.moneda === 'CLP' ? 'CLP' : 'CLF',
    availability: p.estado === 'Disponible' ? 'https://schema.org/InStock' : p.estado === 'Reservada' ? 'https://schema.org/LimitedAvailability' : 'https://schema.org/SoldOut',
    businessFunction: p.operacion === 'Arriendo' ? 'http://purl.org/goodrelations/v1#LeaseOut' : 'http://purl.org/goodrelations/v1#Sell',
    seller: { '@id': `${SITE}/#empresa` } };
  const inmueble = { '@type': tipoSchema(p.tipo), name: p.titulo,
    address: { '@type': 'PostalAddress', addressLocality: p.comuna, addressRegion: p.region, addressCountry: 'CL' } };
  if (p.dormitorios) inmueble.numberOfBedrooms = p.dormitorios;
  if (p.banos) inmueble.numberOfBathroomsTotal = p.banos;
  if (p.m2_utiles) inmueble.floorSize = { '@type': 'QuantitativeValue', value: p.m2_utiles, unitCode: 'MTK' };
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'RealEstateListing', '@id': `${p.url}#listing`, url: p.url, name: p.titulo, description: desc,
      datePosted: p.fecha, image: p.imgs.map((i) => SITE + i.l), offers: offer, about: inmueble, inLanguage: 'es-CL' },
    breadcrumbLd([['Inicio', `${SITE}/`], ['Propiedades', `${SITE}/propiedades`], [p.titulo, p.url]]) ] };
  if (ytId) ld['@graph'].push({ '@type': 'VideoObject', '@id': `${p.url}#video`, name: `Video: ${p.titulo}`, description: desc,
    thumbnailUrl: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`, uploadDate: p.fecha,
    embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}`, contentUrl: `https://www.youtube.com/watch?v=${ytId}` });
  write(`propiedades/${p.slug}/index.html`, render({ title: titulo, desc, canonical: p.url, og: first ? SITE + first.og : undefined,
    robots: p.ejemplo ? 'noindex, nofollow' : undefined, ld, main, wa: waLink(waMsg), scripts: fotosJs + '\n' + videoJs + '\n' + FORM_JS }));
}

// ---------- 6. listado /propiedades ----------
{
  const tipos = [...new Set(fichas.map((p) => p.tipo).filter(Boolean))].sort();
  const comunas = [...new Set(fichas.map((p) => p.comuna).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const sel = 'px-4 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 bg-white focus:ring-2 focus:ring-brand-red focus:outline-none';
  const main = `    <main class="flex-grow overflow-x-clip">
      <section class="relative bg-brand-black text-white py-12 sm:py-16 overflow-hidden">
        <div class="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-brand-red blur-3xl opacity-20 pointer-events-none"></div>
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <nav aria-label="Ruta de navegación" class="text-xs text-slate-400 mb-5"><a href="/" class="hover:text-white">Inicio</a> <span class="mx-1">/</span> <span class="text-slate-200">Propiedades</span></nav>
          <h1 class="font-heading text-3xl sm:text-4xl font-extrabold">Propiedades en venta</h1>
          <p class="text-slate-300 mt-3 max-w-2xl text-sm sm:text-base">Departamentos, casas y otras propiedades que BG Administradora Inmobiliaria está comercializando. Consulta directamente con Bárbara Gutiérrez.</p>
        </div>
      </section>
      <section class="py-10 sm:py-14 bg-slate-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          ${fichas.length ? `<div class="flex flex-col sm:flex-row gap-3 mb-8">
            <label class="sr-only" for="f-tipo">Tipo</label><select id="f-tipo" class="${sel}"><option value="">Todos los tipos</option>${tipos.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
            <label class="sr-only" for="f-comuna">Comuna</label><select id="f-comuna" class="${sel}"><option value="">Todas las comunas</option>${comunas.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
            <label class="inline-flex items-center gap-2 text-xs text-slate-700 sm:ml-2"><input id="f-disp" type="checkbox" class="accent-[#C81D25]"> Solo disponibles</label>
            <p id="f-total" class="text-xs text-slate-500 sm:ml-auto self-center"></p>
          </div>
          <div id="listado" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">${fichas.map(tarjeta).join('')}</div>
          <p id="sin-resultados" class="hidden text-center text-sm text-slate-500 py-12">No hay propiedades con esos filtros.</p>`
          : `<div class="text-center py-16"><i class="fa-solid fa-house text-4xl text-slate-300"></i><p class="font-heading font-bold text-slate-900 mt-4">Pronto publicaremos nuevas propiedades</p><p class="text-sm text-slate-500 mt-1">Escríbenos y te avisamos cuando haya una que calce con lo que buscas.</p></div>`}
        </div>
      </section>
      <section id="contacto-propiedad" class="py-14 bg-white scroll-mt-28">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-2 gap-10 items-start">
          <div class="space-y-4">
            <h2 class="font-heading text-2xl font-extrabold text-slate-900">¿Buscas algo específico?</h2>
            <p class="text-sm text-slate-600">Cuéntanos qué tipo de propiedad, comuna y presupuesto buscas, y te avisamos cuando tengamos una opción.</p>
            <a href="${esc(waLink('Hola Bárbara, estoy buscando una propiedad y quisiera que me avisen de opciones'))}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-5 rounded-xl text-sm shadow-md"><i class="fa-brands fa-whatsapp text-lg"></i> Escribir por WhatsApp</a>
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-5 mt-4"><p class="font-heading font-bold text-slate-900 text-sm">¿Quieres vender tu propiedad?</p><p class="text-xs text-slate-600 mt-1">Te acompañamos en precio, documentos y todo el proceso.</p><a href="/vender-mi-departamento" class="inline-flex items-center gap-1.5 text-brand-red font-bold text-xs mt-2">Conoce el servicio de venta <i class="fa-solid fa-arrow-right"></i></a></div>
          </div>
          <div class="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">${formulario('Consulta general de propiedades', 'Hola, estoy buscando: ')}</div>
        </div>
      </section>
    </main>`;
  const filtrosJs = fichas.length ? `    <script>
        (function () {
            const t = document.getElementById('f-tipo'), c = document.getElementById('f-comuna'), d = document.getElementById('f-disp');
            const cards = [...document.querySelectorAll('#listado .prop-card')];
            function filtrar() {
                let n = 0;
                cards.forEach(el => {
                    const ok = (!t.value || el.dataset.tipo === t.value) && (!c.value || el.dataset.comuna === c.value) && (!d.checked || el.dataset.estado === 'Disponible');
                    el.classList.toggle('hidden', !ok); if (ok) n++;
                });
                document.getElementById('f-total').textContent = n + (n === 1 ? ' propiedad' : ' propiedades');
                document.getElementById('sin-resultados').classList.toggle('hidden', n > 0);
            }
            [t, c, d].forEach(e => e.addEventListener('change', filtrar)); filtrar();
        })();
    </script>` : '';
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': `${SITE}/propiedades#webpage`, url: `${SITE}/propiedades`, name: 'Propiedades en venta', inLanguage: 'es-CL',
      mainEntity: { '@type': 'ItemList', itemListElement: fichas.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: p.url, name: p.titulo })) } },
    breadcrumbLd([['Inicio', `${SITE}/`], ['Propiedades', `${SITE}/propiedades`]]) ] };
  const cover = fichas.find((p) => p.imgs[0]);
  write('propiedades/index.html', render({ title: 'Propiedades en Venta | BG Administradora Inmobiliaria',
    desc: 'Departamentos, casas y otras propiedades en venta comercializadas por BG Administradora Inmobiliaria. Consulta directa con Bárbara Gutiérrez.',
    canonical: `${SITE}/propiedades`, og: cover ? SITE + cover.imgs[0].og : undefined, ld, main, scripts: filtrosJs + '\n' + FORM_JS }));
}

// ---------- 7. destacadas en la página de venta ----------
{
  const f = path.join(DIST, 'vender-mi-departamento', 'index.html');
  if (fs.existsSync(f)) {
    const disp = fichas.filter((p) => p.estado !== 'Vendida').slice(0, 3);
    const bloque = disp.length ? `<section id="propiedades" class="py-16 lg:py-20 bg-white border-t border-slate-200">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
                    <div><span class="text-xs font-extrabold text-brand-red uppercase tracking-widest bg-red-100 px-3 py-1 rounded-full">En Venta</span>
                    <h2 class="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900 mt-3">Propiedades que estamos vendiendo</h2></div>
                    <a href="/propiedades" class="inline-flex items-center gap-2 text-brand-red font-bold text-sm">Ver todas <i class="fa-solid fa-arrow-right"></i></a>
                </div>
                <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">${disp.map(tarjeta).join('')}</div>
            </div>
        </section>` : '';
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('<!--PROPIEDADES_DESTACADAS-->', bloque));
  }
}

// ---------- 8. sitemap y llms.txt ----------
{
  const sm = path.join(DIST, 'sitemap.xml');
  if (fs.existsSync(sm)) {
    const hoy = new Date().toISOString().slice(0, 10);
    const urls = [`${SITE}/propiedades`, ...fichas.filter((p) => !p.ejemplo).map((p) => p.url)]
      .map((u) => `  <url>\n    <loc>${u}</loc>\n    <lastmod>${hoy}</lastmod>\n  </url>`).join('\n');
    fs.writeFileSync(sm, fs.readFileSync(sm, 'utf8').replace('</urlset>', `${urls}\n</urlset>`));
  }
  const ll = path.join(DIST, 'llms.txt');
  if (fs.existsSync(ll)) {
    const lista = fichas.filter((p) => !p.ejemplo);
    const txt = `\n\n## Propiedades en venta\n- [Listado de propiedades](${SITE}/propiedades)\n` +
      lista.map((p) => `- [${p.titulo}](${p.url}): ${p.tipo || 'Propiedad'} ${opVerbo(p)} en ${p.comuna || ''}. ${resumenDatos(p)}. ${precioTxt(p)}. Estado: ${p.estado}.`).join('\n');
    fs.appendFileSync(ll, txt + '\n');
  }
}
console.log('✔ Sitio generado en /dist');
