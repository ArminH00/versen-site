#!/usr/bin/env node

const {
  sendAbandonedCheckoutEmail,
  sendMembershipEmail,
  sendOrderConfirmationEmail,
  sendOrderStatusEmail,
  sendPasswordResetEmail,
  sendSupportReplyEmail,
  sendVerificationRequestEmail,
  sendWelcomeEmail,
} = require('../lib/email');

function loadEnvFile(pathname) {
  if (!pathname) return;

  const fs = require('fs');
  if (!fs.existsSync(pathname)) return;

  fs.readFileSync(pathname, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) return;
    const key = match[1];
    let value = match[2] || '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

loadEnvFile(process.argv[3]);

const to = process.argv[2] || 'armin@hurtic.com';
const now = new Date().toISOString();
const sampleOrder = {
  id: 'ord_test_versen',
  user_id: 'usr_test_versen',
  email: to,
  order_number: '#V12345',
  created_at: now,
  total: 53800,
  tracking_number: 'SE12345678900',
  tracking_url: 'https://versen.se/order',
  items: [
    {
      title: 'Canvas Tote Bag',
      sku: 'VERSEN-TOTE-GRON',
      quantity: 1,
      unit_price: 49900,
      total_price: 49900,
      total: '499 kr',
    },
  ],
};

const checkout = {
  id: 'chk_test_versen',
  products: [
    {
      title: 'Thermo Bottle',
      quantity: 1,
      price: '299 kr',
    },
  ],
};

async function run() {
  const jobs = [
    ['email_verification', () => sendVerificationRequestEmail({
      to,
      verificationUrl: 'https://versen.se/konto?verify=test',
      next: 'checkout',
    })],
    ['account_created', () => sendWelcomeEmail({ id: 'usr_test_versen', email: to })],
    ['password_reset', () => sendPasswordResetEmail({ to, resetUrl: 'https://versen.se/konto?reset=test' })],
    ['order_confirmation', () => sendOrderConfirmationEmail(sampleOrder)],
    ['order_packing', () => sendOrderStatusEmail(sampleOrder, { type: 'order_packing', status: 'packas' })],
    ['order_shipped', () => sendOrderStatusEmail(sampleOrder, {
      type: 'order_shipped',
      status: 'skickad',
      trackingUrl: sampleOrder.tracking_url,
      trackingNumber: sampleOrder.tracking_number,
    })],
    ['order_delivered', () => sendOrderStatusEmail(sampleOrder, { type: 'order_delivered', status: 'levererad' })],
    ['order_return_received', () => sendOrderStatusEmail(sampleOrder, { type: 'order_return_received', status: 'retur mottagen' })],
    ['abandoned_checkout_reminder', () => sendAbandonedCheckoutEmail({ email: to, checkout })],
    ['membership_activated', () => sendMembershipEmail({
      customer: { id: 'usr_test_versen', email: to },
      subscription: { id: 'sub_test_versen' },
      type: 'membership_activated',
    })],
    ['payment_failed', () => sendMembershipEmail({
      customer: { id: 'usr_test_versen', email: to },
      subscription: { id: 'sub_test_versen' },
      type: 'payment_failed',
    })],
    ['membership_cancelled', () => sendMembershipEmail({
      customer: { id: 'usr_test_versen', email: to },
      subscription: { id: 'sub_test_versen' },
      type: 'membership_cancelled',
    })],
    ['support_reply', () => sendSupportReplyEmail({
      to,
      subject: 'Svar från Versen support',
      message: 'Hej! Vi har tittat på ditt ärende och återkommer här med nästa steg.',
    })],
  ];

  for (const [name, task] of jobs) {
    const result = await task();
    console.log(`${name}: ${result.ok ? 'sent' : 'failed'} ${result.status || ''}${result.skipped ? ' skipped' : ''}`);
    if (!result.ok) {
      console.log(JSON.stringify(result.body || result, null, 2));
      process.exitCode = 1;
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
