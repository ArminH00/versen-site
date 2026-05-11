const { sendJson } = require('./shopify');

function clean(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;

      if (body.length > 20000) {
        reject(new Error('Payload too large'));
      }
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function normalizeDevice(device = {}) {
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

function normalizeCustomer(customer = null) {
  if (!customer || typeof customer !== 'object') {
    return null;
  }

  return {
    id: clean(customer.id, 120),
    email: clean(customer.email, 180).toLowerCase(),
    member: Boolean(customer.member),
  };
}

module.exports = async function handler(req, res) {
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

  const event = {
    level: 'info',
    msg: 'device_visit',
    route: '/api/visit',
    at: new Date().toISOString(),
    vercelId: req.headers['x-vercel-id'] || '',
    device: normalizeDevice(body.device),
    customer: normalizeCustomer(body.customer),
  };

  console.log(JSON.stringify(event));
  sendJson(res, 200, { ok: true });
};
