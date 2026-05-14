const crypto = require('crypto');
const {
  getCookie,
  readBody,
  sendJson,
} = require('../lib/shopify');
const { getCustomerSession } = require('./membership');
const {
  cancelStripeMembership,
  createStripeBillingPortalSession,
} = require('../lib/membership-service');
const {
  appendProductSuggestion,
  isSupabaseConfigured,
  logAdminActivity,
  logEmail,
  updateProfilePreferences,
  upsertSupportTicket,
} = require('../lib/supabase');
const {
  createSupabaseUser,
  findSupabaseAccountByEmail,
  refreshSupabaseSession,
  signInWithPassword,
  updateSupabasePassword,
} = require('../lib/supabase-auth');
const {
  sendPasswordResetEmail: sendPasswordResetTemplateEmail,
  sendVerificationRequestEmail,
  sendWelcomeEmail,
} = require('../lib/email');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function clean(value, maxLength = 4000) {
  return String(value || '').trim().slice(0, maxLength);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeVisitDevice(device = {}) {
  const screen = device.screen && typeof device.screen === 'object' ? device.screen : {};
  const connection = device.connection && typeof device.connection === 'object' ? device.connection : null;

  return {
    path: clean(device.path, 260),
    referrer: clean(device.referrer, 160),
    title: clean(device.title, 160),
    language: clean(device.language, 40),
    languages: Array.isArray(device.languages) ? device.languages.map((item) => clean(item, 40)).slice(0, 5) : [],
    platform: clean(device.platform, 80),
    userAgent: clean(device.userAgent, 500),
    brands: Array.isArray(device.brands) ? device.brands.slice(0, 8).map((brand) => ({
      brand: clean(brand && brand.brand, 80),
      version: clean(brand && brand.version, 20),
    })) : [],
    mobileHint: Boolean(device.mobileHint),
    deviceType: clean(device.deviceType, 40),
    os: clean(device.os, 80),
    browser: clean(device.browser, 80),
    screen: {
      width: Number(screen.width) || 0,
      height: Number(screen.height) || 0,
      dpr: Number(screen.dpr) || 1,
      viewportWidth: Number(screen.viewportWidth) || 0,
      viewportHeight: Number(screen.viewportHeight) || 0,
    },
    touch: Number(device.touch) || 0,
    connection: connection ? {
      effectiveType: clean(connection.effectiveType, 40),
      saveData: Boolean(connection.saveData),
    } : null,
    deviceModelGuess: clean(device.deviceModelGuess, 120),
  };
}

function normalizeVisitCustomer(customer = null) {
  if (!customer || typeof customer !== 'object') {
    return null;
  }

  return {
    id: clean(customer.id, 120),
    email: clean(customer.email, 180).toLowerCase(),
    member: Boolean(customer.member),
  };
}

function logDeviceVisit(req, body) {
  console.log(JSON.stringify({
    level: 'info',
    msg: 'device_visit',
    route: '/api/account',
    at: new Date().toISOString(),
    vercelId: req.headers['x-vercel-id'] || '',
    device: normalizeVisitDevice(body.device),
    customer: normalizeVisitCustomer(body.customer),
  }));
}

function setAuthCookies(res, session) {
  const expires = session.expires_at
    ? new Date(Number(session.expires_at) * 1000).toUTCString()
    : new Date(Date.now() + (Number(session.expires_in || 3600) * 1000)).toUTCString();
  const refreshExpires = new Date(Date.now() + (1000 * 60 * 60 * 24 * 60)).toUTCString();
  res.setHeader('Set-Cookie', [
    `versen_customer_token=${encodeURIComponent(session.access_token)}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`,
    `versen_refresh_token=${encodeURIComponent(session.refresh_token || '')}; Path=/; Expires=${refreshExpires}; HttpOnly; Secure; SameSite=Lax`,
  ]);
}

function clearAuthCookies(res) {
  res.setHeader('Set-Cookie', [
    'versen_customer_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
    'versen_refresh_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
  ]);
}

function getBaseUrl(req) {
  return process.env.VERSEN_SITE_URL || `https://${req.headers.host}`;
}

function verificationSecret() {
  return process.env.VERSEN_EMAIL_VERIFICATION_SECRET || process.env.VERSEN_SETUP_SECRET;
}

function signPayload(payload) {
  const secret = verificationSecret();

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

function verifyPayload(token) {
  const secret = verificationSecret();
  const [body, signature] = String(token || '').split('.');

  if (!secret || !body || !signature) {
    return null;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');

  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
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

async function sendVerificationEmail(req, payload) {
  const token = signPayload(payload);

  if (!token) {
    return {
      ok: false,
      status: 500,
      body: { error: 'Emailverifiering saknar hemlighet i Vercel' },
    };
  }

  const verificationUrl = `${getBaseUrl(req)}/konto?verify=${encodeURIComponent(token)}&next=${encodeURIComponent(payload.next || '')}`;

  const result = await sendVerificationRequestEmail({
    to: payload.email,
    verificationUrl,
    next: payload.next,
  });

  return {
    ok: result.ok,
    status: result.ok ? 200 : (result.status || 503),
    body: result.ok
      ? { status: 'Verifieringsmail skickat. Kontrollera inkorgen och skräpposten.' }
      : { error: 'Kunde inte skicka verifieringsmail', provider: 'Resend', details: result.body || result },
  };
}

async function sendPasswordResetEmail(req, payload) {
  const token = signPayload({
    type: 'password_reset',
    customerId: payload.customerId,
    email: payload.email,
    exp: Date.now() + (1000 * 60 * 30),
    nonce: crypto.randomBytes(12).toString('hex'),
  });

  if (!token) {
    return {
      ok: false,
      status: 500,
      body: { error: 'Lösenordsåterställning saknar hemlighet i Vercel' },
    };
  }

  const resetUrl = `${getBaseUrl(req)}/konto?reset=${encodeURIComponent(token)}`;

  const result = await sendPasswordResetTemplateEmail({
    to: payload.email,
    resetUrl,
  });

  return {
    ok: result.ok,
    status: result.ok ? 200 : (result.status || 503),
    body: result.ok
      ? { status: 'Återställningsmail skickat. Kontrollera inkorgen.' }
      : { error: 'Kunde inte skicka återställningsmail', provider: 'Resend', details: result.body || result },
  };
}

function supportNumberFromId(ticketId) {
  return `VS-SUP-${String(ticketId || '').replace(/^sup_/, '').slice(0, 6).toUpperCase()}`;
}

async function sendSupportEmail(req, res, body) {
  const session = await getCustomerSession(getCookie(req, 'versen_customer_token')).catch(() => ({ authenticated: false, customer: null }));
  const customer = session.authenticated && session.customer ? session.customer : null;
  const name = customer
    ? clean(customer.displayName || customer.firstName || body.name || customer.email, 120)
    : clean(body.name, 120);
  const email = customer
    ? clean(customer.email, 180).toLowerCase()
    : clean(body.email, 180).toLowerCase();
  const topic = clean(body.topic, 80) || 'Support';
  const order = clean(body.order, 80);
  const message = clean(body.message, 3000);

  if (!name || !isEmail(email) || !message) {
    sendJson(res, 400, { error: 'Fyll i namn, giltig email och meddelande.' });
    return;
  }

  const ticketId = `sup_${crypto.randomBytes(10).toString('hex')}`;
  const supportNumber = supportNumberFromId(ticketId);
  const chatEnabled = Boolean(customer && customer.id);
  const category = topic.toLowerCase().includes('retur') ? 'returer' : 'övrigt';
  let savedTicket = null;

  if (isSupabaseConfigured()) {
    try {
      savedTicket = await upsertSupportTicket({
        id: ticketId,
        user_id: customer ? customer.id : null,
        order_id: order || null,
        email,
        name,
        subject: topic,
        category,
        status: 'nytt',
        priority: 'normal',
        unread: true,
        message,
        messages: [{
          id: `msg_${crypto.randomBytes(8).toString('hex')}`,
          from: 'customer',
          name,
          email,
          message,
          attachments: [],
          created_at: new Date().toISOString(),
        }],
        metadata: {
          source: 'contact_form',
          channel: chatEnabled ? 'chat' : 'email',
          support_number: supportNumber,
          order_reference: order || null,
          customer_unread: false,
          admin_unread: true,
          latest_message_at: new Date().toISOString(),
          customer_member: Boolean(customer && customer.member),
          chat_enabled: chatEnabled,
        },
      });
      await logAdminActivity({
        action: 'support_ticket_created',
        target_type: 'support_ticket',
        target_id: ticketId,
        message: `Nytt supportärende från ${email}`,
        metadata: { topic, order: order || null },
      }).catch(() => {});
    } catch (error) {
      savedTicket = null;
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.VERSEN_EMAIL_FROM || 'Versen <hej@versen.se>';
  const supportEmail = process.env.VERSEN_SUPPORT_EMAIL || 'hej@versen.se';

  if (!apiKey) {
    sendJson(res, savedTicket ? 200 : 503, {
      status: savedTicket
        ? (chatEnabled ? 'Ärendet är skapat. Du kan följa det från din profilsida.' : 'Ärendet är sparat. Mail är inte konfigurerat ännu.')
        : undefined,
      error: savedTicket ? undefined : 'Supportmail är inte konfigurerat ännu.',
      ticketId: savedTicket ? ticketId : undefined,
      supportNumber: savedTicket ? supportNumber : undefined,
      chat: chatEnabled && savedTicket ? { id: ticketId, supportNumber } : null,
    });
    return;
  }

  const safe = {
    name: escapeHtml(name),
    email: escapeHtml(email),
    topic: escapeHtml(topic),
    order: escapeHtml(order),
    message: escapeHtml(message).replace(/\n/g, '<br>'),
  };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [supportEmail],
      reply_to: email,
      subject: `Versen support: ${topic}`,
      html: `
        <div style="font-family:Arial,sans-serif;background:#090a0d;color:#fff;padding:28px">
          <h1 style="margin:0 0 16px">Nytt supportärende</h1>
          <p><strong>Namn:</strong> ${safe.name}</p>
          <p><strong>Email:</strong> ${safe.email}</p>
          <p><strong>Ärende:</strong> ${safe.topic}</p>
          ${order ? `<p><strong>Order:</strong> ${safe.order}</p>` : ''}
          <div style="margin-top:18px;padding:18px;border:1px solid rgba(255,255,255,.15);border-radius:14px;background:rgba(255,255,255,.05)">
            ${safe.message}
          </div>
        </div>
      `,
      text: `Nytt supportärende\n\nNamn: ${name}\nEmail: ${email}\nÄrende: ${topic}\n${order ? `Order: ${order}\n` : ''}\n${message}`,
    }),
  });

  if (!response.ok) {
    let details = null;

    try {
      details = await response.json();
    } catch (error) {
      details = { message: 'Resend svarade inte med JSON' };
    }

    sendJson(res, response.status, {
      error: details.message || details.error || 'Kunde inte skicka supportärendet.',
      details,
      ticketId: savedTicket ? ticketId : undefined,
    });
    return;
  }

  let emailResult = null;

  try {
    emailResult = await response.json();
  } catch (error) {
    emailResult = null;
  }

  if (isSupabaseConfigured()) {
    await logEmail({
      order_id: order || null,
      type: 'support_ticket',
      resend_email_id: emailResult && emailResult.id,
      status: 'sent',
    }).catch(() => {});
    await logAdminActivity({
      action: 'support_email_sent',
      target_type: 'support_ticket',
      target_id: savedTicket ? ticketId : null,
      message: `Supportmail mottaget från ${email}`,
      metadata: { resend_id: emailResult && emailResult.id },
    }).catch(() => {});
  }

  sendJson(res, 200, {
    status: chatEnabled ? 'Ärendet är skapat. Du kan följa det från din profilsida.' : 'Meddelandet är skickat. Vi återkommer via email.',
    ticketId: savedTicket ? ticketId : undefined,
    supportNumber: savedTicket ? supportNumber : undefined,
    chat: chatEnabled && savedTicket ? { id: ticketId, supportNumber } : null,
  });
}

async function sendWaitlistEmail(res, body) {
  const email = clean(body.email, 180).toLowerCase();

  if (!isEmail(email)) {
    sendJson(res, 400, { error: 'Skriv en giltig email.' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.VERSEN_EMAIL_FROM || 'Versen <hej@versen.se>';
  const supportEmail = process.env.VERSEN_SUPPORT_EMAIL || 'hej@versen.se';

  if (!apiKey) {
    sendJson(res, 200, { status: 'Klart. Du är först i kön.' });
    return;
  }

  const safeEmail = escapeHtml(email);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [supportEmail],
      reply_to: email,
      subject: 'Ny person på Versen waitlist',
      html: `
        <div style="font-family:Arial,sans-serif;background:#090a0d;color:#fff;padding:28px">
          <p style="letter-spacing:2px;text-transform:uppercase;color:#82f7d2;font-size:12px;margin:0 0 18px">Versen waitlist</p>
          <h1 style="margin:0 0 12px">Ny email</h1>
          <p><strong>Email:</strong> ${safeEmail}</p>
        </div>
      `,
      text: `Ny Versen waitlist-email: ${email}`,
    }),
  });

  if (!response.ok) {
    sendJson(res, 200, { status: 'Klart. Du är först i kön.' });
    return;
  }

  sendJson(res, 200, { status: 'Klart. Du är först i kön.' });
}

async function sendProductSuggestionEmail(req, res, body) {
  const suggestionThanks = 'Tack för ditt förslag, vi kikar på det!';
  const session = await getCustomerSession(getCookie(req, 'versen_customer_token'));
  const product = clean(body.product, 180);
  const category = clean(body.category, 80) || 'Övrigt';
  const link = clean(body.link, 400);
  const message = clean(body.message, 1800);
  const email = session.authenticated && session.customer ? session.customer.email : clean(body.email, 180).toLowerCase();
  const name = session.authenticated && session.customer
    ? (session.customer.displayName || session.customer.firstName || session.customer.email)
    : clean(body.name, 120);

  if (!product || !isEmail(email)) {
    sendJson(res, 400, { error: 'Skriv produktnamn och giltig email.' });
    return;
  }

  const suggestion = {
    id: crypto.randomBytes(8).toString('hex'),
    product,
    category,
    link,
    message,
    email,
    name: name || email,
    member: Boolean(session.authenticated && session.customer && session.customer.member),
    submittedAt: new Date().toISOString(),
  };

  const saved = session.authenticated && session.customer
    ? await saveProductSuggestion(session.customer.id, suggestion)
    : { ok: false };

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.VERSEN_EMAIL_FROM || 'Versen <hej@versen.se>';
  const supportEmail = process.env.VERSEN_SUPPORT_EMAIL || 'hej@versen.se';

  if (!apiKey) {
    sendJson(res, 200, { status: suggestionThanks });
    return;
  }

  const safe = {
    product: escapeHtml(product),
    category: escapeHtml(category),
    link: escapeHtml(link),
    message: escapeHtml(message).replace(/\n/g, '<br>'),
    email: escapeHtml(email),
    name: escapeHtml(name || email),
    member: session.authenticated && session.customer && session.customer.member ? 'Ja' : 'Nej',
  };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [supportEmail],
      reply_to: email,
      subject: `Produktförslag: ${product}`,
      html: `
        <div style="font-family:Arial,sans-serif;background:#090a0d;color:#fff;padding:28px">
          <p style="letter-spacing:2px;text-transform:uppercase;color:#82f7d2;font-size:12px;margin:0 0 18px">Versen produktförslag</p>
          <h1 style="margin:0 0 12px">${safe.product}</h1>
          <p><strong>Kategori:</strong> ${safe.category}</p>
          <p><strong>Från:</strong> ${safe.name} (${safe.email})</p>
          <p><strong>Aktiv medlem:</strong> ${safe.member}</p>
          ${link ? `<p><strong>Länk:</strong> ${safe.link}</p>` : ''}
          ${message ? `<div style="margin-top:18px;padding:18px;border:1px solid rgba(255,255,255,.15);border-radius:14px;background:rgba(255,255,255,.05)">${safe.message}</div>` : ''}
        </div>
      `,
      text: `Produktförslag: ${product}\nKategori: ${category}\nFrån: ${name || email} (${email})\nAktiv medlem: ${safe.member}\n${link ? `Länk: ${link}\n` : ''}${message}`,
    }),
  });

  if (!response.ok) {
    sendJson(res, 200, { status: suggestionThanks });
    return;
  }

  sendJson(res, 200, { status: suggestionThanks });
}

