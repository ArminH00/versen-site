function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || '';
}

function stripePublishableKey() {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY || '';
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

module.exports = {
  stripePublishableKey,
  stripeRequest,
  stripeSecretKey,
};
