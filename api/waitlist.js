const { readBody, sendJson } = require('./shopify');

function clean(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

  const email = clean(body.email, 180).toLowerCase();

  if (!isEmail(email)) {
    sendJson(res, 400, { error: 'Skriv en giltig email.' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.VERSEN_EMAIL_FROM || 'Versen <hej@versen.se>';
  const supportEmail = process.env.VERSEN_SUPPORT_EMAIL || 'hej@versen.se';

  if (!apiKey) {
    sendJson(res, 200, { status: 'Klart. Du är först i kön.' });
    return;
  }

  const safeEmail = escapeHtml(email);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [supportEmail],
      reply_to: email,
      subject: 'Ny person på Versen waitlist',
      html: `
        <div style="font-family:Arial,sans-serif;background:#090a0d;color:#fff;padding:28px">
          <p style="letter-spacing:2px;text-transform:uppercase;color:#82f7d2;font-size:12px;margin:0 0 18px">Versen waitlist</p>
          <h1 style="margin:0 0 12px">Ny email</h1>
          <p><strong>Email:</strong> ${safeEmail}</p>
        </div>
      `,
      text: `Ny Versen waitlist-email: ${email}`,
    }),
  });

  if (!response.ok) {
    sendJson(res, 200, { status: 'Klart. Du är först i kön.' });
    return;
  }

  sendJson(res, 200, { status: 'Klart. Du är först i kön.' });
};
