const { requireAdmin } = require('./admin-auth');
const { readBody, sendJson } = require('./shopify');
const { sendOrderStatusEmail, sendResendEmail } = require('./email');
const {
  clearAbandonedCheckout,
  getOrder,
  isSupabaseConfigured,
  logAdminActivity,
  markAbandonedCheckoutContacted,
  updateOrderStatus,
  updateSupportTicket,
} = require('./supabase');

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
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

  const result = await sendResendEmail({
    to: email,
    type: 'abandoned_checkout_reminder',
    subject: 'Din Versen-kundkorg väntar',
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#080808;color:#fff;padding:32px">
        <p style="letter-spacing:2px;text-transform:uppercase;font-size:12px;margin:0 0 18px;color:#a8fff0">Versen</p>
        <h1 style="margin:0 0 12px">Din kundkorg är sparad</h1>
        <p style="line-height:1.55;color:#d9d9d9">Du lämnade produkter i checkout. Slutför köpet medan priset fortfarande gäller.</p>
        <a href="${process.env.VERSEN_SITE_URL || 'https://versen.se'}/kundvagn" style="display:inline-block;margin-top:18px;background:#fff;color:#080808;padding:13px 18px;border-radius:10px;text-decoration:none;font-weight:800">Fortsätt till checkout</a>
      </div>
    `,
    text: `Din Versen-kundkorg är sparad. Fortsätt här: ${(process.env.VERSEN_SITE_URL || 'https://versen.se')}/kundvagn`,
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

  const result = await sendResendEmail({
    to: email,
    type: 'support_reply',
    subject: clean(body.subject, 180) || 'Svar från Versen support',
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#f7f5ef;color:#111;padding:32px">
        <p style="letter-spacing:2px;text-transform:uppercase;font-size:12px;margin:0 0 18px">Versen support</p>
        <p style="line-height:1.55;white-space:pre-line">${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
      </div>
    `,
    text: message,
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
  const orderStatus = clean(body.orderStatus, 80);

  if (!orderId || !orderStatus) {
    return { status: 400, body: { error: 'Order och status krävs' } };
  }

  const updated = isSupabaseConfigured()
    ? await updateOrderStatus(orderId, {
      order_status: orderStatus,
      tracking_url: clean(body.trackingUrl, 500),
      tracking_number: clean(body.trackingNumber, 120),
    })
    : null;

  await safeLog({
    action: 'order_status_changed',
    target_type: 'order',
    target_id: orderId,
    message: `Orderstatus ändrad till ${orderStatus}`,
    metadata: { trackingNumber: clean(body.trackingNumber, 120) },
  });

  if (body.sendEmail && isSupabaseConfigured()) {
    const order = await getOrder(orderId).catch(() => null);
    if (order && order.email) {
      await sendOrderStatusEmail(order, {
        type: `order_${orderStatus.replace(/\s+/g, '_')}`,
        message: clean(body.emailMessage, 800) || `Din order har uppdaterats till: ${orderStatus}.`,
        trackingUrl: clean(body.trackingUrl, 500),
      }).catch(() => null);
    }
  }

  return {
    status: updated || !isSupabaseConfigured() ? 200 : 404,
    body: {
      status: updated ? 'Orderstatus uppdaterad.' : 'Action loggad. Ordern finns inte i Supabase-tabellen.',
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
