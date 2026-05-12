const crypto = require('crypto');
const { getCookie } = require('./shopify');

const COOKIE_NAME = 'versen_admin_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 10;

function adminSecret() {
  return process.env.VERSEN_ADMIN_SECRET || process.env.VERSEN_SETUP_SECRET || '';
}

function sessionSecret() {
  return process.env.VERSEN_ADMIN_SESSION_SECRET
    || process.env.VERSEN_EMAIL_VERIFICATION_SECRET
    || process.env.VERSEN_SETUP_SECRET
    || adminSecret();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function verifyAdminPassword(value) {
  const secret = adminSecret();

  if (!secret || !value) {
    return false;
  }

  return safeEqual(value, secret);
}

function signPayload(payload) {
  const secret = sessionSecret();

  if (!secret) {
    return null;
  }

  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');

  return `${body}.${signature}`;
}

function verifySessionToken(token) {
  const secret = sessionSecret();
  const [body, signature] = String(token || '').split('.');

  if (!secret || !body || !signature) {
    return null;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');

  if (!safeEqual(signature, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));

    if (!payload.exp || payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function createAdminSession() {
  return signPayload({
    role: 'versen_admin',
    iat: Date.now(),
    exp: Date.now() + (SESSION_MAX_AGE_SECONDS * 1000),
    nonce: crypto.randomBytes(12).toString('base64url'),
  });
}

function adminCookie(token) {
  const expires = new Date(Date.now() + (SESSION_MAX_AGE_SECONDS * 1000)).toUTCString();
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Strict`;
}

function clearAdminCookie() {
  return `${COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
}

function getAdminSession(req) {
  const payload = verifySessionToken(getCookie(req, COOKIE_NAME));
  return payload && payload.role === 'versen_admin' ? payload : null;
}

function isAdminRequest(req) {
  return Boolean(getAdminSession(req));
}

function requireAdmin(req) {
  const session = getAdminSession(req);

  if (!session) {
    const error = new Error('Admin-session krävs');
    error.status = 401;
    throw error;
  }

  return session;
}

module.exports = {
  adminCookie,
  clearAdminCookie,
  createAdminSession,
  getAdminSession,
  isAdminRequest,
  requireAdmin,
  verifyAdminPassword,
};
