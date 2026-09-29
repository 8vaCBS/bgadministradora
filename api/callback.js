// Recibe la respuesta de GitHub y entrega el token al panel /admin (protocolo de Decap CMS).
module.exports = async (req, res) => {
  const site = process.env.SITE_URL || 'https://www.bgadministradora.cl';
  const url = new URL(req.url, site);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookie = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('bg_oauth_state='));
  const expected = cookie ? cookie.split('=')[1] : null;

  let status = 'error';
  let content = { message: 'No se pudo iniciar sesión.' };
  try {
    if (!code || !state || !expected || state !== expected) throw new Error('Sesión inválida o expirada. Vuelve a intentarlo.');
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${site}/api/callback` }),
    });
    const data = await r.json();
    if (!data.access_token) throw new Error(data.error_description || 'GitHub no entregó el acceso.');
    status = 'success';
    content = { token: data.access_token, provider: 'github' };
  } catch (e) {
    content = { message: e.message };
  }

  const message = `authorization:github:${status}:${JSON.stringify(content)}`;
  res.setHeader('Set-Cookie', 'bg_oauth_state=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html><body><p>Conectando con el panel…</p><script>
(function () {
  var origin = ${JSON.stringify(site)};
  var message = ${JSON.stringify(message).replace(/</g, '\\u003c')};
  function receive(e) {
    if (e.origin !== origin) return;
    window.opener.postMessage(message, origin);
    window.removeEventListener('message', receive, false);
  }
  window.addEventListener('message', receive, false);
  window.opener && window.opener.postMessage('authorizing:github', origin);
})();
</script></body></html>`);
};
