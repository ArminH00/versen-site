const { requireAdmin } = require('./admin-auth');
const { readBody, sendJson } = require('./shopify');
const {
  sendAbandonedCheckoutEmail,
  sendOrderStatusEmail,
  sendSupportReplyEmail,
} = require('./email');
const {
  clearAbandonedCheckout,
  getOrder,
  getOrderByShopifyOrderId,
  isSupabaseConfigured,
  logAdminActivity,
  markAbandonedCheckoutContacted,
  updateOrderItems,
  updateOrderStatus,
  updateOrderStatusByShopifyId,
  updateSupportTicket,
} = require('./supabase');

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function cleanOrderStatus(value) {
  const normalized = clean(value, 80).toLowerCase();
  const allowed = ['mottagen', 'plockas', 'plockad', 'skickad', 'levererad', 'makulerad', 'återbetald', 'retur'];
  return allowed.includes(normalized) ? normalized : normalized;
}

function normalizeOre(value) {
  const raw = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100);
}

function normalizeOrderItem(item = {}) {
  const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
  const unitPrice = item.unit_price !== undefined ? Number(item.unit_price) || 0 : normalizeOre(item.unitPriceSek || item.unitPrice || item.price);
  const totalPrice = item.total_price !== undefined ? Number(item.total_price) || 0 : normalizeOre(item.totalSek || item.total || item.lineTotal);
  const resolvedTotal = totalPrice || unitPrice * quantity;

  return {
    title: clean(item.title || item.name || 'Produkt', 180),
    sku: clean(item.sku, 120),
    quantity,
    unit_price: unitPrice,
    total_price: resolvedTotal,
  };
}

function isLockedOrder(order = {}) {
  const text = `${order.order_status || ''} ${order.orderStatus || ''} ${order.fulfillmentStatus || ''} ${order.payment_status || ''} ${order.paymentStatus || ''}`.toLowerCase();
  return /(makulerad|cancelled|canceled|avbruten)/.test(text);
}

async function findAdminOrder(orderId, shopifyOrderId) {
  if (!isSupabaseConfigured()) return null;
  return await getOrder(orderId).catch(() => null)
    || (shopifyOrderId ? await getOrderByShopifyOrderId(shopifyOrderId).catch(() => null) : null);
}

async function safeLog(activity) {
  if (!isSupabaseConfigured()) return;

  try {
    await logAdminActivity(activity);
  } catch (error) {
    // Activity logging must not block the admin action.
  }
}

async function handleCheckoutReminder(body) {
  const email = clean(body.email, 180).toLowerCase();

  if (!isEmail(email)) {
    return { status: 400, body: { error: 'Giltig email krävs' } };
  }

  const result = await sendAbandonedCheckoutEmail({
    email,
    checkout: {
      id: clean(body.checkoutId, 160),
      items: Array.isArray(body.items) ? body.items : [],
    },
  });

  await safeLog({
    action: 'email_sent',
    target_type: 'checkout',
    target_id: clean(body.checkoutId, 160),
    message: `Påminnelse skickad till ${email}`,
    metadata: { ok: result.ok, status: result.status || null, skipped: Boolean(result.skipped) },
  });

  return {
    status: result.ok ? 200 : 502,
    body: {
      ok: result.ok,
      status: result.ok ? 'Påminnelsen är skickad.' : 'Kunde inte skicka påminnelsen.',
      emailStatus: result,
    },
  };
}

async function handleSupportReply(body) {
  const email = clean(body.email, 180).toLowerCase();
  const message = clean(body.message, 5000);

  if (!isEmail(email) || !message) {
    return { status: 400, body: { error: 'Email och svar krävs' } };
  }

  const result = await sendSupportReplyEmail({
    to: email,
    subject: clean(body.subject, 180) || 'Svar från Versen support',
    message,
  });

  await safeLog({
    action: 'support_reply_sent',
    target_type: 'support_ticket',
    target_id: clean(body.ticketId, 160),
    message: `Supportmail skickat till ${email}`,
    metadata: { ok: result.ok, status: result.status || null },
  });

  return {
    status: result.ok ? 200 : 502,
    body: {
      ok: result.ok,
      status: result.ok ? 'Svaret är skickat.' : 'Kunde inte skicka supportsvaret.',
      emailStatus: result,
    },
  };
}

