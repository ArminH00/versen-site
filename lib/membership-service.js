const {
  getLatestSubscriptionForUser,
  getProfileByEmail,
  getProfileById,
  getSubscriptionByStripeId,
  isSupabaseConfigured,
  updateProfileMembership,
  upsertProfile,
  upsertSubscription,
} = require('./supabase');
const { sendMembershipEmail } = require('./email');
const { stripeRequest } = require('./stripe');

const ACTIVE_STATUSES = ['active', 'trialing'];

function unixToIso(value) {
  return value ? new Date(Number(value) * 1000).toISOString() : null;
}

function membershipPriceId(plan) {
  const normalized = String(plan || '').toLowerCase();
  if (normalized === 'yearly' || normalized === 'annual') {
    return process.env.STRIPE_MEMBERSHIP_YEARLY_PRICE_ID || process.env.STRIPE_MEMBERSHIP_PRICE_ID;
  }
  return process.env.STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID || process.env.STRIPE_MEMBERSHIP_PRICE_ID;
}

function normalizeInviteCode(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function couponLabel(coupon) {
  if (!coupon) return 'rabatt';
  const duration = coupon.duration === 'repeating' && coupon.duration_in_months
    ? ` i ${coupon.duration_in_months} månader`
    : ' på första betalningen';
  if (coupon.percent_off) return `${coupon.percent_off}% rabatt${duration}`;
  if (coupon.amount_off) {
    const currency = String(coupon.currency || 'sek').toLowerCase();
    const suffix = currency === 'sek' ? 'kr' : currency.toUpperCase();
    return `${Math.round(Number(coupon.amount_off) / 100)} ${suffix} rabatt${duration}`;
  }
  return coupon.name || 'rabatt';
}

function validInviteCouponDuration(coupon) {
  return coupon && (
    coupon.duration === 'once'
    || (coupon.duration === 'repeating' && Number(coupon.duration_in_months) > 0)
  );
}

async function findInvitePromotionCode(code, stripeCustomerId) {
  const normalized = normalizeInviteCode(code);

  if (!normalized) {
    return null;
  }

  const result = await stripeRequest(`promotion_codes?code=${encodeURIComponent(normalized)}&active=true&limit=10`);
  const promotionCode = (result.data || []).find((item) => {
    const customerId = typeof item.customer === 'string' ? item.customer : item.customer && item.customer.id;
    return !customerId || customerId === stripeCustomerId;
  });

  if (!promotionCode || !promotionCode.id) {
    const error = new Error('Inbjudningskoden är inte aktiv.');
    error.status = 400;
    throw error;
  }

  if (!promotionCode.coupon || promotionCode.coupon.valid === false) {
    const error = new Error('Inbjudningskoden är inte giltig längre.');
    error.status = 400;
    throw error;
  }

  if (!validInviteCouponDuration(promotionCode.coupon)) {
    const error = new Error('Inbjudningskoden måste vara konfigurerad för första betalningen eller ett antal månader i Stripe.');
    error.status = 400;
    throw error;
  }

  return {
    id: promotionCode.id,
    code: promotionCode.code || normalized,
    label: couponLabel(promotionCode.coupon),
  };
}

function subscriptionRow(subscription, userId) {
  return {
    id: subscription.id,
    user_id: userId || (subscription.metadata && subscription.metadata.user_id) || '',
    stripe_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer && subscription.customer.id,
    stripe_subscription_id: subscription.id,
    status: subscription.status || 'incomplete',
    current_period_start: unixToIso(subscription.current_period_start),
    current_period_end: unixToIso(subscription.current_period_end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    created_at: unixToIso(subscription.created) || new Date().toISOString(),
  };
}

async function ensureProfileForCustomer(customer) {
  if (!isSupabaseConfigured()) {
    const error = new Error('Supabase maste vara konfigurerat for Stripe-medlemskap.');
    error.status = 503;
    throw error;
  }

  const existing = await getProfileById(customer.id);
  return upsertProfile({
    id: customer.id,
    email: customer.email,
    first_name: customer.firstName,
    last_name: customer.lastName,
    stripe_customer_id: existing && existing.stripe_customer_id,
    membership_status: existing && existing.membership_status ? existing.membership_status : 'inactive',
    membership_subscription_id: existing && existing.membership_subscription_id,
  });
}

async function createStripeCustomer(customer, existingProfile) {
  if (existingProfile && existingProfile.stripe_customer_id) {
    return existingProfile.stripe_customer_id;
  }

  const body = new URLSearchParams();
  body.set('email', customer.email);
  body.set('name', customer.displayName || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email);
  body.set('metadata[user_id]', customer.id);
  body.set('metadata[source]', 'versen_membership');

  const stripeCustomer = await stripeRequest('customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  await upsertProfile({
    ...existingProfile,
    id: customer.id,
    email: customer.email,
    first_name: customer.firstName,
    last_name: customer.lastName,
    stripe_customer_id: stripeCustomer.id,
  });

  return stripeCustomer.id;
}

async function createMembershipSubscription({ customer, plan, inviteCode }) {
  const normalizedPlan = String(plan || 'monthly').toLowerCase();
  const normalizedInviteCode = normalizeInviteCode(inviteCode);

  if (normalizedInviteCode && normalizedPlan !== 'monthly') {
    const error = new Error('Inbjudningskod gäller månadsmedlemskap och kan inte användas på årsplanen.');
    error.status = 400;
    throw error;
  }

  const priceId = membershipPriceId(plan);

  if (!priceId) {
    const error = new Error('Stripe-medlemskapspris saknas i Vercel.');
    error.status = 503;
    throw error;
  }

  const profile = await ensureProfileForCustomer(customer);
  const stripeCustomerId = await createStripeCustomer(customer, profile);
  const invitePromotionCode = await findInvitePromotionCode(normalizedInviteCode, stripeCustomerId);
  const body = new URLSearchParams();
  body.set('customer', stripeCustomerId);
  body.set('items[0][price]', priceId);
  body.set('payment_behavior', 'default_incomplete');
  body.set('payment_settings[save_default_payment_method]', 'on_subscription');
  body.set('metadata[user_id]', customer.id);
  body.set('metadata[email]', customer.email);
  body.set('metadata[source]', 'versen_membership');
  if (invitePromotionCode) {
    body.set('discounts[0][promotion_code]', invitePromotionCode.id);
    body.set('metadata[invite_code]', invitePromotionCode.code);
  }
  body.set('expand[0]', 'latest_invoice.payment_intent');

  const subscription = await stripeRequest('subscriptions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `versen-membership-${customer.id}-${priceId}-${Date.now()}`,
    },
    body,
  });

  await upsertSubscription(subscriptionRow(subscription, customer.id));
  await updateProfileMembership(customer.id, {
    membership_status: subscription.status || 'incomplete',
    membership_subscription_id: subscription.id,
    stripe_customer_id: stripeCustomerId,
  });

  const paymentIntent = subscription.latest_invoice && subscription.latest_invoice.payment_intent;
  return {
    subscription,
    clientSecret: paymentIntent && paymentIntent.client_secret,
    inviteDiscount: invitePromotionCode,
  };
}