async function saveCustomerPreferences(req, res, body) {
  const session = await getCustomerSession(getCookie(req, 'versen_customer_token'));

  if (!session.authenticated || !session.customer) {
    sendJson(res, 200, { status: 'Inställningen sparas på den här enheten.' });
    return;
  }

  const existingPreferences = session.customer.preferences && typeof session.customer.preferences === 'object'
    ? session.customer.preferences
    : {};
  const nextPreferences = { ...existingPreferences };

  if (body.theme !== undefined) {
    nextPreferences.theme = ['auto', 'light', 'dark'].includes(body.theme) ? body.theme : 'auto';
  }

  if (Array.isArray(body.favorites)) {
    nextPreferences.favorites = body.favorites
      .filter((item) => item && item.handle)
      .slice(0, 120)
      .map((item) => ({
        handle: clean(item.handle, 160),
        title: clean(item.title, 240),
        category: clean(item.category, 120),
        price: clean(item.price, 80),
        compareAtPrice: clean(item.compareAtPrice, 80),
        image: item.image && item.image.url
          ? {
            url: clean(item.image.url, 1000),
            altText: clean(item.image.altText, 240),
          }
          : null,
      }));
  }

  try {
    await updateProfilePreferences(session.customer.id, nextPreferences);
  } catch (error) {
    sendJson(res, 200, { status: 'Inställningen sparas på den här enheten.' });
    return;
  }

  sendJson(res, 200, { status: 'Inställningen är sparad på kontot.' });
}

