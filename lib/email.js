const { isSupabaseConfigured, logEmail } = require('./supabase');

function resendFrom() {
  return process.env.RESEND_FROM_EMAIL
    || process.env.VERSEN_EMAIL_FROM
    || 'Versen <hej@versen.se>';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatSekOre(value) {
  return `${Math.round((Number(value) || 0) / 100)} kr`;
}

async function sendResendEmail({ to, subject, html, text, userId = null, orderId = null, type }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || !to) {
    return { ok: false, skipped: true };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFrom(),
      to: [to],
      subject,
      html,
      text,
    }),
  });

  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  if (isSupabaseConfigured()) {
    try {
      await logEmail({
        user_id: userId,
        order_id: orderId,
        type,
        resend_email_id: body && body.id ? body.id : null,
        status: response.ok ? 'sent' : 'failed',
      });
    } catch (error) {
      // Email delivery should not block checkout/order fulfillment.
    }
  }

  return { ok: response.ok, status: response.status, body };
}

async function sendOrderConfirmationEmail(order) {
  const items = (order.items || []).map((item) => `${item.quantity} x ${item.title}`).join('\n');
  const safeOrderNumber = escapeHtml(order.order_number || order.id);

  return sendResendEmail({
    to: order.email,
    userId: order.user_id,
    orderId: order.id,
    type: 'order_confirmation',
    subject: `Orderbekraftelse ${order.order_number || ''}`.trim(),
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#f7f5ef;color:#111;padding:32px">
        <p style="letter-spacing:2px;text-transform:uppercase;font-size:12px;margin:0 0 18px">Versen</p>
        <h1 style="margin:0 0 12px">Ordern ar mottagen</h1>
        <p style="line-height:1.5">Tack for din order. Vi har tagit emot betalningen och packar vidare sa snart ordern ar synkad.</p>
        <div style="margin-top:22px;padding:18px;border:1px solid #ddd7cc;border-radius:10px;background:#fffdfa">
          <strong>${safeOrderNumber}</strong>
          <p style="margin:10px 0 0">${escapeHtml(items)}</p>
          <p style="margin:14px 0 0"><strong>Totalt ${escapeHtml(formatSekOre(order.total))}</strong></p>
        </div>
      </div>
    `,
    text: `Ordern ar mottagen\n\n${order.order_number || order.id}\n${items}\nTotalt ${formatSekOre(order.total)}`,
  });
}

async function sendWelcomeEmail(profile) {
  return sendResendEmail({
    to: profile.email,
    userId: profile.id,
    type: 'account_created',
    subject: 'Välkommen till Versen',
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#f7f5ef;color:#111;padding:32px">
        <p style="letter-spacing:2px;text-transform:uppercase;font-size:12px;margin:0 0 18px">Versen</p>
        <h1 style="margin:0 0 12px">Kontot är klart</h1>
        <p style="line-height:1.5">Välkommen. Ditt Versen-konto är skapat och redo för medlemskap, checkout och orderhistorik.</p>
      </div>
    `,
    text: 'Kontot är klart\n\nVälkommen. Ditt Versen-konto är skapat och redo.',
  });
}

async function sendOrderStatusEmail(order, status) {
  const labels = {
    order_packing: 'Din order packas',
    order_shipped: 'Din order är skickad',
    order_delivered: 'Din order är klar',
  };
  const subject = labels[status.type] || 'Orderstatus uppdaterad';
  const tracking = status.trackingUrl ? `<p style="margin-top:14px"><a href="${escapeHtml(status.trackingUrl)}">Spåra leveransen</a></p>` : '';

  return sendResendEmail({
    to: order.email,
    userId: order.user_id,
    orderId: order.id,
    type: status.type,
    subject,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#f7f5ef;color:#111;padding:32px">
        <p style="letter-spacing:2px;text-transform:uppercase;font-size:12px;margin:0 0 18px">Versen</p>
        <h1 style="margin:0 0 12px">${escapeHtml(subject)}</h1>
        <p style="line-height:1.5">${escapeHtml(status.message || 'Vi har uppdaterat statusen för din order.')}</p>
        ${tracking}
      </div>
    `,
    text: `${subject}\n\n${status.message || 'Vi har uppdaterat statusen för din order.'}${status.trackingUrl ? `\n${status.trackingUrl}` : ''}`,
  });
}

async function sendMembershipEmail({ customer, subscription, type }) {
  const active = type === 'membership_activated';
  const failed = type === 'payment_failed';
  const canceled = type === 'membership_cancelled';
  const subject = active
    ? 'Ditt Versen-medlemskap ar aktivt'
    : (failed ? 'Betalningen for ditt medlemskap misslyckades' : 'Ditt medlemskap ar uppsagt');
  const heading = active
    ? 'Valkommen in'
    : (failed ? 'Uppdatera betalningen' : 'Medlemskapet avslutas');
  const copy = active
    ? 'Dina medlemspriser och checkout ar nu upplasta.'
    : (failed
      ? 'Stripe kunde inte debitera medlemskapet. Uppdatera ditt kort for att behalla access.'
      : 'Du behaller access till slutet av den betalda perioden.');

  return sendResendEmail({
    to: customer.email,
    userId: customer.userId || customer.id,
    type,
    subject,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#f7f5ef;color:#111;padding:32px">
        <p style="letter-spacing:2px;text-transform:uppercase;font-size:12px;margin:0 0 18px">Versen</p>
        <h1 style="margin:0 0 12px">${escapeHtml(heading)}</h1>
        <p style="line-height:1.5">${escapeHtml(copy)}</p>
      </div>
    `,
    text: `${heading}\n\n${copy}\n\nSubscription: ${subscription && subscription.id ? subscription.id : ''}`,
  });
}

module.exports = {
  sendMembershipEmail,
  sendOrderConfirmationEmail,
  sendOrderStatusEmail,
  sendWelcomeEmail,
  sendResendEmail,
};