async function handleOrderStatus(body) {
  const orderId = clean(body.orderId, 180);
  const shopifyOrderId = clean(body.shopifyOrderId, 180);
  const orderStatus = cleanOrderStatus(body.orderStatus);

  if (!orderId || !orderStatus) {
    return { status: 400, body: { error: 'Order och status krävs' } };
  }

  const paymentStatus = orderStatus === 'återbetald'
    ? 'refunded'
    : orderStatus === 'makulerad'
      ? 'cancelled'
      : null;
  const sendEmail = Boolean(body.sendEmail) && orderStatus !== 'plockad';
  const existingOrder = await findAdminOrder(orderId, shopifyOrderId);

  if (isLockedOrder(existingOrder)) {
    return {
      status: 409,
      body: { error: 'Ordern är makulerad och låst. Den kan inte ändras igen.' },
    };
  }

  let updated = null;
  if (isSupabaseConfigured()) {
    updated = await updateOrderStatus(orderId, {
      order_status: orderStatus,
      payment_status: paymentStatus || undefined,
      tracking_url: clean(body.trackingUrl, 500),
      tracking_number: clean(body.trackingNumber, 120),
    })
      || (shopifyOrderId
        ? await updateOrderStatusByShopifyId(shopifyOrderId, {
          order_status: orderStatus,
          payment_status: paymentStatus || undefined,
          tracking_url: clean(body.trackingUrl, 500),
          tracking_number: clean(body.trackingNumber, 120),
        })
        : null);
  }

  await safeLog({
    action: 'order_status_changed',
    target_type: 'order',
    target_id: orderId,
    message: sendEmail
      ? `Orderstatus ändrad till ${orderStatus} och kundmail skickades`
      : `Orderstatus ändrad till ${orderStatus} utan kundmail`,
    metadata: {
      trackingNumber: clean(body.trackingNumber, 120),
      trackingUrl: clean(body.trackingUrl, 500),
      customerNotified: sendEmail,
      changes: {
        order_status: orderStatus,
        payment_status: paymentStatus || undefined,
        tracking_number: clean(body.trackingNumber, 120),
        tracking_url: clean(body.trackingUrl, 500),
      },
    },
  });

  if (sendEmail && isSupabaseConfigured()) {
    const order = updated
      || await getOrder(orderId).catch(() => null)
      || (shopifyOrderId ? await getOrderByShopifyOrderId(shopifyOrderId).catch(() => null) : null);
    if (order && order.email) {
      await sendOrderStatusEmail(order, {
        type: `order_${orderStatus.replace(/\s+/g, '_')}`,
        status: orderStatus,
        message: clean(body.emailMessage, 800) || `Din order har uppdaterats till: ${orderStatus}.`,
        trackingUrl: clean(body.trackingUrl, 500),
        trackingNumber: clean(body.trackingNumber, 120),
      }).catch(() => null);
    }
  }

  return {
    status: updated || !isSupabaseConfigured() ? 200 : 404,
    body: {
      status: updated
        ? (sendEmail ? 'Orderstatus uppdaterad och kunden har mailats.' : 'Orderstatus sparad utan kundmail.')
        : 'Action loggad. Ordern finns inte i Supabase-tabellen.',
      order: updated,
    },
  };
}

async function handleOrderItems(body) {
  const orderId = clean(body.orderId, 180);
  const shopifyOrderId = clean(body.shopifyOrderId, 180);
  const items = Array.isArray(body.items) ? body.items.map(normalizeOrderItem).filter((item) => item.title) : [];
  const total = body.totalSek !== undefined ? normalizeOre(body.totalSek) : items.reduce((sum, item) => sum + item.total_price, 0);

  if (!orderId) {
    return { status: 400, body: { error: 'Order krävs' } };
  }

  if (!items.length) {
    return { status: 400, body: { error: 'Minst en produkt krävs' } };
  }

  const existingOrder = await findAdminOrder(orderId, shopifyOrderId);
  if (isLockedOrder(existingOrder)) {
    return {
      status: 409,
      body: { error: 'Ordern är makulerad och låst. Orderinnehållet kan inte ändras.' },
    };
  }

  const updated = isSupabaseConfigured()
    ? await updateOrderItems(orderId, {
      items,
      subtotal: total,
      total,
    })
    : null;

  await safeLog({
    action: 'order_items_changed',
    target_type: 'order',
    target_id: orderId,
    message: 'Orderinnehåll ändrat utan kundmail',
    metadata: {
      customerNotified: false,
      changes: {
        items: items.map((item) => `${item.quantity} x ${item.title}`),
        total: `${Math.round(total / 100)} kr`,
      },
    },
  });

  return {
    status: updated || !isSupabaseConfigured() ? 200 : 404,
    body: {
      status: updated ? 'Orderinnehåll sparat utan kundmail.' : 'Action loggad. Ordern finns inte i Supabase-tabellen.',
      order: updated,
    },
  };
}

