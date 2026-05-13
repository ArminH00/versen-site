(function () {
  const app = document.querySelector('[data-admin-app]');
  if (!app) return;

  const state = {
    authenticated: false,
    view: 'dashboard',
    data: null,
    query: '',
    filters: {},
  };

  const login = document.querySelector('[data-admin-login]');
  const main = document.querySelector('[data-admin-main]');
  const sidebar = document.querySelector('[data-admin-sidebar]');
  const content = document.querySelector('[data-admin-content]');
  const statusRow = document.querySelector('[data-admin-status]');
  const sectionLabel = document.querySelector('[data-admin-section-label]');
  const topbarTitle = document.querySelector('.admin-topbar strong');
  const loginForm = document.querySelector('[data-admin-login-form]');
  const loginMessage = document.querySelector('[data-admin-login-message]');
  const searchForm = document.querySelector('[data-admin-search]');
  const drawer = document.querySelector('[data-admin-drawer]');
  const drawerContent = document.querySelector('[data-admin-drawer-content]');
  const toast = document.querySelector('[data-admin-toast]');
  const confirmModal = document.querySelector('[data-admin-confirm]');
  const confirmTitle = document.querySelector('[data-admin-confirm-title]');
  const confirmCopy = document.querySelector('[data-admin-confirm-copy]');
  const confirmOk = document.querySelector('[data-admin-confirm-ok]');

  const labels = {
    dashboard: 'Översikt',
    orders: 'Ordrar',
    checkouts: 'Lämnade Checkouts',
    memberships: 'Medlemskap',
    users: 'Användare',
    support: 'Support',
    returns: 'Returer',
    settings: 'Inställningar',
    activity: 'Loggar',
    emails: 'Email / Notiser',
  };

  const viewCopy = {
    dashboard: 'Här är en snabb överblick av din butik.',
    orders: 'Alla inkommande och tidigare ordrar.',
    checkouts: 'Följ kunder som lämnade checkout.',
    memberships: 'Medlemskap, status och recurring revenue.',
    users: 'Alla kunder och profiler samlade.',
    support: 'Ärenden, svar och kundhistorik.',
    returns: 'Returer och reklamationer.',
    settings: 'Ändra inställningar för din butik.',
    activity: 'Interna händelser och admin-actions.',
    emails: 'Skickade email och notiser.',
  };

  const orderStatuses = ['alla', 'ny', 'betald', 'väntar på packning', 'packas', 'skickad', 'levererad', 'avbruten', 'återbetald', 'retur'];
  const supportStatuses = ['alla', 'olästa', 'pågående', 'avslutade', 'returer', 'övrigt'];
  const membershipStatuses = ['alla', 'active', 'trialing', 'paused', 'canceled', 'incomplete', 'past_due'];

  document.documentElement.style.setProperty('--admin-view-copy', `"${viewCopy.dashboard}"`);
  if (topbarTitle) topbarTitle.textContent = labels.dashboard;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function compactDate(value) {
    if (!value) return 'Tid saknas';
    try {
      return new Intl.DateTimeFormat('sv-SE', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(value));
    } catch (error) {
      return 'Tid saknas';
    }
  }

  function list(name) {
    return (state.data && state.data.lists && Array.isArray(state.data.lists[name]))
      ? state.data.lists[name]
      : [];
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.hidden = true;
    }, 3200);
  }

  function setShell(authenticated) {
    state.authenticated = authenticated;
    if (login) login.hidden = authenticated;
    if (main) main.hidden = !authenticated;
    if (sidebar) sidebar.hidden = !authenticated;
    renderBottomNav();
  }

  function renderBottomNav() {
    let bottomNav = document.querySelector('[data-admin-bottom-nav]');

    if (!state.authenticated) {
      if (bottomNav) bottomNav.remove();
      return;
    }

    if (!bottomNav) {
      bottomNav = document.createElement('nav');
      bottomNav.className = 'admin-bottom-nav';
      bottomNav.dataset.adminBottomNav = 'true';
      bottomNav.setAttribute('aria-label', 'Admin snabbnavigering');
      document.body.appendChild(bottomNav);
    }

    const items = [
      ['dashboard', 'Översikt'],
      ['orders', 'Ordrar'],
      ['checkouts', 'Checkouts'],
      ['users', 'Kunder'],
      ['settings', 'Mer'],
    ];

    bottomNav.innerHTML = items.map(([view, label]) => (
      `<button class="${state.view === view ? 'active' : ''}" type="button" data-admin-view="${view}">${escapeHtml(label)}</button>`
    )).join('');
  }

  async function getJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Servern svarade med fel');
    }
    return data;
  }

  async function postJson(url, body) {
    return getJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function renderStatus() {
    if (!statusRow || !state.data) return;
    const diagnostics = state.data.diagnostics || {};
    const supabase = diagnostics.supabase || {};
    const shopify = diagnostics.shopify || {};
    const resend = diagnostics.resend || {};
    const pills = [
      ['Shopify orders', shopify.orders && shopify.orders.ok],
      ['Shopify kunder', shopify.customers && shopify.customers.ok],
      ['Supabase', supabase.configured],
      ['Resend', resend.configured],
      ['Supporttabell', supabase.supportTickets && supabase.supportTickets.ok],
      ['Abandoned', supabase.abandonedCheckouts && supabase.abandonedCheckouts.ok],
      ['Activity', supabase.activity && supabase.activity.ok],
    ];

    statusRow.innerHTML = pills.map(([label, ok]) => (
      `<span class="admin-pill ${ok ? 'ok' : 'warn'}">${escapeHtml(label)} ${ok ? 'OK' : 'saknas'}</span>`
    )).join('');
  }

  function setView(view) {
    state.view = view;
    if (sectionLabel) sectionLabel.textContent = labels[view] || 'Admin';
    if (topbarTitle) topbarTitle.textContent = labels[view] || 'Admin';
    document.documentElement.style.setProperty('--admin-view-copy', `"${viewCopy[view] || viewCopy.dashboard}"`);
    document.querySelectorAll('[data-admin-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.adminView === view);
    });
    renderBottomNav();
    document.body.classList.remove('admin-sidebar-open');
    render();
  }

  async function loadDashboard() {
    if (content) content.innerHTML = '<div class="admin-loading">Laddar kontrollrummet...</div>';
    const query = state.query ? `&q=${encodeURIComponent(state.query)}` : '';
    state.data = await getJson(`/api/admin-members?mode=dashboard${query}`);
    renderStatus();
    render();
  }

  function empty(title, copy) {
    return `<div class="admin-empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></div>`;
  }

  function badge(value) {
    const normalized = String(value || '').toLowerCase();
    const cls = normalized.includes('active') || normalized.includes('paid') || normalized.includes('skickad') || normalized.includes('fulfilled')
      ? 'ok'
      : normalized.includes('failed') || normalized.includes('cancel') || normalized.includes('avbruten') || normalized.includes('refund')
        ? 'danger'
        : 'warn';
    return `<span class="admin-badge ${cls}">${escapeHtml(value || 'okänd')}</span>`;
  }

  function sectionIntro(title, copy, count) {
    return `
      <div class="admin-heading">
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(copy)}</p>
        </div>
        ${count === undefined ? '' : `<span class="admin-pill ok">${escapeHtml(String(count))} träffar</span>`}
      </div>
    `;
  }

  function renderKpis() {
    const stats = state.data && state.data.stats ? state.data.stats : {};
    const cards = [
      ['revenueToday', 'Intjänat belopp', stats.revenueToday, 'orders', 'Inkommande'],
      ['ordersToday', 'Antal ordrar', stats.ordersToday, 'orders', 'Inkommande'],
      ['abandonedToday', 'Lämnade checkouts', stats.abandonedToday, 'checkouts', 'Öppna checkout-listan'],
      ['membershipsToday', 'Medlemskap idag', stats.membershipsToday, 'memberships', 'Nya skapade/sålda'],
      ['membershipRevenueToday', 'Medlemskap kr', stats.membershipRevenueToday, 'memberships', 'Kräver prisdata/webhook'],
      ['activeMemberships', 'Aktiva medlemskap', stats.activeMemberships, 'memberships', 'Aktiva/trialing'],
      ['mrr', 'MRR', stats.mrr, 'memberships', 'Monthly recurring revenue'],
      ['arr', 'ARR', stats.arr, 'memberships', 'Annual recurring revenue'],
      ['supportMessages', 'Support', stats.supportMessages, 'support', 'Alla ärenden'],
      ['unreadSupportMessages', 'Olästa support', stats.unreadSupportMessages, 'support', 'Behöver svar'],
      ['awaitingPacking', 'Väntar packning', stats.awaitingPacking, 'orders', 'Orders att hantera'],
      ['shippedOrders', 'Skickade', stats.shippedOrders, 'orders', 'Fulfilled/skickad'],
      ['returns', 'Returer/ärenden', stats.returns, 'returns', 'Returflöde'],
    ];

    return `<div class="admin-kpi-grid">${cards.map((card) => `
      <article class="admin-card">
        <button type="button" data-jump-view="${card[3]}">
          <span class="admin-card-label">${escapeHtml(card[1])}</span>
          <strong>${escapeHtml(card[2] == null ? '0' : card[2])}</strong>
          <p>${escapeHtml(card[4])}</p>
        </button>
      </article>
    `).join('')}</div>`;
  }

  function dayKey(value) {
    try {
      return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Stockholm',
        month: 'short',
        day: 'numeric',
      }).format(new Date(value));
    } catch (error) {
      return '';
    }
  }

  function chartSeries() {
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - index));
      return {
        key: dayKey(date.toISOString()),
        value: 0,
      };
    });
    list('orders').forEach((order) => {
      const key = dayKey(order.createdAt);
      const item = days.find((day) => day.key === key);
      if (item) item.value += Number(order.totalValue) || 0;
    });
    const max = Math.max(...days.map((day) => day.value), 1);
    return { days, max };
  }

  function statusDistribution() {
    const orders = list('orders');
    const groups = [
      ['Betald', orders.filter((order) => String(order.paymentStatus || order.orderStatus || '').toLowerCase().includes('paid')).length, '--admin-green'],
      ['Under behandling', orders.filter((order) => /pending|open|unfulfilled|under/.test(String(order.orderStatus || order.fulfillmentStatus || '').toLowerCase())).length, '--admin-blue'],
      ['Skickad', orders.filter((order) => /shipped|fulfilled|skickad/.test(String(order.orderStatus || order.fulfillmentStatus || '').toLowerCase())).length, '--admin-purple'],
      ['Avbruten', orders.filter((order) => /cancel|refund|avbruten/.test(String(order.orderStatus || order.paymentStatus || '').toLowerCase())).length, '--admin-yellow'],
    ];
    const total = Math.max(groups.reduce((sum, group) => sum + group[1], 0), 1);
    let cursor = 0;
    const stops = groups.map((group) => {
      const start = cursor;
      cursor += (group[1] / total) * 100;
      return { label: group[0], count: group[1], start, end: cursor, color: group[2] };
    });
    return { stops, total };
  }

  function renderCharts() {
    const series = chartSeries();
    const distribution = statusDistribution();
    const paid = distribution.stops[0] ? distribution.stops[0].end : 0;
    const processing = distribution.stops[1] ? distribution.stops[1].end : paid;
    const shipped = distribution.stops[2] ? distribution.stops[2].end : processing;
    return `
      <div class="admin-chart-grid">
        <article class="admin-chart-card">
          <div class="admin-table-top">
            <h2>Intäkter över tid</h2>
            <span class="admin-pill">Senaste 7 dagarna</span>
          </div>
          <div class="admin-bars">
            ${series.days.map((day) => `
              <div class="admin-bar" title="${escapeHtml(`${day.key}: ${day.value} kr`)}">
                <span style="height:${Math.max(8, Math.round((day.value / series.max) * 100))}%"></span>
                <small>${escapeHtml(day.key)}</small>
              </div>
            `).join('')}
          </div>
        </article>
        <article class="admin-chart-card">
          <div class="admin-table-top">
            <h2>Statusfördelning</h2>
          </div>
          <div class="admin-donut-wrap">
            <div class="admin-donut" style="--paid:${paid}%;--processing:${processing}%;--shipped:${shipped}%"></div>
            <div class="admin-legend">
              ${distribution.stops.map((item) => `
                <span style="--legend-color:var(${item.color})"><b>${escapeHtml(item.label)}</b><strong>${escapeHtml(String(item.count))}</strong></span>
              `).join('')}
            </div>
          </div>
        </article>
      </div>
    `;
  }

  function renderRecent() {
    return `
      <div class="admin-grid-2">
        ${tableCard('Senaste orders', list('orders').slice(0, 8), renderOrderRow, 'Inga orders hittades.')}
        ${tableCard('Riskzon nu', list('checkouts').slice(0, 8), renderCheckoutRow, 'Inga öppna checkout-drafts hittades.')}
      </div>
    `;
  }

  function tableCard(title, rows, rowRenderer, emptyCopy, filters = '') {
    return `
      <article class="admin-table-card">
        <div class="admin-table-top">
          <h2>${escapeHtml(title)}</h2>
          <span class="admin-pill">${rows.length}</span>
        </div>
        ${filters}
        <div class="admin-list">
          ${rows.length ? rows.map(rowRenderer).join('') : empty('Tom lista', emptyCopy)}
        </div>
      </article>
    `;
  }

  function renderOrderRow(order) {
    return `
      <div class="admin-row">
        <div>
          <strong>${escapeHtml(order.name || order.id)}</strong>
          <small>${escapeHtml(order.email || 'Email saknas')} · ${compactDate(order.createdAt)}</small>
        </div>
        <span>${escapeHtml((order.items || []).slice(0, 2).map((item) => `${item.quantity} x ${item.title}`).join(', ') || 'Produkter saknas')}</span>
        <span>${badge(order.paymentStatus || order.orderStatus)} ${escapeHtml(order.total || '')}</span>
        <button class="admin-action" type="button" data-open-order="${escapeHtml(order.id)}">Öppna</button>
      </div>
    `;
  }

  function renderCheckoutRow(checkout) {
    return `
      <div class="admin-row">
        <div>
          <strong>${escapeHtml(checkout.name || checkout.email || checkout.id)}</strong>
          <small>${escapeHtml(checkout.email || 'Email saknas')} · ${compactDate(checkout.updatedAt || checkout.createdAt)}</small>
        </div>
        <span>${escapeHtml((checkout.products || []).slice(0, 2).map((item) => `${item.quantity} x ${item.title}`).join(', ') || 'Varukorg saknas')}</span>
        <span>${badge(checkout.contacted ? 'kontaktad' : checkout.status)} ${escapeHtml(checkout.cartValue || '')}</span>
        <button class="admin-action" type="button" data-open-checkout="${escapeHtml(checkout.id)}">Öppna</button>
      </div>
    `;
  }

  function renderUserRow(user) {
    return `
      <div class="admin-row">
        <div>
          <strong>${escapeHtml(user.name || user.email || user.id)}</strong>
          <small>${escapeHtml(user.email || 'Email saknas')} · ${escapeHtml(user.source || '')}</small>
        </div>
        <span>${escapeHtml(user.numberOfOrders || 0)} orders · ${escapeHtml(user.amountSpent || '0 kr')}</span>
        <span>${badge(user.membershipStatus || 'okänd')}</span>
        <button class="admin-action" type="button" data-open-user="${escapeHtml(user.email || user.id)}">Öppna</button>
      </div>
    `;
  }

  function renderMembershipRow(item) {
    return `
      <div class="admin-row">
        <div>
          <strong>${escapeHtml(item.email || item.stripeSubscriptionId || item.id)}</strong>
          <small>${escapeHtml(item.customerName || item.userId || 'Kund saknas')}</small>
        </div>
        <span>${escapeHtml(item.stripeSubscriptionId || 'Stripe-id saknas')}</span>
        <span>${badge(item.status)} ${item.cancelAtPeriodEnd ? badge('avslutas') : ''}</span>
        <button class="admin-action" type="button" data-open-membership="${escapeHtml(item.id)}">Öppna</button>
      </div>
    `;
  }

  function renderSupportRow(ticket) {
    return `
      <div class="admin-row">
        <div>
          <strong>${escapeHtml(ticket.subject || ticket.id)}</strong>
          <small>${escapeHtml(ticket.email || 'Email saknas')} · ${compactDate(ticket.updatedAt || ticket.createdAt)}</small>
        </div>
        <span>${escapeHtml(ticket.message || 'Meddelande saknas')}</span>
        <span>${badge(ticket.unread ? 'oläst' : ticket.status)} ${escapeHtml(ticket.category || '')}</span>
        <button class="admin-action" type="button" data-open-support="${escapeHtml(ticket.id)}">Öppna</button>
      </div>
    `;
  }

  function renderDashboard() {
    content.innerHTML = `
      <section class="admin-section">
        ${sectionIntro('Dagens statistik', 'Snabb överblick över Versens liveflöden.', undefined)}
        ${renderKpis()}
        ${renderCharts()}
        ${renderRecent()}
      </section>
    `;
  }

  function filterRows(rows, key, values) {
    const active = state.filters[key] || 'alla';
    if (active === 'alla') return rows;
    const aliases = {
      ny: ['new', 'open', 'pending'],
      betald: ['paid'],
      'väntar på packning': ['unfulfilled', 'pending_shopify_sync', 'paid_synced_shopify'],
      packas: ['packing', 'packas'],
      skickad: ['shipped', 'fulfilled', 'skickad'],
      levererad: ['delivered', 'levererad'],
      avbruten: ['cancelled', 'canceled', 'avbruten'],
      återbetald: ['refunded', 'återbetald'],
      retur: ['return', 'retur'],
      olästa: ['unread', 'oläst', 'true'],
      pågående: ['open', 'ongoing', 'pågående'],
      avslutade: ['closed', 'done', 'avslutad', 'avslutade'],
      returer: ['return', 'retur', 'returer'],
      övrigt: ['other', 'övrigt'],
    };
    const needles = aliases[active] || [active];
    return rows.filter((row) => {
      const haystack = `${row.orderStatus || ''} ${row.paymentStatus || ''} ${row.fulfillmentStatus || ''} ${row.status || ''} ${row.category || ''} ${row.unread || ''}`.toLowerCase();
      return needles.some((needle) => haystack.includes(String(needle).toLowerCase()));
    });
  }

  function filterButtons(key, values) {
    const active = state.filters[key] || 'alla';
    return `<div class="admin-filter-row">${values.map((value) => `
      <button class="${active === value ? 'active' : ''}" type="button" data-filter-key="${escapeHtml(key)}" data-filter-value="${escapeHtml(value)}">${escapeHtml(value)}</button>
    `).join('')}</div>`;
  }

  function renderOrders() {
    const rows = filterRows(list('orders'), 'orders', orderStatuses);
    content.innerHTML = `
      <section class="admin-section">
        ${sectionIntro('Orderhantering', 'Sök, filtrera, öppna detaljer och uppdatera orderflöde.', rows.length)}
        ${tableCard('Orderöversikt', rows, renderOrderRow, 'Inga orders matchar filtret.', filterButtons('orders', orderStatuses))}
      </section>
    `;
  }

  function renderCheckouts() {
    const rows = list('checkouts');
    content.innerHTML = `
      <section class="admin-section">
        ${sectionIntro('Lämnade checkouts', 'Riktig checkout-data från Supabase-drafts/abandoned_checkouts.', rows.length)}
        ${tableCard('Checkout risklista', rows, renderCheckoutRow, 'Ingen abandoned checkout-data finns ännu. Tabellen är förberedd i Supabase-schema.')}
      </section>
    `;
  }

  function renderMemberships() {
    const rows = filterRows(list('subscriptions'), 'memberships', membershipStatuses);
    const active = list('subscriptions').filter((item) => ['active', 'trialing'].includes(String(item.status || '').toLowerCase())).length;
    const stats = state.data && state.data.stats ? state.data.stats : {};
    content.innerHTML = `
      <section class="admin-section">
        ${sectionIntro('Medlemskap', `Aktiva medlemskap: ${active}. MRR ${stats.mrr || 'Data saknas'} · ARR ${stats.arr || 'Data saknas'}.`, rows.length)}
        ${tableCard('Prenumerationer', rows, renderMembershipRow, 'Inga medlemskap hittades i Supabase ännu.', filterButtons('memberships', membershipStatuses))}
      </section>
    `;
  }

  function renderUsers() {
    const rows = list('users');
    content.innerHTML = `
      <section class="admin-section">
        ${sectionIntro('Användare', 'Kundprofil med medlemskap, orderhistorik, checkout och supportkopplingar.', rows.length)}
        ${tableCard('Kunder', rows, renderUserRow, 'Inga användare hittades.')}
      </section>
    `;
  }

  function renderSupport() {
    const rows = filterRows(list('support'), 'support', supportStatuses);
    content.innerHTML = `
      <section class="admin-section">
        ${sectionIntro('Support', 'Ärenden, status, kundinfo och emailsvar via Resend.', rows.length)}
        ${tableCard('Supportärenden', rows, renderSupportRow, 'Supporttabellen saknas eller inga ärenden finns ännu.', filterButtons('support', supportStatuses))}
      </section>
    `;
  }

  function renderReturns() {
    const rows = list('support').filter((ticket) => String(ticket.category || '').toLowerCase().includes('retur') || String(ticket.status || '').toLowerCase().includes('return'));
    content.innerHTML = `
      <section class="admin-section">
        ${sectionIntro('Returer', 'Returärenden filtrerade från supportflödet.', rows.length)}
        ${tableCard('Returer och reklamationer', rows, renderSupportRow, 'Inga returärenden hittades.')}
      </section>
    `;
  }

  function renderSettings() {
    const settings = state.data && state.data.settings ? state.data.settings : {};
    const groups = [
      ['Orderstatusar', settings.orderStatuses || []],
      ['Email templates', settings.emailTemplates || []],
      ['Supportkategorier', settings.supportCategories || []],
      ['Skyddade actions', ['återbetalning kräver bekräftelse', 'radering kräver bekräftelse', 'massmail ej aktiverat']],
      ['Checkout reminders', ['Resend action aktiv', 'abandoned_checkouts-tabell för kontaktstatus']],
      ['Frakt/medlemskap', ['Visas när backend-tabeller finns']],
    ];
    content.innerHTML = `
      <section class="admin-section">
        ${sectionIntro('Inställningar', 'Visar det projektet stödjer utan farliga oskyddade actions.', undefined)}
        <div class="admin-settings-grid">
          ${groups.map(([title, items]) => `
            <article class="admin-settings-card">
              <h3>${escapeHtml(title)}</h3>
              <ul>${items.map((item) => `<li><span>${escapeHtml(item)}</span>${badge('server')}</li>`).join('')}</ul>
            </article>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderActivity() {
    const rows = list('activity');
    content.innerHTML = `
      <section class="admin-section">
        ${sectionIntro('Activity log', 'Viktiga admin-actions loggas server-side när Supabase-tabellen finns.', rows.length)}
        ${tableCard('Loggar', rows, (row) => `
          <div class="admin-row">
            <div><strong>${escapeHtml(row.action || 'action')}</strong><small>${compactDate(row.created_at)}</small></div>
            <span>${escapeHtml(row.message || '')}</span>
            <span>${escapeHtml(row.target_type || '')} ${escapeHtml(row.target_id || '')}</span>
            <button class="admin-action" type="button" disabled>Logg</button>
          </div>
        `, 'Inga activity-loggar ännu.')}
      </section>
    `;
  }

  function renderEmails() {
    const rows = list('emails');
    content.innerHTML = `
      <section class="admin-section">
        ${sectionIntro('Email / Notiser', 'Status från Resend-loggar i Supabase.', rows.length)}
        ${tableCard('Emailhistorik', rows, (row) => `
          <div class="admin-row">
            <div><strong>${escapeHtml(row.type || 'email')}</strong><small>${compactDate(row.created_at)}</small></div>
            <span>${escapeHtml(row.resend_email_id || 'Resend-id saknas')}</span>
            <span>${badge(row.status || 'okänd')}</span>
            <button class="admin-action" type="button" disabled>Email</button>
          </div>
        `, 'Inga email-loggar ännu.')}
      </section>
    `;
  }

  function render() {
    if (!content || !state.data) return;
    const renderers = {
      dashboard: renderDashboard,
      orders: renderOrders,
      checkouts: renderCheckouts,
      memberships: renderMemberships,
      users: renderUsers,
      support: renderSupport,
      returns: renderReturns,
      settings: renderSettings,
      activity: renderActivity,
      emails: renderEmails,
    };
    (renderers[state.view] || renderDashboard)();
  }

  function openDrawer(html) {
    if (!drawer || !drawerContent) return;
    drawerContent.innerHTML = html;
    drawer.hidden = false;
  }

  function closeDrawer() {
    if (drawer) drawer.hidden = true;
  }

  function detailValue(label, value) {
    return `<div class="admin-detail-card"><span class="admin-mini-label">${escapeHtml(label)}</span><p class="admin-meta">${escapeHtml(value || 'Saknas')}</p></div>`;
  }

  function orderFlowSteps(order) {
    const status = String(order.orderStatus || order.fulfillmentStatus || '').toLowerCase();
    return [
      ['betald', 'Betald', true],
      ['väntar på packning', 'Väntar packning', /(väntar|pending|open|unfulfilled|paid|pack)/.test(status)],
      ['packas', 'Packas', /(packas|packing)/.test(status)],
      ['skickad', 'Skickad', /(skickad|shipped|fulfilled|delivered)/.test(status)],
      ['levererad', 'Levererad', /(levererad|delivered)/.test(status)],
    ];
  }

  function openOrder(id) {
    const order = list('orders').find((item) => item.id === id);
    if (!order) return;
    const flow = orderFlowSteps(order);
    const sourceCopy = order.source === 'shopify'
      ? 'Shopify-order visas här för överblick. Statusändringar i denna panel loggas i Versen och synkar fullt när ordern finns i Supabase.'
      : 'Det här är Versens orderflöde. Hantera packning, tracking, statusmail och intern logg här.';
    const address = order.shippingAddress || {};
    const addressText = [
      address.name || [address.first_name, address.firstName, address.last_name, address.lastName].filter(Boolean).join(' '),
      address.address1,
      address.address2,
      address.zip || address.postalCode,
      address.city,
      address.country,
    ].filter(Boolean).join(', ');
    openDrawer(`
      <div class="admin-detail admin-order-detail">
        <div class="admin-order-hero">
          <div>
            <span class="admin-kicker">${escapeHtml(order.source || 'order')}</span>
            <h2>${escapeHtml(order.name || order.id)}</h2>
            <p class="admin-meta">${escapeHtml(order.email || '')} · ${compactDate(order.createdAt)}</p>
          </div>
          <div class="admin-order-hero-status">
            ${badge(order.paymentStatus || 'payment')}
            ${badge(order.orderStatus || 'status')}
          </div>
        </div>
        <div class="admin-workflow">
          ${flow.map(([value, label, active]) => `<button type="button" class="${active ? 'active' : ''}" data-set-order-status="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join('')}
        </div>
        <div class="admin-order-note">${escapeHtml(sourceCopy)}</div>
        <div class="admin-order-summary">
          <article><span>Total</span><strong>${escapeHtml(order.total || 'Saknas')}</strong></article>
          <article><span>Status</span><strong>${badge(order.orderStatus || 'Saknas')}</strong></article>
          <article><span>Betalning</span><strong>${badge(order.paymentStatus || 'Saknas')}</strong></article>
          <article><span>Medlem</span><strong>${escapeHtml(order.membershipStatus || 'Okänt')}</strong></article>
        </div>
        <section class="admin-order-panel admin-order-products">
          <div class="admin-section-title">
            <h3>Produkter</h3>
            <span>${escapeHtml(String((order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)))} st</span>
          </div>
          ${(order.items || []).length ? order.items.map((item) => `
            <div class="admin-line-item admin-product-line">
              <span><strong>${escapeHtml(item.title)}</strong><small>SKU ${escapeHtml(item.sku || 'saknas')} · ${escapeHtml(item.quantity)} st</small></span>
              <strong>${escapeHtml(item.total || item.unitPrice || '')}</strong>
            </div>
          `).join('') : '<p class="admin-meta">Produkter saknas.</p>'}
        </section>
        <section class="admin-order-panel admin-fulfillment-panel">
          <div class="admin-section-title">
            <h3>Orderhantering</h3>
            <span>${escapeHtml(order.source || '')}</span>
          </div>
          <div class="admin-form-grid">
            <div class="admin-field"><label>Nästa status</label><select data-order-status>${orderStatuses.filter((item) => item !== 'alla').map((status) => `<option value="${escapeHtml(status)}" ${String(status).toLowerCase() === String(order.orderStatus || '').toLowerCase() ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}</select></div>
            <div class="admin-field"><label>Trackingnummer</label><input data-order-tracking-number value="${escapeHtml(order.trackingNumber || '')}" placeholder="t.ex. 0034..."></div>
            <div class="admin-field"><label>Trackinglänk</label><input data-order-tracking-url value="${escapeHtml(order.trackingUrl || '')}" placeholder="https://..."></div>
            <div class="admin-action-row">
              <button class="admin-action" type="button" data-set-order-status="packas">Markera packas</button>
              <button class="admin-action" type="button" data-set-order-status="skickad">Markera skickad</button>
              <button class="admin-action danger" type="button" data-update-order="${escapeHtml(order.id)}">Spara och maila kund</button>
            </div>
          </div>
        </section>
        <section class="admin-order-panel admin-customer-card">
          <div class="admin-section-title"><h3>Kund & leverans</h3></div>
          <div class="admin-detail-grid">
            ${detailValue('Kund', order.customerName || order.email)}
            ${detailValue('Email', order.email)}
            ${detailValue('Telefon', order.phone)}
            ${detailValue('Leveransadress', addressText)}
            ${detailValue('Tracking', [order.trackingNumber, order.trackingUrl].filter(Boolean).join(' · '))}
          </div>
        </section>
        <section class="admin-order-panel">
          <h3>Intern timeline</h3>
          <ul class="admin-timeline">${(order.timeline || []).map((event) => `<li><span>${escapeHtml(event.label)}</span><small>${compactDate(event.at)}</small></li>`).join('')}</ul>
        </section>
      </div>
    `);
  }

  function openCheckout(id) {
    const checkout = list('checkouts').find((item) => item.id === id);
    if (!checkout) return;
    openDrawer(`
      <div class="admin-detail">
        <div>
          <span class="admin-kicker">${escapeHtml(checkout.source)}</span>
          <h2>${escapeHtml(checkout.name || checkout.email || checkout.id)}</h2>
          <p class="admin-meta">${escapeHtml(checkout.email || '')} · senaste aktivitet ${compactDate(checkout.latestActivity)}</p>
        </div>
        <div class="admin-detail-grid">
          ${detailValue('Cart value', checkout.cartValue)}
          ${detailValue('Medlem', checkout.member ? 'Ja' : 'Nej/okänt')}
          ${detailValue('Status', checkout.status)}
          ${detailValue('Kontaktad', checkout.contacted ? 'Ja' : 'Nej')}
        </div>
        <section class="admin-detail-card">
          <h3>Varukorg</h3>
          ${(checkout.products || []).length ? checkout.products.map((item) => `
            <div class="admin-line-item"><span>${escapeHtml(item.quantity)} x ${escapeHtml(item.title)}</span><strong>${escapeHtml(item.price || '')}</strong></div>
          `).join('') : '<p class="admin-meta">Produkter saknas.</p>'}
        </section>
        <section class="admin-detail-card">
          <h3>Actions</h3>
          <div class="admin-form-grid">
            <button class="admin-action" type="button" data-send-checkout-reminder="${escapeHtml(checkout.id)}" data-email="${escapeHtml(checkout.email || '')}">Skicka påminnelse</button>
            <button class="admin-action" type="button" data-copy-email="${escapeHtml(checkout.email || '')}">Kopiera email</button>
            <button class="admin-action" type="button" data-open-user="${escapeHtml(checkout.email || checkout.userId)}">Öppna användare</button>
            <button class="admin-action danger" type="button" data-mark-checkout-contacted="${escapeHtml(checkout.id)}">Markera som kontaktad</button>
          </div>
        </section>
      </div>
    `);
  }

  function openUser(key) {
    const normalized = String(key || '').toLowerCase();
    const user = list('users').find((item) => String(item.email || item.id).toLowerCase() === normalized);
    if (!user) return;
    openDrawer(`
      <div class="admin-detail">
        <div>
          <span class="admin-kicker">${escapeHtml(user.source || 'kund')}</span>
          <h2>${escapeHtml(user.name || user.email)}</h2>
          <p class="admin-meta">${escapeHtml(user.email || '')} · ${escapeHtml(user.phone || 'telefon saknas')}</p>
        </div>
        <div class="admin-detail-grid">
          ${detailValue('Medlemsstatus', user.membershipStatus)}
          ${detailValue('Orders', user.numberOfOrders)}
          ${detailValue('Spend', user.amountSpent)}
          ${detailValue('Profil-id', user.profileId || user.id)}
        </div>
        ${miniList('Orderhistorik', user.orders, (order) => `${order.name || order.id} · ${order.total || ''}`)}
        ${miniList('Checkout-historik', user.checkouts, (checkout) => `${checkout.id} · ${checkout.cartValue || ''}`)}
        ${miniList('Supportärenden', user.supportTickets, (ticket) => `${ticket.subject || ticket.id} · ${ticket.status || ''}`)}
      </div>
    `);
  }

  function miniList(title, rows, format) {
    return `
      <section class="admin-detail-card">
        <h3>${escapeHtml(title)}</h3>
        ${(rows || []).length ? rows.map((row) => `<div class="admin-line-item"><span>${escapeHtml(format(row))}</span><small>${compactDate(row.createdAt || row.updatedAt)}</small></div>`).join('') : '<p class="admin-meta">Ingen data kopplad ännu.</p>'}
      </section>
    `;
  }

  function openMembership(id) {
    const item = list('subscriptions').find((subscription) => String(subscription.id) === String(id));
    if (!item) return;
    openDrawer(`
      <div class="admin-detail">
        <div>
          <span class="admin-kicker">Medlemskap</span>
          <h2>${escapeHtml(item.email || item.stripeSubscriptionId || item.id)}</h2>
          <p class="admin-meta">${escapeHtml(item.customerName || item.userId || '')}</p>
        </div>
        <div class="admin-detail-grid">
          ${detailValue('Status', item.status)}
          ${detailValue('Stripe subscription', item.stripeSubscriptionId)}
          ${detailValue('Period start', compactDate(item.currentPeriodStart))}
          ${detailValue('Period end', compactDate(item.currentPeriodEnd))}
          ${detailValue('Avslutas', item.cancelAtPeriodEnd ? 'Ja' : 'Nej')}
        </div>
      </div>
    `);
  }

  function openSupport(id) {
    const ticket = list('support').find((item) => String(item.id) === String(id));
    if (!ticket) return;
    openDrawer(`
      <div class="admin-detail">
        <div>
          <span class="admin-kicker">${escapeHtml(ticket.category || 'support')}</span>
          <h2>${escapeHtml(ticket.subject || ticket.id)}</h2>
          <p class="admin-meta">${escapeHtml(ticket.email || '')} · ${compactDate(ticket.updatedAt || ticket.createdAt)}</p>
        </div>
        <div class="admin-detail-grid">
          ${detailValue('Status', ticket.status)}
          ${detailValue('Prioritet', ticket.priority)}
          ${detailValue('Order', ticket.orderId)}
          ${detailValue('Kund', ticket.userId)}
        </div>
        <section class="admin-detail-card">
          <h3>Meddelandehistorik</h3>
          ${ticket.message ? `<p class="admin-meta">${escapeHtml(ticket.message)}</p>` : ''}
          ${(ticket.messages || []).length ? ticket.messages.map((message) => `<div class="admin-line-item"><span>${escapeHtml(message.body || message.message || '')}</span><small>${compactDate(message.created_at || message.at)}</small></div>`).join('') : ''}
        </section>
        <section class="admin-detail-card">
          <h3>Svara via email</h3>
          <div class="admin-form-grid">
            <div class="admin-field"><label>Status</label><select data-support-status>${supportStatuses.filter((item) => item !== 'alla').map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('')}</select></div>
            <div class="admin-field"><label>Svar</label><textarea data-support-reply placeholder="Skriv svar till kunden"></textarea></div>
            <button class="admin-action" type="button" data-send-support-reply="${escapeHtml(ticket.id)}" data-email="${escapeHtml(ticket.email || '')}">Skicka svar</button>
            <button class="admin-action danger" type="button" data-update-support="${escapeHtml(ticket.id)}">Ändra status</button>
          </div>
        </section>
      </div>
    `);
  }

  function confirmAction(title, copy) {
    return new Promise((resolve) => {
      if (!confirmModal || !confirmOk) {
        resolve(window.confirm(copy || title));
        return;
      }
      confirmTitle.textContent = title;
      confirmCopy.textContent = copy;
      confirmModal.hidden = false;
      const cleanup = (value) => {
        confirmModal.hidden = true;
        confirmOk.onclick = null;
        document.querySelectorAll('[data-admin-confirm-cancel]').forEach((button) => {
          button.onclick = null;
        });
        resolve(value);
      };
      confirmOk.onclick = () => cleanup(true);
      document.querySelectorAll('[data-admin-confirm-cancel]').forEach((button) => {
        button.onclick = () => cleanup(false);
      });
    });
  }

  async function guardedAction(title, copy, task) {
    const ok = await confirmAction(title, copy);
    if (!ok) return;
    try {
      const result = await task();
      showToast(result.status || 'Åtgärden är klar.');
      await loadDashboard();
    } catch (error) {
      showToast(error.message || 'Åtgärden misslyckades.');
    }
  }

  document.addEventListener('click', async (event) => {
    const jump = event.target.closest('[data-jump-view]');
    if (jump) setView(jump.dataset.jumpView);

    const nav = event.target.closest('[data-admin-view]');
    if (nav) setView(nav.dataset.adminView);

    if (event.target.closest('[data-admin-menu]')) {
      document.body.classList.toggle('admin-sidebar-open');
    }

    if (event.target.closest('[data-admin-drawer-close]')) closeDrawer();

    const filter = event.target.closest('[data-filter-key]');
    if (filter) {
      state.filters[filter.dataset.filterKey] = filter.dataset.filterValue;
      render();
    }

    const orderButton = event.target.closest('[data-open-order]');
    if (orderButton) openOrder(orderButton.dataset.openOrder);

    const checkoutButton = event.target.closest('[data-open-checkout]');
    if (checkoutButton) openCheckout(checkoutButton.dataset.openCheckout);

    const userButton = event.target.closest('[data-open-user]');
    if (userButton) openUser(userButton.dataset.openUser);

    const membershipButton = event.target.closest('[data-open-membership]');
    if (membershipButton) openMembership(membershipButton.dataset.openMembership);

    const supportButton = event.target.closest('[data-open-support]');
    if (supportButton) openSupport(supportButton.dataset.openSupport);

    const copyEmail = event.target.closest('[data-copy-email]');
    if (copyEmail) {
      await navigator.clipboard.writeText(copyEmail.dataset.copyEmail || '');
      showToast('Email kopierad.');
    }

    const reminder = event.target.closest('[data-send-checkout-reminder]');
    if (reminder) {
      await guardedAction('Skicka påminnelse?', 'Kunden får ett Resend-mail om att slutföra checkout.', () => postJson('/api/admin-members', {
        action: 'send_checkout_reminder',
        checkoutId: reminder.dataset.sendCheckoutReminder,
        email: reminder.dataset.email,
      }));
    }

    const contacted = event.target.closest('[data-mark-checkout-contacted]');
    if (contacted) {
      await guardedAction('Markera kontaktad?', 'Detta loggas i activity och uppdaterar abandoned_checkouts om tabellen finns.', () => postJson('/api/admin-members', {
        action: 'mark_checkout_contacted',
        checkoutId: contacted.dataset.markCheckoutContacted,
      }));
    }

    const updateOrder = event.target.closest('[data-update-order]');
    if (updateOrder) {
      const panel = updateOrder.closest('.admin-order-panel, .admin-detail-card');
      if (!panel) {
        showToast('Orderpanelen kunde inte läsas. Ladda om admin och försök igen.');
        return;
      }
      await guardedAction('Ändra orderstatus?', 'Statusändringen påverkar orderflödet och loggas.', () => postJson('/api/admin-members', {
        action: 'update_order_status',
        orderId: updateOrder.dataset.updateOrder,
        orderStatus: panel.querySelector('[data-order-status]').value,
        trackingNumber: panel.querySelector('[data-order-tracking-number]').value,
        trackingUrl: panel.querySelector('[data-order-tracking-url]').value,
        sendEmail: true,
      }));
    }

    const quickOrderStatus = event.target.closest('[data-set-order-status]');
    if (quickOrderStatus) {
      const detail = quickOrderStatus.closest('.admin-order-detail');
      const select = detail && detail.querySelector('[data-order-status]');
      if (select) {
        select.value = quickOrderStatus.dataset.setOrderStatus;
        detail.querySelectorAll('[data-set-order-status]').forEach((button) => button.classList.toggle('active', button === quickOrderStatus));
      }
    }

    const updateSupport = event.target.closest('[data-update-support]');
    if (updateSupport) {
      const panel = updateSupport.closest('.admin-detail-card');
      await guardedAction('Ändra supportstatus?', 'Ärendet uppdateras och action loggas.', () => postJson('/api/admin-members', {
        action: 'update_support_status',
        ticketId: updateSupport.dataset.updateSupport,
        status: panel.querySelector('[data-support-status]').value,
      }));
    }

    const supportReply = event.target.closest('[data-send-support-reply]');
    if (supportReply) {
      const panel = supportReply.closest('.admin-detail-card');
      await guardedAction('Skicka supportsvar?', 'Kunden får ett email via Resend.', () => postJson('/api/admin-members', {
        action: 'send_support_reply',
        ticketId: supportReply.dataset.sendSupportReply,
        email: supportReply.dataset.email,
        message: panel.querySelector('[data-support-reply]').value,
      }));
    }
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    if (loginMessage) loginMessage.textContent = 'Kontrollerar server-session...';
    try {
      await postJson('/api/admin-members', {
        action: 'login',
        code: formData.get('code'),
      });
      loginForm.reset();
      setShell(true);
      await loadDashboard();
      showToast('Admin-session aktiv.');
    } catch (error) {
      if (loginMessage) loginMessage.textContent = error.message || 'Kunde inte logga in.';
    }
  });

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(searchForm);
    state.query = String(formData.get('q') || '').trim();
    await loadDashboard();
  });

  document.querySelector('[data-admin-refresh]').addEventListener('click', () => loadDashboard().catch((error) => showToast(error.message)));

  document.querySelector('[data-admin-logout]').addEventListener('click', async () => {
    await postJson('/api/admin-members', { action: 'logout' }).catch(() => null);
    state.data = null;
    setShell(false);
  });

  getJson('/api/admin-members?mode=session')
    .then((session) => {
      setShell(Boolean(session.authenticated));
      if (session.authenticated) {
        return loadDashboard();
      }
      return null;
    })
    .catch(() => {
      setShell(false);
    });
}());
