const { isSupabaseConfigured, logEmail } = require('./supabase');

function resendFrom() {
  const configured = String(process.env.RESEND_FROM_EMAIL || process.env.VERSEN_EMAIL_FROM || '').trim();
  const valid = /^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(configured)
    || /^.+ <[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(configured);

  return valid ? configured : 'Versen <hej@versen.se>';
}

function siteUrl(path = '') {
  const base = String(process.env.VERSEN_SITE_URL || 'https://versen.se').replace(/\/+$/, '');
  return `${base}${path}`;
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

function formatDate(value) {
  if (!value) return '';

  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));
  } catch (error) {
    return '';
  }
}

function orderNumber(order = {}) {
  return order.order_number || order.orderNumber || order.name || order.id || '';
}

function orderItems(order = {}) {
  return Array.isArray(order.items) ? order.items : [];
}

function orderTotal(order = {}) {
  if (order.total && String(order.total).includes('kr')) return order.total;
  return formatSekOre(order.total);
}

function orderDate(order = {}) {
  return formatDate(order.created_at || order.createdAt || new Date().toISOString());
}

function plainLines(lines) {
  return lines.filter(Boolean).join('\n');
}

function renderButton(label, href, tone = 'dark') {
  if (!label || !href) return '';
  const dark = tone === 'dark';
  return `
    <a href="${escapeHtml(href)}" style="display:inline-block;margin-top:20px;background:${dark ? '#111111' : '#ffcc02'};color:${dark ? '#ffffff' : '#111111'};padding:14px 22px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:800">
      ${escapeHtml(label)}
    </a>
  `;
}

