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

  if (body.action === 'create') {
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');

    if (!email || password.length < 6) {
      sendJson(res, 400, { error: 'Ange email och minst 6 tecken som lösenord' });
      return;
    }

    const result = await shopifyFetch(CUSTOMER_CREATE_MUTATION, {
      input: {
        email,
        password,
        firstName: String(body.firstName || '').trim() || undefined,
        lastName: String(body.lastName || '').trim() || undefined,
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

    await loginCustomer(res, email, password);
    return;
  }

  if (body.action === 'login') {
    await loginCustomer(res, body.email, body.password);
    return;
  }

  sendJson(res, 400, { error: 'Okänd kontoåtgärd' });
};
