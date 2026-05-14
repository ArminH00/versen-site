const crypto = require('crypto');
const { getCookie, readBody, sendJson } = require('../lib/shopify');
const { getCustomerSession } = require('./membership');
const {
  appendSupportMessage,
  getSupportTicket,
  isSupabaseConfigured,
  listSupportTicketsForCustomer,
  logAdminActivity,
  patchSupportTicket,
} = require('../lib/supabase');

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isCustomerTicket(ticket, customer) {
  if (!ticket || !customer) return false;
  const email = String(customer.email || '').toLowerCase();
  return (ticket.user_id && ticket.user_id === customer.id)
    || (email && String(ticket.email || '').toLowerCase() === email);
}

function isChatTicket(ticket = {}) {
  const metadata = ticket.metadata && typeof ticket.metadata === 'object' ? ticket.metadata : {};
  return metadata.channel === 'chat' || Boolean(ticket.user_id);
}

function normalizeAttachment(item = {}) {
  const type = clean(item.type, 40).toLowerCase();
  const dataUrl = clean(item.dataUrl, 1500000);
  const name = clean(item.name, 120) || 'bild';

  if (!type.startsWith('image/') || !/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) {
    return null;
  }

  return {
    id: `att_${crypto.randomBytes(5).toString('hex')}`,
    type,
    name,
    dataUrl,
  };
}

function normalizeTicket(row = {}) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const messages = safeArray(row.messages);
  const latestMessage = messages[messages.length - 1] || null;

  return {
    id: row.id,
    supportNumber: metadata.support_number || row.id,
    subject: row.subject || row.category || 'Support',
    category: row.category || 'övrigt',
    status: row.status || 'pågående',
    priority: row.priority || 'normal',
    orderId: row.order_id || '',
    email: row.email || '',
    name: row.name || '',
    message: row.message || '',
    messages,
    latestMessageAt: metadata.latest_message_at || (latestMessage && latestMessage.created_at) || row.updated_at || row.created_at,
    customerUnread: Boolean(metadata.customer_unread),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function requireCustomer(req, res) {
  const session = await getCustomerSession(getCookie(req, 'versen_customer_token'));
  if (!session.authenticated || !session.customer) {
    sendJson(res, 401, { error: 'Logga in för att öppna supportchatten.' });
    return null;
  }
  return session.customer;
}

async function handleList(req, res) {
  const customer = await requireCustomer(req, res);
  if (!customer) return;

  if (!isSupabaseConfigured()) {
    sendJson(res, 503, { error: 'Supportchatten är inte konfigurerad ännu.' });
    return;
  }

  const rows = await listSupportTicketsForCustomer(customer.id, customer.email, 80);
  const tickets = rows.filter(isChatTicket).filter((ticket) => isCustomerTicket(ticket, customer)).map(normalizeTicket);
  sendJson(res, 200, { tickets });
}

async function handleGet(req, res, ticketId) {
  const customer = await requireCustomer(req, res);
  if (!customer) return;

  const ticket = await getSupportTicket(ticketId);
  if (!ticket || !isChatTicket(ticket) || !isCustomerTicket(ticket, customer)) {
    sendJson(res, 404, { error: 'Ärendet hittades inte.' });
    return;
  }

  const metadata = ticket.metadata && typeof ticket.metadata === 'object' ? ticket.metadata : {};
  if (metadata.customer_unread) {
    await patchSupportTicket(ticket.id, {
      metadata: {
        ...metadata,
        customer_unread: false,
      },
    }).catch(() => {});
  }

  sendJson(res, 200, { ticket: normalizeTicket(ticket) });
}

async function handleMessage(req, res, body) {
  const customer = await requireCustomer(req, res);
  if (!customer) return;

  const ticketId = clean(body.ticketId, 160);
  const message = clean(body.message, 3000);
  const attachments = safeArray(body.attachments).map(normalizeAttachment).filter(Boolean).slice(0, 3);

  if (!ticketId || (!message && !attachments.length)) {
    sendJson(res, 400, { error: 'Skriv ett meddelande eller bifoga en bild.' });
    return;
  }

  const ticket = await getSupportTicket(ticketId);
  if (!ticket || !isChatTicket(ticket) || !isCustomerTicket(ticket, customer)) {
    sendJson(res, 404, { error: 'Ärendet hittades inte.' });
    return;
  }

  if (['stängt', 'stangd', 'closed'].includes(String(ticket.status || '').toLowerCase())) {
    sendJson(res, 409, { error: 'Ärendet är stängt. Starta ett nytt ärende om du behöver mer hjälp.' });
    return;
  }

  const updated = await appendSupportMessage(ticketId, {
    from: 'customer',
    name: customer.displayName || customer.email,
    email: customer.email,
    message,
    attachments,
  }, {
    status: String(ticket.status || '').toLowerCase().includes('löst') ? 'pågående' : ticket.status,
    channel: 'chat',
  });

  await logAdminActivity({
    action: 'support_customer_reply',
    target_type: 'support_ticket',
    target_id: ticketId,
    message: `Nytt chattsvar från ${customer.email}`,
  }).catch(() => {});

  sendJson(res, 200, { ticket: normalizeTicket(updated) });
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const url = new URL(req.url || '/', 'https://versen.local');
    const ticketId = clean(url.searchParams.get('ticket'), 160);
    if (ticketId) {
      await handleGet(req, res, ticketId);
      return;
    }
    await handleList(req, res);
    return;
  }

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

  if (body.action === 'message') {
    await handleMessage(req, res, body);
    return;
  }

  sendJson(res, 400, { error: 'Okänd supportåtgärd' });
};