async function cancelMembership(req, res) {
  const session = await getCustomerSession(getCookie(req, 'versen_customer_token'));

  if (!session.authenticated || !session.customer) {
    sendJson(res, 401, { error: 'Logga in först.' });
    return;
  }

  const membership = session.customer.membership || {};
  if (membership.subscriptionId) {
    try {
      const subscription = await cancelStripeMembership(membership.subscriptionId);
      const updatedSession = await getCustomerSession(getCookie(req, 'versen_customer_token'));

      sendJson(res, 200, {
        status: 'Prenumerationen är avslutad. Medlemskapet är aktivt till sista datumet.',
        activeUntil: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
        session: updatedSession,
      });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || 'Kunde inte avsluta prenumerationen just nu.' });
    }
    return;
  }
  sendJson(res, 404, { error: 'Ingen aktiv Stripe-prenumeration hittades.' });
}

async function createBillingPortal(req, res) {
  const session = await getCustomerSession(getCookie(req, 'versen_customer_token'));

  if (!session.authenticated || !session.customer) {
    sendJson(res, 401, { error: 'Logga in först.' });
    return;
  }

  const membership = session.customer.membership || {};
  if (!membership.subscriptionId) {
    sendJson(res, 404, { error: 'Ingen aktiv Stripe-prenumeration hittades.' });
    return;
  }

  try {
    const origin = new URL(getBaseUrl(req)).origin;
    const portal = await createStripeBillingPortalSession({
      subscriptionId: membership.subscriptionId,
      returnUrl: `${origin}/installningar`,
    });

    sendJson(res, 200, { url: portal.url });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || 'Kunde inte öppna Stripe betalningsportal.' });
  }
}

