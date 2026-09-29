// Inicio de sesión del panel /admin con GitHub (OAuth). Requiere en Vercel:
// GITHUB_CLIENT_ID y GITHUB_CLIENT_SECRET (OAuth App de GitHub).
const crypto = require('crypto');
module.exports = (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) { res.statusCode = 500; return res.end('Falta configurar GITHUB_CLIENT_ID en Vercel.'); }
  const site = process.env.SITE_URL || 'https://www.bgadministradora.cl';
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `bg_oauth_state=${state}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${site}/api/callback`,
    scope: process.env.GITHUB_SCOPE || 'public_repo',
    state,
  });
  res.statusCode = 302;
  res.setHeader('Location', `https://github.com/login/oauth/authorize?${params}`);
  res.end();
};
