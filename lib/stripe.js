function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || '';
}

function stripePublishableKey() {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY || '';
}

const ensuredPaymentMethodDomains = new Set();

function normalizePaymentMethodDomain(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch (error) {
    return raw.split('/')[0].split(':')[0].toLowerCase();
  }
}

async function stripeRequest(pathname, options = {}) {
  const secret = stripeSecretKey();

  if (!secret) {
    const error = new Error('Stripe saknar serverkonfiguration');
    error.status = 503;
    throw error;
  }

  const response = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(options.headers || {}),
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error && data.error.message ? data.error.message : 'Stripe svarade med ett fel');
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function ensureStripePaymentMethodDomain(domain) {
  const normalized = normalizePaymentMethodDomain(domain);
  if (!normalized || ensuredPaymentMethodDomains.has(normalized)) {
    return null;
  }

  const list = await stripeRequest(`payment_method_domains?domain_name=${encodeURIComponent(normalized)}&limit=10`);
  const existing = (list.data || []).find((item) => item && item.domain_name === normalized);

  if (existing) {
    if (!existing.enabled) {
      const body = new URLSearchParams();
      body.set('enabled', 'true');
      await stripeRequest(`payment_method_domains/${encodeURIComponent(existing.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    }
    ensuredPaymentMethodDomains.add(normalized);
    return existing;
  }

  const body = new URLSearchParams();
  body.set('domain_name', normalized);
  body.set('enabled', 'true');
  const created = await stripeRequest('payment_method_domains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  ensuredPaymentMethodDomains.add(normalized);
  return created;
}

async function ensureStripePaymentMethodDomains(domains = []) {
  const configured = String(process.env.STRIPE_PAYMENT_METHOD_DOMAINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const siteUrl = process.env.VERSEN_SITE_URL || '';
  const candidates = [...configured, siteUrl, ...domains]
    .map(normalizePaymentMethodDomain)
    .filter(Boolean)
    .filter((domain, index, list) => list.indexOf(domain) === index)
    .filter((domain) => !domain.endsWith('.vercel.app') && domain !== 'localhost' && domain !== '127.0.0.1');

  const results = [];
  for (const domain of candidates) {
    try {
      results.push(await ensureStripePaymentMethodDomain(domain));
    } catch (error) {
      if (!/already|exist|registered/i.test(String(error && error.message))) {
        throw error;
      }
      ensuredPaymentMethodDomains.add(domain);
    }
  }
  return results;
}

module.exports = {
  ensureStripePaymentMethodDomains,
  stripePublishableKey,
  stripeRequest,
  stripeSecretKey,
};
