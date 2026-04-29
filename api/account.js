const crypto = require('crypto');
const {
  adminFetch,
  clearCustomerCookie,
  getAdminAccessToken,
  getCookie,
  getShopDomain,
  readBody,
  sendJson,
  setCustomerCookie,
  shopifyFetch,
} = require('./shopify');
const { getCustomerSession, getRechargeMembershipByEmail } = require('./membership');

const CUSTOMER_CREATE_MUTATION = `
  mutation VersenCustomerCreate($input: CustomerCreateInput!) {
    customerCreate(input: $input) {
      customer {
        id
        email
      }
      customerUserErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_LOGIN_MUTATION = `
  mutation VersenCustomerLogin($input: CustomerAccessTokenCreateInput!) {
    customerAccessTokenCreate(input: $input) {
      customerAccessToken {
        accessToken
        expiresAt
      }
      customerUserErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_RECOVER_MUTATION = `
  mutation VersenCustomerRecover($email: String!) {
    customerRecover(email: $email) {
      customerUserErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_EXISTS_QUERY = `
  query VersenCustomerExists($query: String!) {
    customers(first: 1, query: $query) {
      nodes {
        id
        email
        firstName
      }
    }
  }
`;

const CUSTOMER_SUGGESTIONS_QUERY = `
  query VersenCustomerSuggestions($id: ID!) {
    customer(id: $id) {
      metafield(namespace: "versen", key: "product_suggestions") {
        value
      }
    }
  }
`;

const METAFIELDS_SET_MUTATION = `
  mutation VersenMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

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
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.VERSEN_EMAIL_FROM || 'Versen <onboarding@resend.dev>';
  const token = signPayload(payload);

  if (!token) {
    return {
      ok: false,
      status: 500,
      body: { error: 'Emailverifiering saknar hemlighet i Vercel' },
    };
  }

  const verificationUrl = `${getBaseUrl(req)}/konto.html?verify=${encodeURIComponent(token)}&next=${encodeURIComponent(payload.next || '')}`;

  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      body: {
        error: 'Emailutskick är inte konfigurerat ännu',
        missing: ['RESEND_API_KEY', 'VERSEN_EMAIL_FROM'],
      },
    };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [payload.email],
      subject: 'Verifiera ditt Versen-konto',
      html: `
        <div style="font-family:Inter,Arial,sans-serif;background:#0a0a0a;color:#fff;padding:32px">
          <h1 style="margin:0 0 12px">Verifiera ditt Versen-konto</h1>
          <p style="color:#c9c9c9;line-height:1.5">Klicka på knappen för att verifiera din email och skapa ditt lösenord.</p>
          <a href="${verificationUrl}" style="display:inline-block;margin-top:18px;background:#fff;color:#000;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:700">Verifiera email</a>
          <p style="color:#8d8d8d;margin-top:24px;font-size:13px">Länken gäller i 30 minuter.</p>
        </div>
      `,
      text: `Verifiera ditt Versen-konto: ${verificationUrl}`,
    }),
  });

  if (!response.ok) {
    let details = null;

    try {
      details = await response.json();
    } catch (error) {
      details = { message: 'Resend svarade inte med JSON' };
    }

    return {
      ok: false,
      status: response.status,
      body: {
        error: details.message || details.error || 'Kunde inte skicka verifieringsmail',
        provider: 'Resend',
        details,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body: { status: 'Verifieringsmail skickat. Kontrollera inkorgen.' },
  };
}

async function sendPasswordResetEmail(req, payload) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.VERSEN_EMAIL_FROM || 'Versen <hej@versen.se>';
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

  const resetUrl = `${getBaseUrl(req)}/konto.html?reset=${encodeURIComponent(token)}`;

  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      body: { error: 'Emailutskick är inte konfigurerat ännu' },
    };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [payload.email],
      subject: 'Återställ ditt Versen-lösenord',
      html: `
        <div style="font-family:Inter,Arial,sans-serif;background:#0a0a0a;color:#fff;padding:32px">
          <p style="letter-spacing:2px;text-transform:uppercase;color:#82f7d2;font-size:12px;margin:0 0 18px">Versen</p>
          <h1 style="margin:0 0 12px">Återställ lösenord</h1>
          <p style="color:#c9c9c9;line-height:1.5">Klicka på knappen för att välja ett nytt lösenord för ditt Versen-konto.</p>
          <a href="${resetUrl}" style="display:inline-block;margin-top:18px;background:#fff;color:#000;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:700">Välj nytt lösenord</a>
          <p style="color:#8d8d8d;margin-top:24px;font-size:13px">Länken gäller i 30 minuter. Om du inte bad om detta kan du ignorera mailet.</p>
        </div>
      `,
      text: `Återställ ditt Versen-lösenord: ${resetUrl}`,
    }),
  });

  if (!response.ok) {
    let details = null;

    try {
      details = await response.json();
    } catch (error) {
      details = { message: 'Resend svarade inte med JSON' };
    }

    return {
      ok: false,
      status: response.status,
      body: {
        error: details.message || details.error || 'Kunde inte skicka återställningsmail',
        provider: 'Resend',
        details,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body: { status: 'Återställningsmail skickat. Kontrollera inkorgen.' },
  };
}

async function sendSupportEmail(res, body) {
  const name = clean(body.name, 120);
  const email = clean(body.email, 180).toLowerCase();
  const topic = clean(body.topic, 80) || 'Support';
  const order = clean(body.order, 80);
  const message = clean(body.message, 3000);

  if (!name || !isEmail(email) || !message) {
    sendJson(res, 400, { error: 'Fyll i namn, giltig email och meddelande.' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.VERSEN_EMAIL_FROM || 'Versen <hej@versen.se>';
  const supportEmail = process.env.VERSEN_SUPPORT_EMAIL || 'hej@versen.se';

  if (!apiKey) {
    sendJson(res, 503, { error: 'Supportmail är inte konfigurerat ännu.' });
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
    });
    return;
  }

  sendJson(res, 200, { status: 'Meddelandet är skickat. Vi återkommer via email.' });
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
    sendJson(res, 200, { status: saved.ok ? 'Förslaget är sparat i admin.' : 'Förslaget är mottaget.' });
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
    sendJson(res, 200, { status: saved.ok ? 'Förslaget är sparat i admin.' : 'Förslaget är mottaget.' });
    return;
  }

  sendJson(res, 200, { status: saved.ok ? 'Förslaget är sparat i admin.' : 'Förslaget är skickat. Vi tar med det inför nästa drop.' });
}

function fallbackActiveUntil() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

async function cancelRechargeSubscription(subscriptionId) {
  const token = process.env.RECHARGE_API_TOKEN;

  if (!token) {
    return {
      ok: false,
      status: 503,
      body: { error: 'RECHARGE_API_TOKEN saknas' },
    };
  }

  if (!subscriptionId) {
    return {
      ok: false,
      status: 404,
      body: { error: 'Ingen aktiv ReCharge-prenumeration hittades.' },
    };
  }

  const response = await fetch(`https://api.rechargeapps.com/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Recharge-Access-Token': token,
      'X-Recharge-Version': process.env.RECHARGE_API_VERSION || '2021-11',
    },
    body: JSON.stringify({
      cancellation_reason: 'Kunden avslutade via Versen',
      cancellation_reason_comments: 'Avslutat från kundens kontoinställningar.',
      send_email: true,
    }),
  });

  let body = null;

  try {
    body = await response.json();
  } catch (error) {
    body = { error: 'Recharge svarade inte med JSON' };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body: {
        error: body.error || body.message || 'Kunde inte avsluta prenumerationen i ReCharge.',
        details: body,
      },
    };
  }

  return { ok: true, status: 200, body };
}

async function saveMembershipCancellation(customerId, cancellation) {
  if (!customerId) {
    return {
      ok: false,
      status: 401,
      body: { error: 'Kund saknas' },
    };
  }

  const result = await adminFetch(METAFIELDS_SET_MUTATION, {
    metafields: [{
      ownerId: customerId,
      namespace: 'versen',
      key: 'membership_cancellation',
      type: 'json',
      value: JSON.stringify(cancellation),
    }],
  });

  if (!result.ok) {
    return result;
  }

  const errors = result.body.data.metafieldsSet.userErrors || [];

  if (errors.length) {
    return {
      ok: false,
      status: 400,
      body: { error: errors.map((item) => item.message).join(', ') },
    };
  }

  return { ok: true, status: 200, body: { status: 'Uppsägningen är sparad.' } };
}

async function saveCustomerPreferences(req, res, body) {
  const session = await getCustomerSession(getCookie(req, 'versen_customer_token'));

  if (!session.authenticated || !session.customer) {
    sendJson(res, 200, { status: 'Inställningen sparas på den här enheten.' });
    return;
  }

  const theme = ['auto', 'light', 'dark'].includes(body.theme) ? body.theme : 'auto';
  const result = await adminFetch(METAFIELDS_SET_MUTATION, {
    metafields: [{
      ownerId: session.customer.id,
      namespace: 'versen',
      key: 'preferences',
      type: 'json',
      value: JSON.stringify({ theme }),
    }],
  });

  if (!result.ok) {
    sendJson(res, 200, { status: 'Inställningen sparas på den här enheten.' });
    return;
  }

  const errors = result.body.data.metafieldsSet.userErrors || [];

  if (errors.length) {
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

  const recharge = await getRechargeMembershipByEmail(session.customer.email);
  const subscription = recharge && recharge.subscription;

  if (!subscription || !subscription.id) {
    if (session.customer.membership && session.customer.membership.cancellationRequested) {
      sendJson(res, 200, {
        status: 'Prenumerationen är redan avslutad för kommande period.',
        session,
      });
      return;
    }

    const fallbackUntil = session.customer.membership && (session.customer.membership.activeUntil || session.customer.membership.nextChargeScheduledAt)
      ? session.customer.membership.activeUntil || session.customer.membership.nextChargeScheduledAt
      : fallbackActiveUntil();
    const fallbackCancellation = {
      status: 'cancelled',
      provider: session.customer.membershipSource || 'Versen',
      subscriptionId: null,
      activeUntil: fallbackUntil,
      cancelledAt: new Date().toISOString(),
    };
    const fallbackSaved = await saveMembershipCancellation(session.customer.id, fallbackCancellation);

    if (!fallbackSaved.ok) {
      sendJson(res, fallbackSaved.status || 500, fallbackSaved.body || { error: 'Kunde inte spara uppsägningen.' });
      return;
    }

    const updatedSession = await getCustomerSession(getCookie(req, 'versen_customer_token'));

    sendJson(res, 200, {
      status: 'Medlemskapet avslutas till nästa period. Access ligger kvar till sista datumet.',
      activeUntil: fallbackUntil,
      session: updatedSession,
    });
    return;
  }

  const activeUntil = subscription.next_charge_scheduled_at || fallbackActiveUntil();
  const cancelResult = await cancelRechargeSubscription(subscription.id);

  if (!cancelResult.ok) {
    sendJson(res, cancelResult.status, cancelResult.body);
    return;
  }

  const cancellation = {
    status: 'cancelled',
    provider: 'Recharge',
    subscriptionId: subscription.id,
    activeUntil,
    cancelledAt: new Date().toISOString(),
  };
  const saved = await saveMembershipCancellation(session.customer.id, cancellation);

  if (!saved.ok) {
    sendJson(res, saved.status || 500, saved.body || { error: 'Kunde inte spara uppsägningen på kontot.' });
    return;
  }

  const updatedSession = await getCustomerSession(getCookie(req, 'versen_customer_token'));

  sendJson(res, 200, {
    status: 'Prenumerationen är avslutad. Medlemskapet är aktivt till sista datumet.',
    activeUntil,
    session: updatedSession,
  });
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

  const current = await adminFetch(CUSTOMER_SUGGESTIONS_QUERY, { id: customerId });
  const existing = current.ok
    ? parseSuggestionList(current.body.data.customer && current.body.data.customer.metafield && current.body.data.customer.metafield.value)
    : [];
  const next = [suggestion, ...existing].slice(0, 50);
  const result = await adminFetch(METAFIELDS_SET_MUTATION, {
    metafields: [{
      ownerId: customerId,
      namespace: 'versen',
      key: 'product_suggestions',
      type: 'json',
      value: JSON.stringify(next),
    }],
  });

  if (!result.ok) {
    return { ok: false, error: result.body };
  }

  const errors = result.body.data.metafieldsSet.userErrors || [];
  return {
    ok: !errors.length,
    errors,
  };
}

async function loginCustomer(res, email, password) {
  const normalizedEmail = normalizeEmail(email);
  const result = await shopifyFetch(CUSTOMER_LOGIN_MUTATION, {
    input: {
      email: normalizedEmail,
      password: String(password || ''),
    },
  });

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const payload = result.body.data.customerAccessTokenCreate;

  if (payload.customerUserErrors.length || !payload.customerAccessToken) {
    const accountExists = await customerExists(normalizedEmail);

    sendJson(res, 401, {
      error: accountExists === false ? 'Kontot finns inte.' : 'Fel lösenord.',
      reason: accountExists === false ? 'account_not_found' : 'invalid_password',
    });
    return;
  }

  setCustomerCookie(res, payload.customerAccessToken.accessToken, payload.customerAccessToken.expiresAt);
  const session = await getCustomerSession(payload.customerAccessToken.accessToken);
  sendJson(res, 200, session);
}

async function customerExists(email) {
  const customer = await findCustomerByEmail(email);
  return customer ? true : customer;
}

async function findCustomerByEmail(email) {
  if (!email) {
    return false;
  }

  const result = await adminFetch(CUSTOMER_EXISTS_QUERY, { query: `email:${email}` });

  if (!result.ok) {
    return null;
  }

  const customers = result.body.data.customers.nodes || [];
  return customers.find((customer) => normalizeEmail(customer.email) === email) || false;
}

function numericCustomerId(id) {
  const match = String(id || '').match(/Customer\/(\d+)$/);
  return match ? match[1] : null;
}

async function updateCustomerPassword(customerId, password) {
  const domain = getShopDomain();
  const token = await getAdminAccessToken();
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2026-04';
  const numericId = numericCustomerId(customerId);

  if (!domain || !token || !numericId) {
    return {
      ok: false,
      status: 500,
      body: { error: 'Shopify Admin API saknar konfiguration för lösenordsbyte' },
    };
  }

  const response = await fetch(`https://${domain}/admin/api/${apiVersion}/customers/${numericId}.json`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      customer: {
        id: Number(numericId),
        password,
        password_confirmation: password,
      },
    }),
  });

  let body = null;

  try {
    body = await response.json();
  } catch (error) {
    body = { error: 'Shopify svarade inte med JSON' };
  }

  if (!response.ok || body.errors) {
    return {
      ok: false,
      status: response.status || 500,
      body: {
        error: 'Kunde inte uppdatera lösenordet i Shopify',
        details: body,
      },
    };
  }

  return { ok: true, status: 200, body };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const token = getCookie(req, 'versen_customer_token');
    const session = await getCustomerSession(token);

    if (!session.authenticated) {
      clearCustomerCookie(res);
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
    clearCustomerCookie(res);
    sendJson(res, 200, { authenticated: false });
    return;
  }

  if (body.action === 'contact') {
    await sendSupportEmail(res, body);
    return;
  }

  if (body.action === 'waitlist') {
    await sendWaitlistEmail(res, body);
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

    const result = await shopifyFetch(CUSTOMER_CREATE_MUTATION, {
      input: {
        email: verified.email,
        password,
        firstName: verified.firstName || undefined,
        lastName: verified.lastName || undefined,
        acceptsMarketing: Boolean(body.acceptsMarketing),
      },
    });

    if (!result.ok) {
      sendJson(res, result.status, result.body);
      return;
    }

    const payload = result.body.data.customerCreate;

    if (payload.customerUserErrors.length) {
      sendJson(res, 400, { error: payload.customerUserErrors[0].message });
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
