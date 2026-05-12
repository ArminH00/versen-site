const { getCookie, sendJson } = require('../lib/shopify');
const { getSupabaseUser, ensureProfileForUser } = require('../lib/supabase-auth');
const { getMembershipForCustomer } = require('../lib/membership-service');
const { listOrdersForCustomer } = require('../lib/order-store');

const ACTIVE_STATUSES = ['active', 'trialing'];

function emailList(value, fallback = '') {
  return String(value || fallback)
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function formatSekOre(value) {
  return `${Math.round((Number(value) || 0) / 100)} kr`;
}

function normalizeOrder(order) {
  return {
    id: order.id,
    name: order.order_number || order.id,
    processedAt: order.created_at,
    createdAt: order.created_at,
    statusUrl: '',
    total: order.summary && order.summary.total ? order.summary.total : formatSekOre(order.total),
    items: (order.items || []).map((item) => `${item.quantity} x ${item.title}`),
  };
}

function normalizeCustomer(user, profile, membership, orders) {
  const meta = user.user_metadata || {};
  const email = String(user.email || profile.email || '').toLowerCase();
  const forcedMembers = emailList(process.env.VERSEN_TEST_MEMBER_EMAILS);
  const forcedNonMembers = emailList(process.env.VERSEN_TEST_NON_MEMBER_EMAILS);
  const forcedMember = forcedMembers.includes(email);
  const forcedNonMember = forcedNonMembers.includes(email);
  const stripeActive = Boolean(membership && membership.active);
  const profileActive = ACTIVE_STATUSES.includes(String(profile.membership_status || '').toLowerCase());
  const member = !forcedNonMember && (stripeActive || profileActive || forcedMember);
  const orderSpend = (orders || []).reduce((sum, order) => sum + ((Number(order.total) || 0) / 100), 0);
  const firstName = profile.first_name || meta.first_name || meta.firstName || '';
  const lastName = profile.last_name || meta.last_name || meta.lastName || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || email;

  return {
    id: user.id,
    displayName,
    firstName,
    lastName,
    email,
    tags: [],
    member,
    membershipSource: member ? (forcedMember ? 'Test' : 'Stripe') : null,
    membershipStatus: member ? 'Aktiv medlem' : 'Inget aktivt medlemskap',
    membership: {
      source: member ? (forcedMember ? 'Test' : 'Stripe') : null,
      subscriptionId: membership && membership.subscriptionId ? membership.subscriptionId : profile.membership_subscription_id || null,
      nextChargeScheduledAt: membership && membership.currentPeriodEnd ? membership.currentPeriodEnd : null,
      activeUntil: membership && membership.currentPeriodEnd ? membership.currentPeriodEnd : null,
      cancellationRequested: Boolean(membership && membership.cancelAtPeriodEnd),
      cancelledAt: null,
    },
    preferences: profile.preferences || {},
    numberOfOrders: orders ? orders.length : 0,
    points: Math.floor(orderSpend * 2),
    pointsBaseAmount: Math.round(orderSpend),
    orders: (orders || []).map(normalizeOrder),
  };
}

async function getCustomerSession(accessToken) {
  const user = await getSupabaseUser(accessToken);

  if (!user) {
    return { authenticated: false, customer: null };
  }

  const profile = await ensureProfileForUser(user);
  const [membership, orders] = await Promise.all([
    getMembershipForCustomer({ id: user.id }),
    listOrdersForCustomer(user.id, user.email),
  ]);

  return {
    authenticated: true,
    customer: normalizeCustomer(user, profile, membership, orders),
  };
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const session = await getCustomerSession(getCookie(req, 'versen_customer_token'));
  sendJson(res, 200, session);
}

handler.getCustomerSession = getCustomerSession;
handler.membershipTags = () => [];

module.exports = handler;