async function handleSupportStatus(body) {
  const ticketId = clean(body.ticketId, 160);
  const status = clean(body.status, 80);

  if (!ticketId || !status) {
    return { status: 400, body: { error: 'Ärende och status krävs' } };
  }

  const ticket = isSupabaseConfigured()
    ? await updateSupportTicket(ticketId, { status, category: clean(body.category, 80) || undefined })
    : null;

  await safeLog({
    action: 'support_status_changed',
    target_type: 'support_ticket',
    target_id: ticketId,
    message: `Supportstatus ändrad till ${status}`,
  });

  return {
    status: ticket || !isSupabaseConfigured() ? 200 : 404,
    body: {
      status: ticket ? 'Supportärendet är uppdaterat.' : 'Action loggad. Supporttabellen saknas eller ärendet hittades inte.',
      ticket,
    },
  };
}

async function handleCheckoutContacted(body) {
  const checkoutId = clean(body.checkoutId, 160);

  if (!checkoutId) {
    return { status: 400, body: { error: 'Checkout-id krävs' } };
  }

  const checkout = isSupabaseConfigured()
    ? await markAbandonedCheckoutContacted(checkoutId).catch(() => null)
    : null;

  await safeLog({
    action: 'checkout_marked_contacted',
    target_type: 'checkout',
    target_id: checkoutId,
    message: 'Checkout markerad som kontaktad',
  });

  return {
    status: 200,
    body: {
      status: checkout ? 'Checkout markerad som kontaktad.' : 'Action loggad. Lägg checkouten i abandoned_checkouts för kontaktstatus.',
      checkout,
    },
  };
}

async function handleCheckoutClear(body) {
  const checkoutId = clean(body.checkoutId, 160);

  if (!checkoutId) {
    return { status: 400, body: { error: 'Checkout-id krävs' } };
  }

  const checkout = isSupabaseConfigured()
    ? await clearAbandonedCheckout(checkoutId).catch(() => null)
    : null;

  await safeLog({
    action: 'checkout_cleared',
    target_type: 'checkout',
    target_id: checkoutId,
    message: 'Lämnad checkout rensad av admin',
  });

  return {
    status: 200,
    body: {
      status: checkout ? 'Checkout rensad.' : 'Action loggad. Checkouten kunde inte uppdateras i abandoned_checkouts.',
      checkout,
    },
  };
}

async function runAdminAction(body) {
  const action = body.action;
  return action === 'send_checkout_reminder'
    ? handleCheckoutReminder(body)
    : action === 'send_support_reply'
      ? handleSupportReply(body)
      : action === 'update_order_status'
        ? handleOrderStatus(body)
        : action === 'update_order_items'
          ? handleOrderItems(body)
          : action === 'update_support_status'
            ? handleSupportStatus(body)
            : action === 'mark_checkout_contacted'
              ? handleCheckoutContacted(body)
              : action === 'clear_abandoned_checkout'
                ? handleCheckoutClear(body)
                : { status: 400, body: { error: 'Okänd adminåtgärd' } };
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  try {
    requireAdmin(req);
  } catch (error) {
    sendJson(res, error.status || 401, { error: error.message });
    return;
  }

  let body;

  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'Ogiltig JSON' });
    return;
  }

  try {
    const result = await runAdminAction(body);
    sendJson(res, result.status, result.body);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || 'Adminåtgärden misslyckades' });
  }
}

handler.runAdminAction = runAdminAction;

module.exports = handler;
