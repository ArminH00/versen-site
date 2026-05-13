const { isSupabaseConfigured, logEmail } = require('./supabase');

const EMAIL_COLORS = {
  page: '#F6F5F2',
  card: '#FBF9F6',
  primary: '#D9D2C4',
  text: '#111111',
  muted: '#6F6F6B',
  line: '#E6E3DE',
  member: '#EDE7F3',
  delivery: '#FEFFE2',
  icon: '#8E8B84',
};

const FOOTER_NOTE = 'Det du älskar, alltid till medlemspris.';

function resendFrom() {
  const configured = String(process.env.RESEND_FROM_EMAIL || process.env.VERSEN_EMAIL_FROM || '').trim();
  const valid = /^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(configured)
    || /^.+ <[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(configured);

  return valid ? configured : 'Versen <hej@versen.se>';
}

function siteUrl(path = '') {
  let origin = 'https://versen.se';

  try {
    origin = new URL(process.env.VERSEN_SITE_URL || origin).origin;
  } catch (error) {
    origin = 'https://versen.se';
  }

  const cleanPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  return `${origin}${cleanPath === '/' ? '' : cleanPath}`;
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

function orderSavings(order = {}) {
  const candidates = [
    order.savings,
    order.saved,
    order.discount,
    order.total_discount,
    order.totalDiscount,
    order.total_discounts,
  ];
  const direct = candidates.find((value) => Number(value) > 0);
  if (direct) return formatSekOre(direct);

  const items = orderItems(order);
  const itemSavings = items.reduce((sum, item) => {
    const compare = Number(item.compare_at_price || item.compareAtPrice || item.original_price || item.originalPrice || item.comparePrice) || 0;
    const price = Number(item.unit_price || item.unitPrice || item.price || 0) || 0;
    const quantity = Number(item.quantity) || 1;
    return compare > price ? sum + ((compare - price) * quantity) : sum;
  }, 0);

  return itemSavings > 0 ? formatSekOre(itemSavings) : '— kr';
}

function plainLines(lines) {
  return lines.filter(Boolean).join('\n');
}

function iconSvg(name, color = EMAIL_COLORS.icon, size = 44) {
  const icons = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    heart: '<path d="M20.8 8.6c0 5.2-8.8 10.1-8.8 10.1S3.2 13.8 3.2 8.6A4.7 4.7 0 0 1 12 6.2a4.7 4.7 0 0 1 8.8 2.4Z"/>',
    return: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    cart: '<path d="M6 6h15l-2 8H8L6 3H3"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    truck: '<path d="M10 17H6a2 2 0 1 1-4 0V6h12v11"/><path d="M14 9h4l4 4v4h-2a2 2 0 1 1-4 0h-2V9Z"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/>',
  };
  const paths = icons[name];
  if (!paths) return '';

  return `
    <svg width="${Number(size) || 44}" height="${Number(size) || 44}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto;color:${escapeHtml(color)}">
      <g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</g>
    </svg>
  `;
}

function renderIcon(name, color) {
  if (!name) return '';

  return `
    <div style="margin:20px auto 28px;text-align:center">
      ${iconSvg(name, color)}
    </div>
  `;
}

function renderButton(label, href, tone = 'primary') {
  if (!label || !href) return '';
  const primary = tone === 'primary';
  return `
    <a href="${escapeHtml(href)}" style="display:inline-block;margin-top:22px;background:${primary ? EMAIL_COLORS.primary : EMAIL_COLORS.card};color:${EMAIL_COLORS.text};border:1px solid ${primary ? EMAIL_COLORS.primary : EMAIL_COLORS.line};padding:15px 24px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500">
      ${escapeHtml(label)}
    </a>
  `;
}

function renderDetails(details = []) {
  const rows = details.filter((item) => item && (item.value || item.label));
  if (!rows.length) return '';

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:26px;border:1px solid ${EMAIL_COLORS.line};border-radius:10px;background:${EMAIL_COLORS.card};overflow:hidden">
      <tbody>
        ${rows.map((item, index) => `
          <tr>
            <td style="padding:15px 17px;${index < rows.length - 1 ? `border-bottom:1px solid ${EMAIL_COLORS.line};` : ''}color:${EMAIL_COLORS.muted};font-size:13px">${escapeHtml(item.label)}</td>
            <td align="right" style="padding:15px 17px;${index < rows.length - 1 ? `border-bottom:1px solid ${EMAIL_COLORS.line};` : ''}color:${EMAIL_COLORS.text};font-size:14px;font-weight:600">${escapeHtml(item.value)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function itemPrice(item = {}) {
  if (item.total && String(item.total).includes('kr')) return item.total;
  if (item.price && String(item.price).includes('kr')) return item.price;
  if (item.unitPrice && String(item.unitPrice).includes('kr')) return item.unitPrice;
  const value = item.total_price || item.totalPrice || item.unit_price || item.unitPrice || item.price;
  return value ? formatSekOre(value) : '';
}

function renderItems(items = []) {
  const rows = items.filter(Boolean);
  if (!rows.length) return '';

  return `
    <div style="margin-top:28px;text-align:left">
      <p style="margin:0 0 12px;color:${EMAIL_COLORS.text};font-size:15px;font-weight:600">Produkter</p>
      ${rows.map((item) => `
        <div style="display:block;padding:14px 0;border-bottom:1px solid ${EMAIL_COLORS.line}">
          <div style="color:${EMAIL_COLORS.text};font-size:15px;font-weight:600">${escapeHtml(item.title || item.name || 'Produkt')}</div>
          <div style="margin-top:4px;color:${EMAIL_COLORS.muted};font-size:13px">${escapeHtml(item.quantity || 1)} st${item.sku ? ` · SKU ${escapeHtml(item.sku)}` : ''}</div>
          ${itemPrice(item) ? `<div style="margin-top:8px;color:${EMAIL_COLORS.text};font-size:13px;font-weight:600">${escapeHtml(itemPrice(item))}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderBenefits(tone = 'default') {
  const background = tone === 'member' ? EMAIL_COLORS.member : EMAIL_COLORS.card;
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;border:1px solid ${EMAIL_COLORS.line};border-radius:10px;background:${background}">
      <tr>
        <td style="padding:18px 10px;text-align:center;color:${EMAIL_COLORS.text};font-size:13px;font-weight:500">${iconSvg('tag', EMAIL_COLORS.icon, 28)}<div style="margin-top:8px">Alltid låga<br>priser</div></td>
        <td style="padding:18px 10px;text-align:center;color:${EMAIL_COLORS.text};font-size:13px;font-weight:500">${iconSvg('user', EMAIL_COLORS.icon, 28)}<div style="margin-top:8px">Medlemspriser</div></td>
        <td style="padding:18px 10px;text-align:center;color:${EMAIL_COLORS.text};font-size:13px;font-weight:500">${iconSvg('truck', EMAIL_COLORS.icon, 28)}<div style="margin-top:8px">Snabba<br>leveranser</div></td>
      </tr>
    </table>
  `;
}

function renderNotice(copy, tone = 'default') {
  if (!copy) return '';
  const background = tone === 'member' ? EMAIL_COLORS.member : tone === 'delivery' ? EMAIL_COLORS.delivery : EMAIL_COLORS.card;
  return `
    <div style="margin-top:24px;border:1px solid ${EMAIL_COLORS.line};border-radius:10px;background:${background};padding:18px;color:${EMAIL_COLORS.text};font-size:15px;font-weight:500;text-align:center;line-height:1.4">
      ${escapeHtml(copy)}
    </div>
  `;
}

function renderMemberCard(name) {
  const displayName = String(name || '').trim() || 'Versen medlem';
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:26px;border:1px solid #b9a66a;border-radius:14px;background:#111111;box-shadow:inset 0 0 0 1px #d8c276;color:#FBF9F6">
      <tr>
        <td style="padding:24px;text-align:left">
          <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#d8c276;font-weight:600">VERSEN</div>
          <div style="margin-top:42px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1;color:#FBF9F6">Member Club</div>
          <div style="margin-top:34px;color:#d8c276;font-size:14px;font-weight:600">${escapeHtml(displayName)}</div>
        </td>
      </tr>
    </table>
  `;
}

function emailFrame({
  title,
  intro,
  icon,
  iconColor = EMAIL_COLORS.icon,
  ctaLabel,
  ctaHref,
  ctaTone = 'primary',
  details,
  items,
  notice,
  noticeTone = 'default',
  benefits = true,
  benefitTone = 'default',
  memberCardName = '',
}) {
  return `
    <!doctype html>
    <html lang="sv">
      <body style="margin:0;background:${EMAIL_COLORS.page};padding:0;color:${EMAIL_COLORS.text};font-family:Inter,Arial,sans-serif">
        <div style="display:none;max-height:0;overflow:hidden;color:transparent">${escapeHtml(intro || title)}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${EMAIL_COLORS.page};padding:28px 12px">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:${EMAIL_COLORS.card};border:1px solid ${EMAIL_COLORS.line};border-radius:16px;overflow:hidden;box-shadow:0 18px 48px rgba(17,17,17,.06)">
                <tr>
                  <td style="padding:52px 30px 34px;text-align:center">
                    ${renderIcon(icon, iconColor)}
                    <h1 style="margin:0;color:${EMAIL_COLORS.text};font-family:Georgia,'Times New Roman',serif;font-size:42px;line-height:1.12;letter-spacing:0;font-weight:400">${escapeHtml(title)}</h1>
                    <p style="max-width:380px;margin:20px auto 0;color:${EMAIL_COLORS.muted};font-size:16px;line-height:1.6">${escapeHtml(intro)}</p>
                    ${renderButton(ctaLabel, ctaHref, ctaTone)}
                    ${memberCardName ? renderMemberCard(memberCardName) : ''}
                    ${renderDetails(details)}
                    ${items ? renderItems(items) : ''}
                    ${renderNotice(notice, noticeTone)}
                    ${benefits ? renderBenefits(benefitTone) : ''}
                  </td>
                </tr>
                <tr>
                  <td style="border-top:1px solid ${EMAIL_COLORS.line};background:#111111;padding:26px 28px;text-align:center">
                    <div style="color:#ffffff;font-size:20px;font-weight:500;letter-spacing:0;text-decoration:underline;text-underline-offset:5px">Versen.se</div>
                    <div style="margin-top:10px;color:#ffffff;font-size:13px;line-height:1.45">${FOOTER_NOTE}</div>
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
      icon: 'mail',
      ctaLabel: 'Verifiera e-postadress',
      ctaHref: verificationUrl,
      details: [{ label: 'Länken gäller', value: '30 minuter' }],
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
      icon: 'heart',
      iconColor: '#ffffff',
      details: [
        { label: 'Ordernummer', value: number },
        { label: 'Orderdatum', value: orderDate(order) },
        { label: 'Totalt', value: orderTotal(order) },
      ],
      items,
      notice: `Du sparade ${orderSavings(order)} med denna beställning!`,
      noticeTone: 'delivery',
      benefits: true,
    }),
    text: plainLines([
      'Tack för din order!',
      number,
      items.map((item) => `${item.quantity || 1} x ${item.title || item.name || 'Produkt'}`).join('\n'),
      `Totalt ${orderTotal(order)}`,
      `Du sparade ${orderSavings(order)} med denna beställning!`,
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
      title: 'Välkommen till Versen',
      intro: 'Ta del av alla våra deals och spara massor.',
      ctaLabel: 'Utforska deals',
      ctaHref: siteUrl('/produkter'),
      benefits: true,
    }),
    text: `Välkommen till Versen. Utforska deals: ${siteUrl('/produkter')}`,
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
      icon: 'cart',
      iconColor: '#ffffff',
      ctaLabel: 'Gå till din kundvagn',
      ctaHref: siteUrl('/kundvagn'),
      items,
      notice: `Du sparade ${orderSavings(checkout)} med denna beställning!`,
      noticeTone: 'member',
      benefits: false,
    }),
    text: `Din Versen-kundvagn väntar. Fortsätt här: ${siteUrl('/kundvagn')}`,
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
      icon: 'return',
      iconColor: '#ffffff',
      notice: 'Återbetalning sker inom 2 veckor.',
      noticeTone: 'member',
      benefits: true,
    };
  }

  if (type.includes('delivered') || statusText.includes('levererad') || statusText.includes('delivered')) {
    return {
      type: 'order_delivered',
      subject: 'Din order är levererad',
      title: 'Din order är levererad!',
      intro: 'Vi hoppas att du är nöjd med ditt köp. Tack för att du handlar hos Versen.',
      ctaLabel: 'Se din order',
      ctaHref: siteUrl('/order'),
      savings: true,
    };
  }

  if (type.includes('shipped') || statusText.includes('skickad') || statusText.includes('fulfilled')) {
    return {
      type: 'order_shipped',
      subject: 'Din order är skickad',
      title: 'Din order är skickad!',
      intro: 'Din order är nu på väg till dig.',
      ctaLabel: status.trackingUrl ? 'Spåra din order' : '',
      ctaHref: status.trackingUrl || '',
      savings: true,
    };
  }

  if (type.includes('packing') || statusText.includes('packas') || statusText.includes('plockas') || statusText.includes('packning')) {
    return {
      type: 'order_packing',
      subject: 'Din order packas',
      title: 'Din order packas',
      intro: 'Bra nyheter! Vi packar just nu din order med omsorg och noggrannhet.',
    };
  }

  if (type.includes('refunded') || statusText.includes('återbetald')) {
    return {
      type: 'order_refunded',
      subject: 'Din återbetalning är behandlad',
      title: 'Återbetalning behandlad',
      intro: 'Vi har behandlat återbetalningen. Pengarna syns normalt på kortet inom några bankdagar.',
      benefits: false,
    };
  }

  return {
    type: status.type || 'order_status',
    subject: 'Orderstatus uppdaterad',
    title: 'Orderstatus uppdaterad',
    intro: status.message || 'Vi har uppdaterat statusen för din order.',
  };
}

async function sendOrderStatusEmail(order, status = {}) {
  const content = orderStatusContent(order, status);
  const details = [
    { label: 'Ordernummer', value: orderNumber(order) },
    { label: 'Trackingnummer', value: status.trackingNumber || order.tracking_number || order.trackingNumber || '' },
  ];

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
      iconColor: content.iconColor,
      ctaLabel: content.ctaLabel,
      ctaHref: content.ctaHref,
      details,
      items: content.type === 'order_packing' ? null : orderItems(order),
      notice: content.savings ? `Du sparade ${orderSavings(order)} med denna beställning!` : content.notice,
      noticeTone: content.noticeTone || (content.savings ? 'delivery' : 'default'),
      benefits: content.benefits !== false,
    }),
    text: plainLines([
      content.title,
      status.message || content.intro,
      orderNumber(order),
      status.trackingUrl || '',
      content.savings ? `Du sparade ${orderSavings(order)} med denna beställning!` : '',
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
      icon: 'mail',
      iconColor: '#ffffff',
      ctaLabel: 'Gå till chatten',
      ctaHref: siteUrl('/kontakt'),
      benefits: false,
    }),
    text: message,
  });
}

function customerName(customer = {}) {
  return customer.name
    || customer.displayName
    || [customer.firstName, customer.lastName].filter(Boolean).join(' ')
    || customer.email
    || '';
}

async function sendMembershipEmail({ customer, subscription, type }) {
  const active = type === 'membership_activated';
  const failed = type === 'payment_failed';
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
      ctaLabel: failed ? 'Uppdatera betalning' : active ? '' : 'Upptäck medlemsförmåner',
      ctaHref: failed ? siteUrl('/uppdatera-betalning') : active ? '' : siteUrl('/medlemskap-aktivt'),
      notice: active ? 'Medlemspriser, förtur till nya produkter och exklusiva medlemsrabatter.' : '',
      noticeTone: active ? 'member' : 'default',
      benefitTone: active ? 'member' : 'default',
      benefits: active,
      memberCardName: active ? customerName(customer) : '',
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