async function syncStripeSubscription(subscription, options = {}) {
  if (!subscription || !subscription.id || !isSupabaseConfigured()) {
    return null;
  }

  let userId = subscription.metadata && subscription.metadata.user_id;
  const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer && subscription.customer.id;
  let profile = userId ? await getProfileById(userId) : null;

  if (!profile && subscription.metadata && subscription.metadata.email) {
    profile = await getProfileByEmail(subscription.metadata.email);
    userId = profile && profile.id;
  }

  if (!profile || !userId) {
    return null;
  }

  const row = await upsertSubscription(subscriptionRow(subscription, userId));
  await updateProfileMembership(userId, {
    membership_status: subscription.status || 'inactive',
    membership_subscription_id: subscription.id,
    stripe_customer_id: stripeCustomerId,
  });

  if (options.emailType) {
    await sendMembershipEmail({
      customer: { id: userId, userId, email: profile.email },
      subscription,
      type: options.emailType,
    }).catch(() => {});
  }

  return row;
}

async function syncStripeInvoice(invoice, emailType) {
  if (!invoice || !invoice.subscription) {
    return null;
  }

  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription.id;
  const subscription = typeof invoice.subscription === 'object'
    ? invoice.subscription
    : await stripeRequest(`subscriptions/${encodeURIComponent(subscriptionId)}`);
  return syncStripeSubscription(subscription, { emailType });
}

async function getMembershipForCustomer(customer) {
  if (!customer || !customer.id || !isSupabaseConfigured()) {
    return null;
  }

  const subscription = await getLatestSubscriptionForUser(customer.id);
  if (!subscription) {
    return null;
  }

  return {
    active: ACTIVE_STATUSES.includes(subscription.status),
    source: 'Stripe',
    subscriptionId: subscription.stripe_subscription_id,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  };
}

async function cancelStripeMembership(subscriptionId) {
  const row = await getSubscriptionByStripeId(subscriptionId);

  if (!row || !row.stripe_subscription_id) {
    const error = new Error('Ingen Stripe-prenumeration hittades.');
    error.status = 404;
    throw error;
  }

  const body = new URLSearchParams();
  body.set('cancel_at_period_end', 'true');
  body.set('expand[0]', 'latest_invoice.payment_intent');

  const subscription = await stripeRequest(`subscriptions/${encodeURIComponent(row.stripe_subscription_id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  await syncStripeSubscription(subscription, { emailType: 'membership_cancelled' });
  return subscription;
}

module.exports = {
  ACTIVE_STATUSES,
  cancelStripeMembership,
  createMembershipSubscription,
  getMembershipForCustomer,
  syncStripeInvoice,
  syncStripeSubscription,
};
