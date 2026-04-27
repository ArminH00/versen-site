const crypto = require('crypto');
const {
  clearCustomerCookie,
  getCookie,
  readBody,
  sendJson,
  setCustomerCookie,
  shopifyFetch,
} = require('./shopify');
const { getCustomerSession } = require('./membership');

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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
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

async function loginCustomer(res, email, password) {
  const result = await shopifyFetch(CUSTOMER_LOGIN_MUTATION, {
    input: {
      email: normalizeEmail(email),
      password: String(password || ''),
    },
  });

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const payload = result.body.data.customerAccessTokenCreate;

  if (payload.customerUserErrors.length || !payload.customerAccessToken) {
    sendJson(res, 401, {
      error: payload.customerUserErrors[0] ? payload.customerUserErrors[0].message : 'Kunde inte logga in',
    });
    return;
  }

  setCustomerCookie(res, payload.customerAccessToken.accessToken, payload.customerAccessToken.expiresAt);
  const session = await getCustomerSession(payload.customerAccessToken.accessToken);
  sendJson(res, 200, session);
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

  if (body.action === 'recover') {
    const email = normalizeEmail(body.email);

    if (!email) {
      sendJson(res, 400, { error: 'Ange email' });
      return;
    }

    const result = await shopifyFetch(CUSTOMER_RECOVER_MUTATION, { email });

    if (!result.ok) {
      sendJson(res, result.status, result.body);
      return;
    }

    const errors = result.body.data.customerRecover.customerUserErrors;

    if (errors.length) {
      sendJson(res, 400, { error: errors[0].message });
      return;
    }

    sendJson(res, 200, { status: 'Om kontot finns skickas ett mail för att återställa lösenordet.' });
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