function parseSuggestionList(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

async function saveProductSuggestion(customerId, suggestion) {
  if (!customerId) {
    return { ok: false };
  }

  try {
    await appendProductSuggestion(customerId, suggestion);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

async function loginCustomer(res, email, password) {
  const normalizedEmail = normalizeEmail(email);
  try {
    const authSession = await signInWithPassword(normalizedEmail, String(password || ''));
    setAuthCookies(res, authSession);
    const session = await getCustomerSession(authSession.access_token);
    sendJson(res, 200, session);
  } catch (error) {
    const accountExists = await customerExists(normalizedEmail);
    sendJson(res, 401, {
      error: accountExists === false ? 'Kontot finns inte.' : 'Fel lösenord.',
      reason: accountExists === false ? 'account_not_found' : 'invalid_password',
    });
  }
}

async function customerExists(email) {
  const customer = await findCustomerByEmail(email);
  return customer ? true : customer;
}

async function findCustomerByEmail(email) {
  if (!email) {
    return false;
  }

  try {
    return await findSupabaseAccountByEmail(email) || false;
  } catch (error) {
    return null;
  }
}

async function updateCustomerPassword(customerId, password) {
  try {
    const body = await updateSupabasePassword(customerId, password);
    return { ok: true, status: 200, body };
  } catch (error) {
    return {
      ok: false, status: error.status || 500, body: { error: error.message || 'Kunde inte uppdatera lösenordet' },
    };
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const token = getCookie(req, 'versen_customer_token');
    let session = await getCustomerSession(token);

    if (!session.authenticated) {
      try {
        const refreshed = await refreshSupabaseSession(getCookie(req, 'versen_refresh_token'));
        setAuthCookies(res, refreshed);
        session = await getCustomerSession(refreshed.access_token);
      } catch (error) {
        session = { authenticated: false, customer: null };
      }
    }

    if (!session.authenticated) {
      clearAuthCookies(res);
    }

    sendJson(res, 200, session);
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  let body;

  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'Ogiltig JSON' });
    return;
  }

  if (body.action === 'logout') {
    clearAuthCookies(res);
    sendJson(res, 200, { authenticated: false });
    return;
  }

  if (body.action === 'contact') {
    await sendSupportEmail(req, res, body);
    return;
  }

  if (body.action === 'waitlist') {
    await sendWaitlistEmail(res, body);
    return;
  }

  if (body.action === 'device_visit') {
    logDeviceVisit(req, body);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (body.action === 'suggest_product') {
    await sendProductSuggestionEmail(req, res, body);
    return;
  }

  if (body.action === 'cancel_membership') {
    await cancelMembership(req, res);
    return;
  }

  if (body.action === 'create_billing_portal') {
    await createBillingPortal(req, res);
    return;
  }

  if (body.action === 'save_preferences') {
    await saveCustomerPreferences(req, res, body);
    return;
  }

  if (body.action === 'recover') {
    const email = normalizeEmail(body.email);

    if (!email) {
      sendJson(res, 400, { error: 'Ange email' });
      return;
    }

    const customer = await findCustomerByEmail(email);

    if (customer === false) {
      sendJson(res, 404, { error: 'Kontot finns inte.' });
      return;
    }

    if (customer === null) {
      sendJson(res, 500, { error: 'Kunde inte kontrollera kontot just nu.' });
      return;
    }

    const result = await sendPasswordResetEmail(req, {
      customerId: customer.id,
      email: customer.email,
    });

    sendJson(res, result.status, result.body);
    return;
  }

  if (body.action === 'reset_password') {
    const verified = verifyPayload(body.resetToken);
    const password = String(body.password || '');

    if (!verified || verified.type !== 'password_reset' || !verified.customerId || !verified.email) {
      sendJson(res, 401, { error: 'Återställningslänken är ogiltig eller har gått ut' });
      return;
    }

    if (password.length < 8) {
      sendJson(res, 400, { error: 'Välj minst 8 tecken som lösenord' });
      return;
    }

    const result = await updateCustomerPassword(verified.customerId, password);

    if (!result.ok) {
      sendJson(res, result.status, result.body);
      return;
    }

    await loginCustomer(res, verified.email, password);
    return;
  }

  if (body.action === 'start_verification') {
    const email = normalizeEmail(body.email);

    if (!email) {
      sendJson(res, 400, { error: 'Ange email' });
      return;
    }

    const existing = await customerExists(email);

    if (existing === true) {
      sendJson(res, 409, {
        error: 'Det finns redan ett konto med denna email adress. Logga in istället.',
        reason: 'account_exists',
      });
      return;
    }

    if (existing === null) {
      sendJson(res, 500, { error: 'Kunde inte kontrollera kontot just nu.' });
      return;
    }

    const payload = {
      email,
      firstName: String(body.firstName || '').trim(),
      lastName: String(body.lastName || '').trim(),
      next: String(body.next || ''),
      exp: Date.now() + (1000 * 60 * 30),
      nonce: crypto.randomBytes(12).toString('hex'),
    };

    const result = await sendVerificationEmail(req, payload);
    sendJson(res, result.status, result.body);
    return;
  }

  if (body.action === 'create_verified') {
    const verified = verifyPayload(body.verificationToken);
    const password = String(body.password || '');

    if (!verified) {
      sendJson(res, 401, { error: 'Verifieringslänken är ogiltig eller har gått ut' });
      return;
    }

    if (password.length < 8) {
      sendJson(res, 400, { error: 'Välj minst 8 tecken som lösenord' });
      return;
    }

    try {
      const user = await createSupabaseUser({
        email: verified.email,
        password,
        firstName: verified.firstName,
        lastName: verified.lastName,
      });
      await sendWelcomeEmail({
        id: user.id,
        email: verified.email,
      }).catch(() => {});
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || 'Kunde inte skapa konto.' });
      return;
    }

    await loginCustomer(res, verified.email, password);
    return;
  }

  if (body.action === 'login') {
    await loginCustomer(res, body.email, body.password);
    return;
  }

  sendJson(res, 400, { error: 'Okänd kontoåtgärd' });
};