function renderDetails(details = []) {
  const rows = details.filter((item) => item && (item.value || item.label));
  if (!rows.length) return '';

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px;border:1px solid #e9e1d3;border-radius:10px;background:#fffdf8">
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td style="padding:14px 16px;border-bottom:1px solid #eee6d8;color:#706b60;font-size:12px">${escapeHtml(item.label)}</td>
            <td align="right" style="padding:14px 16px;border-bottom:1px solid #eee6d8;color:#111111;font-size:13px;font-weight:800">${escapeHtml(item.value)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderItems(items = []) {
  const rows = items.filter(Boolean);
  if (!rows.length) return '';

  return `
    <div style="margin-top:22px">
      <p style="margin:0 0 10px;color:#111111;font-size:13px;font-weight:800">Produkter</p>
      ${rows.map((item) => `
        <div style="display:block;padding:12px 0;border-bottom:1px solid #eee6d8">
          <div style="color:#111111;font-size:13px;font-weight:800">${escapeHtml(item.title || item.name || 'Produkt')}</div>
          <div style="margin-top:3px;color:#706b60;font-size:12px">${escapeHtml(item.quantity || 1)} st${item.sku ? ` · SKU ${escapeHtml(item.sku)}` : ''}</div>
          ${item.total || item.total_price || item.unitPrice ? `<div style="margin-top:6px;color:#111111;font-size:12px;font-weight:800">${escapeHtml(item.total || item.unitPrice || formatSekOre(item.total_price))}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderBenefits(tone = 'default') {
  const pink = tone === 'pink';
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;border-radius:10px;background:${pink ? '#ffe3ea' : '#fff6df'}">
      <tr>
        <td style="padding:14px 12px;text-align:center;color:#111111;font-size:11px;font-weight:800">Alltid låga priser</td>
        <td style="padding:14px 12px;text-align:center;color:#111111;font-size:11px;font-weight:800">Medlemspriser</td>
        <td style="padding:14px 12px;text-align:center;color:#111111;font-size:11px;font-weight:800">Snabba leveranser</td>
      </tr>
    </table>
  `;
}

function emailFrame({
  title,
  intro,
  icon = '•',
  accent = '#ffcc02',
  ctaLabel,
  ctaHref,
  ctaTone = 'dark',
  details,
  items,
  notice,
  benefits = true,
  benefitTone = 'default',
  footerNote = 'Alltid billigt. För alla.',
}) {
  return `
    <!doctype html>
    <html lang="sv">
      <body style="margin:0;background:#f4efe6;padding:0;color:#111111;font-family:Inter,Arial,sans-serif">
        <div style="display:none;max-height:0;overflow:hidden;color:transparent">${escapeHtml(intro || title)}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4efe6;padding:28px 12px">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fffaf2;border:1px solid #e5dccd;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(38,31,22,.10)">
                <tr>
                  <td style="padding:34px 28px 0;text-align:center">
                    <div style="font-size:28px;font-weight:900;letter-spacing:-1.2px;color:#111111">versen<span style="color:${accent}">.</span>se</div>
                    <div style="display:inline-grid;place-items:center;width:70px;height:70px;margin:30px auto 18px;border-radius:999px;background:${accent}33;color:#111111;font-size:32px;line-height:70px">${escapeHtml(icon)}</div>
                    <h1 style="margin:0;color:#111111;font-size:34px;line-height:1.02;letter-spacing:-1.5px;font-weight:900">${escapeHtml(title)}</h1>
                    <p style="max-width:360px;margin:18px auto 0;color:#3f3a32;font-size:14px;line-height:1.55">${escapeHtml(intro)}</p>
                    ${renderButton(ctaLabel, ctaHref, ctaTone)}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 28px 28px">
                    ${renderDetails(details)}
                    ${items ? renderItems(items) : ''}
                    ${notice ? `<div style="margin-top:22px;border-radius:10px;background:${benefitTone === 'pink' ? '#ffe3ea' : '#fff6df'};padding:16px;color:#111111;font-size:14px;font-weight:800;text-align:center;line-height:1.35">${escapeHtml(notice)}</div>` : ''}
                    ${benefits ? renderBenefits(benefitTone) : ''}
                  </td>
                </tr>
                <tr>
                  <td style="background:#11151b;padding:22px 28px;text-align:center">
                    <div style="color:#ffcc02;font-size:18px;font-weight:900;letter-spacing:-.7px">versen.se</div>
                    <div style="margin-top:4px;color:#ffffff;font-size:12px">${escapeHtml(footerNote)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
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

async function sendVerificationRequestEmail({ to, verificationUrl, next }) {
  return sendResendEmail({
    to,
    type: 'email_verification',
    subject: 'Verifiera din e-post hos Versen',
    html: emailFrame({
      title: 'Verifiera din e-postadress',
      intro: 'Tack för att du skapade ett konto hos Versen. Klicka på knappen för att verifiera din e-postadress.',
      icon: '✉',
      ctaLabel: 'Verifiera e-postadress',
      ctaHref: verificationUrl,
      details: [{ label: 'Länken gäller', value: '30 minuter' }],
      notice: 'Hittar du inte mailet? Kolla skräpposten.',
      benefits: true,
    }),
    text: plainLines([
      'Verifiera din e-postadress hos Versen.',
      verificationUrl,
      next ? `Nästa steg: ${next}` : '',
      'Länken gäller i 30 minuter.',
    ]),
  });
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  return sendResendEmail({
    to,
    type: 'password_reset',
    subject: 'Återställ ditt Versen-lösenord',
    html: emailFrame({
      title: 'Återställ ditt lösenord',
      intro: 'Vi fick en begäran om att återställa ditt lösenord. Klicka på knappen för att välja ett nytt lösenord.',
      icon: '🔒',
      ctaLabel: 'Återställ lösenord',
      ctaHref: resetUrl,
      details: [{ label: 'Länken gäller', value: '30 minuter' }],
      notice: 'Om du inte bad om detta kan du ignorera mailet.',
      benefits: false,
    }),
    text: `Återställ ditt Versen-lösenord: ${resetUrl}`,
  });
}

async function sendOrderConfirmationEmail(order) {
  const number = orderNumber(order);
  const items = orderItems(order);

  return sendResendEmail({
    to: order.email,
    userId: order.user_id,
    orderId: order.id,
    type: 'order_confirmation',
    subject: `Tack för din order ${number}`.trim(),
    html: emailFrame({
      title: 'Tack för din order!',
      intro: 'Vi har mottagit din order och börjar behandla den. Du får ett nytt mail när ordern skickas.',
      icon: '♥',
      accent: '#ffcc02',
      details: [
        { label: 'Ordernummer', value: number },
        { label: 'Orderdatum', value: orderDate(order) },
        { label: 'Totalt', value: orderTotal(order) },
      ],
      items,
      benefits: true,
    }),
    text: plainLines([
      'Tack för din order!',
      number,
      items.map((item) => `${item.quantity || 1} x ${item.title || item.name || 'Produkt'}`).join('\n'),
      `Totalt ${orderTotal(order)}`,
    ]),
  });
}

async function sendWelcomeEmail(profile) {
  return sendResendEmail({
    to: profile.email,
    userId: profile.id,
    type: 'account_created',
    subject: 'Välkommen till Versen',
    html: emailFrame({
      title: 'Välkommen till Versen!',
      intro: 'Kul att du är här. Hos oss hittar du tusentals produkter till låga priser varje dag.',
      icon: '▰',
      ctaLabel: 'Utforska sortimentet',
      ctaHref: siteUrl('/produkter'),
      benefits: true,
    }),
    text: `Välkommen till Versen. Utforska sortimentet: ${siteUrl('/produkter')}`,
  });
}

async function sendAbandonedCheckoutEmail({ email, checkout = {} }) {
  const items = Array.isArray(checkout.items || checkout.products) ? (checkout.items || checkout.products) : [];

  return sendResendEmail({
    to: email,
    type: 'abandoned_checkout_reminder',
    subject: 'Din Versen-kundvagn väntar',
    html: emailFrame({
      title: 'Din kundvagn väntar på dig',
      intro: 'Vi märkte att du lämnade något i din kundvagn. Produkterna väntar fortfarande på dig.',
      icon: '🛒',
      accent: '#ff5d86',
      ctaLabel: 'Gå till din kundvagn',
      ctaHref: siteUrl('/kundkorg'),
      items,
      notice: 'Kom ihåg: som medlem får du alltid våra bästa priser.',
      benefitTone: 'pink',
      benefits: false,
    }),
    text: `Din Versen-kundvagn väntar. Fortsätt här: ${siteUrl('/kundkorg')}`,
  });
}

function orderStatusContent(order, status = {}) {
  const type = String(status.type || '').toLowerCase();
  const statusText = String(status.status || status.orderStatus || '').toLowerCase();

  if (type.includes('retur') || type.includes('return') || statusText.includes('retur')) {
    return {
      type: 'order_return_received',
      subject: 'Din retur är mottagen',
      title: 'Din retur är mottagen',
      intro: 'Tack för att du returnerade din vara. Vi har mottagit returen och behandlar den snarast.',
      icon: '↩',
      accent: '#ffb8c7',
      notice: 'Återbetalning sker inom 2 veckor.',
      benefitTone: 'pink',
    };
  }

  if (type.includes('delivered') || statusText.includes('levererad') || statusText.includes('delivered')) {
    return {
      type: 'order_delivered',
      subject: 'Din order är levererad',
      title: 'Din order är levererad!',
      intro: 'Vi hoppas att du är nöjd med ditt köp. Tack för att du handlar hos Versen.',
      icon: '⌂',
      accent: '#ffcc02',
      ctaLabel: 'Se din order',
      ctaHref: siteUrl('/order'),
    };
  }

  if (type.includes('shipped') || statusText.includes('skickad') || statusText.includes('fulfilled')) {
    return {
      type: 'order_shipped',
      subject: 'Din order är skickad',
      title: 'Din order är skickad!',
      intro: 'Yay! Din order är nu på väg till dig.',
      icon: '▸',
      accent: '#ffcc02',
      ctaLabel: status.trackingUrl ? 'Spåra din order' : '',
      ctaHref: status.trackingUrl || '',
    };
  }

  if (type.includes('packing') || statusText.includes('packas') || statusText.includes('packning')) {
    return {
      type: 'order_packing',
      subject: 'Din order packas',
      title: 'Din order packas',
      intro: 'Bra nyheter! Vi packar just nu din order med omsorg och noggrannhet.',
      icon: '□',
      accent: '#ffcc02',
    };
  }

  if (type.includes('refunded') || statusText.includes('återbetald')) {
    return {
      type: 'order_refunded',
      subject: 'Din återbetalning är behandlad',
      title: 'Återbetalning behandlad',
      intro: 'Vi har behandlat återbetalningen. Pengarna syns normalt på kortet inom några bankdagar.',
      icon: '%',
      accent: '#ffb8c7',
      benefitTone: 'pink',
      benefits: false,
    };
  }

  return {
    type: status.type || 'order_status',
    subject: 'Orderstatus uppdaterad',
    title: 'Orderstatus uppdaterad',
    intro: status.message || 'Vi har uppdaterat statusen för din order.',
    icon: '✓',
    accent: '#ffcc02',
  };
}

async function sendOrderStatusEmail(order, status) {
  const content = orderStatusContent(order, status);

  return sendResendEmail({
    to: order.email,
    userId: order.user_id,
    orderId: order.id,
    type: content.type,
    subject: content.subject,
    html: emailFrame({
      title: content.title,
      intro: status.message || content.intro,
      icon: content.icon,
      accent: content.accent,
      ctaLabel: content.ctaLabel,
      ctaHref: content.ctaHref,
      details: [
        { label: 'Ordernummer', value: orderNumber(order) },
        { label: 'Trackingnummer', value: status.trackingNumber || order.tracking_number || order.trackingNumber || '' },
      ],
      items: content.type === 'order_packing' ? null : orderItems(order),
      notice: content.notice,
      benefitTone: content.benefitTone,
      benefits: content.benefits !== false,
    }),
    text: plainLines([
      content.title,
      status.message || content.intro,
      orderNumber(order),
      status.trackingUrl || '',
    ]),
  });
}

async function sendSupportReplyEmail({ to, subject, message }) {
  return sendResendEmail({
    to,
    type: 'support_reply',
    subject: subject || 'Svar från Versen support',
    html: emailFrame({
      title: 'Svar från Versen',
      intro: message,
      icon: '✉',
      ctaLabel: 'Besök hjälpcenter',
      ctaHref: siteUrl('/faq'),
      benefits: false,
    }),
    text: message,
  });
}

async function sendMembershipEmail({ customer, subscription, type }) {
  const active = type === 'membership_activated';
  const failed = type === 'payment_failed';
  const canceled = type === 'membership_cancelled';
  const subject = active
    ? 'Välkommen som medlem hos Versen'
    : (failed ? 'Betalningen för ditt medlemskap misslyckades' : 'Ditt medlemskap är uppsagt');
  const title = active
    ? 'Välkommen som medlem!'
    : (failed ? 'Uppdatera betalningen' : 'Medlemskapet avslutas');
  const intro = active
    ? 'Tack för att du blev medlem hos Versen. Som medlem får du tillgång till exklusiva förmåner och erbjudanden.'
    : (failed
      ? 'Stripe kunde inte debitera medlemskapet. Uppdatera ditt kort för att behålla medlemspriserna.'
      : 'Du behåller dina medlemsförmåner till slutet av den betalda perioden.');

  return sendResendEmail({
    to: customer.email,
    userId: customer.userId || customer.id,
    type,
    subject,
    html: emailFrame({
      title,
      intro,
      icon: active ? '★' : '!',
      accent: active ? '#ff5d86' : '#ffcc02',
      ctaLabel: failed ? 'Uppdatera betalning' : 'Upptäck medlemsförmåner',
      ctaHref: failed ? siteUrl('/installningar') : siteUrl('/medlemskap-aktivt'),
      notice: active ? 'Medlemspriser, förtur till nya produkter och exklusiva medlemsrabatter.' : '',
      benefitTone: active ? 'pink' : 'default',
      benefits: active,
    }),
    text: plainLines([
      title,
      intro,
      subscription && subscription.id ? `Subscription: ${subscription.id}` : '',
    ]),
  });
}

module.exports = {
  emailFrame,
  escapeHtml,
  sendAbandonedCheckoutEmail,
  sendMembershipEmail,
  sendOrderConfirmationEmail,
  sendOrderStatusEmail,
  sendPasswordResetEmail,
  sendResendEmail,
  sendSupportReplyEmail,
  sendVerificationRequestEmail,
  sendWelcomeEmail,
};
