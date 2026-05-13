const CART_KEY = 'versenCart';
const DISCOUNT_KEY = 'versenDiscountCode';
const CHECKOUT_KEY = 'versenCheckoutPending';
const CHECKOUT_DRAFT_KEY = 'versenCheckoutDraft';
const LAST_ORDER_KEY = 'versenLastOrder';
const MEMBERSHIP_RETURN_KEY = 'versenMembershipReturn';
const MEMBERSHIP_REVEAL_KEY = 'versenMembershipRevealSeen';
const LAUNCH_GATE_KEY = 'versenLaunchAccess';
const POINTS_INTRO_KEY = 'versenPointsIntroSeen';
const THEME_KEY = 'versenThemePreference';
const LIKED_KEY = 'versenLikedProducts';
const LAUNCH_OPEN_AT = new Date('2026-04-30T00:00:00+02:00').getTime();
const LAUNCH_GATE_CODE = '6363';
let accountSession = null;
let catalogSort = 'brand';
let memberLiveProducts = [];
let memberLiveTimer = null;
const pageParams = new URLSearchParams(window.location.search);
const accountNext = pageParams.get('next') || '';

function normalizedRoutePath(pathname = window.location.pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const legacyRoutes = {
    '/index.html': '/',
    '/produkter.html': '/produkter',
    '/produkt.html': '/produkt',
    '/kundkorg.html': '/kundvagn',
    '/checkout.html': '/checkout',
    '/konto.html': '/konto',
    '/medlemskap.html': '/medlemskap',
    '/medlemskap-aktivt.html': '/medlemskap-aktivt',
    '/drops.html': '/drops',
    '/gillar.html': '/gillar',
    '/forslag.html': '/forslag',
    '/installningar.html': '/installningar',
    '/uppdatera-betalning.html': '/uppdatera-betalning',
    '/order.html': '/order',
    '/villkor.html': '/villkor',
    '/integritet.html': '/integritet',
    '/returer.html': '/returer',
    '/faq.html': '/faq',
    '/kontakt.html': '/kontakt',
    '/snart.html': '/snart',
    '/admin.html': '/admin',
    '/gross-kontrollrum.html': '/gross-kontrollrum',
  };

  return legacyRoutes[path] || path;
}

const currentRoutePath = normalizedRoutePath();
const isAccountPage = currentRoutePath === '/konto';
const accountCheckoutIntent = accountNext === 'checkout' || pageParams.get('return') === 'checkout';
const verificationToken = pageParams.get('verify') || '';
const resetToken = pageParams.get('reset') || '';
const isLaunchPage = currentRoutePath === '/snart';
let catalogProducts = [];
let selectedCatalogCategory = null;
let likedSyncTimer = null;

function getThemePreference() {
  const saved = localStorage.getItem(THEME_KEY);
  return ['auto', 'light', 'dark'].includes(saved) ? saved : 'light';
}

function resolveTheme(preference = getThemePreference()) {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(preference = getThemePreference()) {
  const theme = resolveTheme(preference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#050609' : '#f5f3ed');

  document.querySelectorAll('[data-theme-option]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themeOption === preference);
  });
}

function setThemePreference(preference) {
  const next = ['auto', 'light', 'dark'].includes(preference) ? preference : 'auto';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);

  postJson('/api/account', {
    action: 'save_preferences',
    theme: next,
  }).catch(() => {});
}

applyTheme();

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePreference() === 'auto') {
      applyTheme('auto');
    }
  });
}

function isLaunchOpen() {
  return Date.now() >= LAUNCH_OPEN_AT;
}

if (!isLaunchPage && !isLaunchOpen() && localStorage.getItem(LAUNCH_GATE_KEY) !== '1') {
  const currentPage = `${window.location.pathname || '/'}${window.location.search}${window.location.hash}`;
  window.location.replace(`/snart?next=${encodeURIComponent(currentPage)}`);
}

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

function renderLuxuryMenu() {
  const menu = document.querySelector('.menu');
  if (!menu) return;

  const path = normalizedRoutePath();
  const authenticated = Boolean(accountSession && accountSession.authenticated);
  const member = isActiveMember();
  const links = [
    { href: '/produkter', label: 'Handla', match: ['/produkter', '/produkt'] },
    member ? null : { href: '/medlemskap', label: 'Medlemskap', match: ['/medlemskap', '/medlemskap-aktivt'] },
    { href: '/konto', label: authenticated ? 'Mitt konto' : 'Konto', match: ['/konto', '/installningar', '/order'] },
    { href: '/kundvagn', label: 'Kundvagn', match: ['/kundvagn', '/checkout'], cart: true },
    { href: '/forslag', label: 'Föreslå drop', match: ['/forslag'], featured: true },
  ].filter(Boolean);

  menu.innerHTML = `
    <div class="menu-link-stack">
      ${links.map((link) => {
        const isActive = link.match.includes(path);
        const classes = [isActive ? 'active' : '', link.featured ? 'suggest-drop-link' : ''].filter(Boolean).join(' ');
        return `<a class="${classes}" href="${link.href}">${link.label}${link.cart ? '<span data-cart-count></span>' : ''}</a>`;
      }).join('')}
    </div>
  `;

  document.querySelector('.luxury-menu-overlay')?.remove();
  const overlay = document.createElement('aside');
  overlay.className = 'luxury-menu-overlay';
  overlay.setAttribute('aria-label', 'Mobil meny');
  overlay.innerHTML = `
    <div class="luxury-menu-shell">
      <div class="luxury-menu-links">
        ${links.map((link) => {
          const isActive = link.match.includes(path);
          const classes = [isActive ? 'active' : '', link.featured ? 'suggest-drop-link' : ''].filter(Boolean).join(' ');
          return `<a class="${classes}" href="${link.href}"><span>${link.label}${link.cart ? '<span data-cart-count></span>' : ''}</span></a>`;
        }).join('')}
      </div>
      <div class="luxury-menu-footer" aria-label="Snabbval">
        <a class="luxury-menu-utility luxury-menu-login" href="/konto"><svg class="luxury-menu-utility-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19.2c1.2-3.1 3.4-4.7 6.5-4.7s5.3 1.6 6.5 4.7"/></svg>${authenticated ? 'Mitt konto' : 'Logga in'}</a>
        <a class="luxury-menu-utility luxury-menu-support" href="/kontakt">Kundtjänst</a>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

renderLuxuryMenu();

document.querySelectorAll('.top-strip span').forEach((item, index) => {
  const copy = ['1-3 dagars leverans', 'Utvalda produkter varje vecka', 'Nya drops varje torsdag'][index];
  if (copy) item.textContent = copy;
});

document.querySelectorAll('.nav-mobile-menu[aria-label="Tillbaka"], [data-back-button]').forEach((button) => {
  button.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/produkter';
    }
  });
});

function setMobileMenuOpen(isOpen) {
  document.documentElement.classList.toggle('mobile-menu-open', isOpen);
  document.body.classList.toggle('mobile-menu-open', isOpen);
  document.querySelectorAll('.nav-mobile-menu[aria-label="Meny"]').forEach((button) => {
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

document.querySelectorAll('.nav-mobile-menu[aria-label="Meny"]').forEach((button) => {
  button.addEventListener('click', () => {
    const isOpen = !document.body.classList.contains('mobile-menu-open');
    setMobileMenuOpen(isOpen);
    if (isOpen) {
      document.querySelector('.menu')?.scrollTo({ top: 0, left: 0 });
    }
  });
});

document.querySelectorAll('.menu a, .luxury-menu-overlay a').forEach((link) => {
  link.addEventListener('click', () => {
    setMobileMenuOpen(false);
  });
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.menu a, .luxury-menu-overlay a')) {
    return;
  }

  setMobileMenuOpen(false);
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('show');
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.fade').forEach((el) => observer.observe(el));

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeExternalUrl(value) {
  const url = String(value || '').trim();

  if (!url) {
    return '#';
  }

  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function readCart() {
  try {
    const cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(cart) ? cart : [];
  } catch (error) {
    return [];
  }
}

function writeCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
  syncShoppingAccess();
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  localStorage.removeItem(DISCOUNT_KEY);
  updateCartCount();
  renderCart();
  syncShoppingAccess();
}

function cartQuantity(cart = readCart()) {
  return cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

function parsePrice(value) {
  const match = String(value || '').replace(',', '.').match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function formatSek(value) {
  return `${Math.round(value)} kr`;
}

function formatSavingsSek(value) {
  return `-${formatSek(Math.abs(value))}`;
}

function productDiscountAmount(product) {
  const price = parsePrice(product && product.price);
  const compareAtPrice = parsePrice(product && product.compareAtPrice);

  return compareAtPrice > price ? compareAtPrice - price : 0;
}

function productDiscountPercent(product) {
  const price = parsePrice(product && product.price);
  const compareAtPrice = parsePrice(product && product.compareAtPrice);

  if (!price || !compareAtPrice || compareAtPrice <= price) {
    return 0;
  }

  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
}

function cartSavingsAmount(items = readCart()) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const quantity = Math.max(1, Number(item && item.quantity) || 1);
    const price = Number(item && item.unit_price) > 0
      ? Number(item.unit_price) / 100
      : parsePrice(item && item.price);
    const compareAtPrice = Number(item && item.compare_at_price) > 0
      ? Number(item.compare_at_price) / 100
      : parsePrice(item && item.compareAtPrice);

    return compareAtPrice > price ? sum + ((compareAtPrice - price) * quantity) : sum;
  }, 0);
}

function stableNumber(value, min, max) {
  const text = String(value || 'versen');
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }

  return min + (Math.abs(hash) % ((max - min) + 1));
}

function formatDate(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const months = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const currentYear = new Date().getFullYear();
  const base = `${date.getDate()} ${months[date.getMonth()]}`;

  return date.getFullYear() === currentYear ? base : `${base} ${date.getFullYear()}`;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
  });
  const data = await response.json();
  return { response, data };
}

function loadVercelAnalytics() {
  window.va = window.va || function () {
    (window.vaq = window.vaq || []).push(arguments);
  };

  if (document.querySelector('script[src="/_vercel/insights/script.js"]')) {
    return;
  }

  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  document.head.appendChild(script);
}

function getBrowserName(userAgent) {
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/CriOS|Chrome\//.test(userAgent) && !/Edg\//.test(userAgent)) return 'Chrome';
  if (/FxiOS|Firefox\//.test(userAgent)) return 'Firefox';
  if (/Safari\//.test(userAgent) && !/Chrome|CriOS|Android/.test(userAgent)) return 'Safari';
  return 'Unknown';
}

function getOsName(userAgent) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Mac OS X|Macintosh/.test(userAgent)) return 'macOS';
  if (/Windows NT/.test(userAgent)) return 'Windows';
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'Unknown';
}

function getDeviceType(userAgent) {
  if (/iPad|Tablet/.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/.test(userAgent)) return 'mobile';
  return 'desktop';
}

function getIphoneModelGuess(width, height, dpr) {
  const shortSide = Math.min(Number(width) || 0, Number(height) || 0);
  const longSide = Math.max(Number(width) || 0, Number(height) || 0);
  const ratio = Number(dpr) || 1;
  const key = `${shortSide}x${longSide}@${ratio}`;
  const models = {
    '320x568@2': 'iPhone SE 1 / 5s',
    '375x667@2': 'iPhone SE 2/3 / 6/7/8',
    '375x812@3': 'iPhone X/XS/11 Pro eller 12/13 mini',
    '390x844@3': 'iPhone 12/13/14/15-familjen',
    '393x852@3': 'iPhone 14 Pro / 15 / 15 Pro / 16',
    '402x874@3': 'iPhone 16 Pro',
    '414x736@3': 'iPhone 6/7/8 Plus',
    '414x896@2': 'iPhone XR / 11',
    '414x896@3': 'iPhone XS Max / 11 Pro Max',
    '428x926@3': 'iPhone 12/13/14 Plus eller Pro Max',
    '430x932@3': 'iPhone 14/15/16 Plus eller Pro Max',
    '440x956@3': 'iPhone 16 Pro Max',
  };

  return models[key] || '';
}

function getReferrerHost() {
  if (!document.referrer) {
    return '';
  }

  try {
    return new URL(document.referrer).hostname;
  } catch (error) {
    return '';
  }
}

function collectDeviceInfo() {
  const userAgent = navigator.userAgent || '';
  const width = window.screen && window.screen.width;
  const height = window.screen && window.screen.height;
  const dpr = window.devicePixelRatio || 1;
  const os = getOsName(userAgent);

  return {
    path: `${window.location.pathname}${window.location.search.replace(/([?&])(verify|reset|token|email)=[^&]*/gi, '$1$2=redacted')}`,
    referrer: getReferrerHost(),
    title: document.title || '',
    language: navigator.language || '',
    languages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 5) : [],
    platform: navigator.platform || '',
    userAgent,
    brands: navigator.userAgentData && Array.isArray(navigator.userAgentData.brands) ? navigator.userAgentData.brands : [],
    mobileHint: Boolean(navigator.userAgentData && navigator.userAgentData.mobile),
    deviceType: getDeviceType(userAgent),
    os,
    browser: getBrowserName(userAgent),
    screen: {
      width,
      height,
      dpr,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    },
    touch: navigator.maxTouchPoints || 0,
    connection: navigator.connection ? {
      effectiveType: navigator.connection.effectiveType || '',
      saveData: Boolean(navigator.connection.saveData),
    } : null,
    deviceModelGuess: os === 'iOS' && /iPhone/.test(userAgent) ? getIphoneModelGuess(width, height, dpr) : '',
  };
}

let visitLogKey = '';

function logVisit(session = null) {
  const customer = session && session.authenticated && session.customer ? session.customer : null;
  const nextKey = customer ? `customer:${customer.id || customer.email}` : 'anonymous';

  if (visitLogKey === nextKey) {
    return;
  }

  visitLogKey = nextKey;
  const device = collectDeviceInfo();
  const payload = {
    device,
    customer: customer ? {
      id: customer.id || '',
      email: customer.email || '',
      member: Boolean(customer.member),
    } : null,
  };

  if (window.va) {
    window.va('event', 'Device visit', {
      deviceType: device.deviceType,
      os: device.os,
      browser: device.browser,
      model: device.deviceModelGuess || 'unknown',
    });
  }

  fetch('/api/account', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'device_visit',
      ...payload,
    }),
    keepalive: true,
  }).catch(() => {});
}

loadVercelAnalytics();
logVisit();

function updateCartCount() {
  const count = cartQuantity();
  document.querySelectorAll('[data-cart-count]').forEach((element) => {
    element.textContent = count ? String(count) : '';
  });
}

function readLikedProducts() {
  try {
    const liked = JSON.parse(localStorage.getItem(LIKED_KEY) || '[]');
    return Array.isArray(liked) ? liked.filter((item) => item && item.handle) : [];
  } catch (error) {
    return [];
  }
}

function writeLikedProducts(products) {
  const unique = [];
  const seen = new Set();

  products.forEach((product) => {
    if (!product || !product.handle || seen.has(product.handle)) return;
    seen.add(product.handle);
    unique.push(product);
  });

  localStorage.setItem(LIKED_KEY, JSON.stringify(unique));
  updateWishlistButtons();
  renderLikedPage();
  queueLikedSync();
}

function isProductLiked(handle) {
  return readLikedProducts().some((product) => product.handle === handle);
}

function productFromDataset(dataset) {
  return {
    handle: dataset.productHandle || dataset.cartHandle || '',
    title: dataset.productTitle || dataset.cartTitle || '',
    category: dataset.category || dataset.cartCategory || '',
    price: dataset.productPrice || dataset.cartPrice || '',
    compareAtPrice: dataset.productCompareAtPrice || dataset.cartCompareAtPrice || '',
    image: dataset.productImageUrl || dataset.cartImageUrl
      ? {
        url: dataset.productImageUrl || dataset.cartImageUrl,
        altText: dataset.productImageAlt || dataset.cartImageAlt || dataset.productTitle || dataset.cartTitle || '',
      }
      : null,
  };
}

function toggleLikedProduct(product) {
  if (!product || !product.handle) return;

  const liked = readLikedProducts();
  const exists = liked.some((item) => item.handle === product.handle);
  writeLikedProducts(exists
    ? liked.filter((item) => item.handle !== product.handle)
    : [product, ...liked]);
}

function updateWishlistButtons() {
  const liked = new Set(readLikedProducts().map((product) => product.handle));

  document.querySelectorAll('[data-wishlist-toggle]').forEach((button) => {
    const handle = button.dataset.wishlistToggle;
    const active = liked.has(handle);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', active ? 'Ta bort från gillade' : 'Lägg till i gillade');
  });
}

function mergeProfileLikes(session = accountSession) {
  const profileLikes = session
    && session.authenticated
    && session.customer
    && session.customer.preferences
    && Array.isArray(session.customer.preferences.favorites)
    ? session.customer.preferences.favorites
    : [];

  if (!profileLikes.length) {
    return;
  }

  writeLikedProducts([...readLikedProducts(), ...profileLikes]);
}

function queueLikedSync() {
  if (!accountSession || !accountSession.authenticated) return;
  window.clearTimeout(likedSyncTimer);
  likedSyncTimer = window.setTimeout(() => {
    postJson('/api/account', {
      action: 'save_preferences',
      favorites: readLikedProducts(),
    }).catch(() => {});
  }, 400);
}

function isActiveMember(session = accountSession) {
  return Boolean(session && session.authenticated && session.customer && session.customer.member);
}

function readDiscountCode() {
  return localStorage.getItem(DISCOUNT_KEY) || '';
}

function writeDiscountCode(code) {
  const value = String(code || '').trim();

  if (value) {
    localStorage.setItem(DISCOUNT_KEY, value);
  } else {
    localStorage.removeItem(DISCOUNT_KEY);
  }
}

function rememberCheckout(type, checkoutUrl) {
  localStorage.setItem(CHECKOUT_KEY, JSON.stringify({
    type,
    checkoutUrl,
    startedAt: new Date().toISOString(),
  }));
}

function readPendingCheckout() {
  try {
    return JSON.parse(localStorage.getItem(CHECKOUT_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

function clearPendingCheckout() {
  localStorage.removeItem(CHECKOUT_KEY);
}

function rememberMembershipReturn(value) {
  if (value) {
    localStorage.setItem(MEMBERSHIP_RETURN_KEY, JSON.stringify(value));
  }
}

function readMembershipReturn() {
  try {
    return JSON.parse(localStorage.getItem(MEMBERSHIP_RETURN_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

function clearMembershipReturn() {
  localStorage.removeItem(MEMBERSHIP_RETURN_KEY);
}

function membershipReturnTarget() {
  const target = readMembershipReturn();
  if (target && target.type === 'checkout') {
    const step = target.step || 'betalning';
    return `/checkout?step=${encodeURIComponent(step)}`;
  }
  return '/produkter?unlocked=1';
}

if (accountCheckoutIntent) {
  rememberMembershipReturn({
    type: 'checkout',
    step: pageParams.get('step') || 'betalning',
    startedAt: new Date().toISOString(),
  });
} else if (isAccountPage) {
  clearMembershipReturn();
}

function readCheckoutDraft() {
  try {
    return JSON.parse(localStorage.getItem(CHECKOUT_DRAFT_KEY) || '{}') || {};
  } catch (error) {
    return {};
  }
}

function writeCheckoutDraft(next) {
  const draft = {
    ...readCheckoutDraft(),
    ...(next || {}),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(draft));
  return draft;
}

function writeLastOrder(order) {
  if (!order) return;
  localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(order));
}

function readLastOrder() {
  try {
    return JSON.parse(localStorage.getItem(LAST_ORDER_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

const ORDER_STATUS_STEPS = [
  { key: 'received', label: 'Beställning mottagen' },
  { key: 'packing', label: 'Packas' },
  { key: 'shipped', label: 'Skickad' },
  { key: 'delivered', label: 'Levererad' },
];

function normalizedOrderStatus(order) {
  const status = String(
    (order && (order.orderStatus || order.order_status || order.status || order.fulfillmentStatus))
    || ''
  ).toLowerCase();

  if (status.includes('deliver')) return 'delivered';
  if (status.includes('ship') || status.includes('fulfill')) return 'shipped';
  if (status.includes('pack')) return 'packing';
  return 'received';
}

function orderStatusLabel(order) {
  const current = normalizedOrderStatus(order);
  const step = ORDER_STATUS_STEPS.find((item) => item.key === current);

  return step ? step.label : ORDER_STATUS_STEPS[0].label;
}

function renderOrderStatusTrail(order) {
  const current = normalizedOrderStatus(order);
  const activeIndex = Math.max(0, ORDER_STATUS_STEPS.findIndex((step) => step.key === current));

  return `
    <ol class="order-status-trail" aria-label="Orderstatus">
      ${ORDER_STATUS_STEPS.map((step, index) => `
        <li class="${index <= activeIndex ? 'is-complete' : ''} ${index === activeIndex ? 'is-current' : ''}">
          <span aria-hidden="true"></span>
          <strong>${escapeHtml(step.label)}</strong>
        </li>
      `).join('')}
    </ol>
  `;
}

function renderOrderSummaryCard(order, index = 0) {
  const orderDate = formatDate((order && (order.processedAt || order.createdAt || order.created_at)) || '') || '';
  const items = (order && Array.isArray(order.items) ? order.items : [])
    .map((item) => (typeof item === 'string' ? item : `${item.quantity || 1} x ${item.title || item.name || 'Produkt'}`))
    .filter(Boolean);
  const statusUrl = order && (order.statusUrl || order.trackingUrl || order.tracking_url);
  const trackingNumber = order && (order.trackingNumber || order.tracking_number);

  return `
    <article class="order-detail-card">
      <div class="order-detail-topline">
        <span>${index === 0 ? 'Senaste order' : 'Order'}</span>
        <strong>${escapeHtml(orderStatusLabel(order))}</strong>
      </div>
      <div class="order-detail-heading">
        <h2>${escapeHtml((order && (order.name || order.order_number || order.id)) || 'Order')}</h2>
        <p>${escapeHtml(orderDate)}</p>
      </div>
      <div class="order-detail-meta">
        <span>${escapeHtml((order && order.total) || '')}</span>
        ${trackingNumber ? `<span>Spårning ${escapeHtml(trackingNumber)}</span>` : ''}
      </div>
      ${renderOrderStatusTrail(order)}
      ${items.length ? `<p class="order-detail-items">${escapeHtml(items.join(', '))}</p>` : '<p class="order-detail-items">Produkter synkas.</p>'}
      ${statusUrl ? `<a class="order-detail-link" href="${escapeHtml(statusUrl)}" target="_blank" rel="noreferrer">Se orderstatus</a>` : ''}
    </article>
  `;
}

function unlockLaunchGate(destination = '') {
  localStorage.setItem(LAUNCH_GATE_KEY, '1');
  window.location.href = destination || pageParams.get('next') || '/';
}

function prepareCheckoutWindow() {
  const checkoutWindow = window.open('', '_blank');

  if (checkoutWindow) {
    checkoutWindow.document.write('<!doctype html><title>Versen checkout</title><body style="background:#0a0a0a;color:white;font-family:Inter,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0">Öppnar säker checkout...</body>');
  }

  return checkoutWindow;
}

function checkoutReturnUrl(type) {
  const page = type === 'medlemskap'
    ? '/medlemskap-aktivt?checkout=medlemskap'
    : `/order?checkout=${encodeURIComponent(type || 'produkt')}`;
  return new URL(page, window.location.href).href;
}

function addCheckoutReturnParams(checkoutUrl, type) {
  try {
    const url = new URL(checkoutUrl);
    const target = checkoutReturnUrl(type);
    url.searchParams.set('return_url', target);
    url.searchParams.set('return_to', target);
    return url.href;
  } catch (error) {
    return checkoutUrl;
  }
}

function openCheckout(checkoutUrl, type, checkoutWindow = null) {
  const checkoutWithReturn = addCheckoutReturnParams(checkoutUrl, type);
  rememberCheckout(type, checkoutWithReturn);
  const opened = checkoutWindow || window.open('', '_blank');

  if (!opened) {
    window.location.href = checkoutWithReturn;
    return;
  }

  opened.location.href = checkoutWithReturn;
  window.location.href = type === 'medlemskap'
    ? '/medlemskap-aktivt?checkout=medlemskap'
    : `/order?checkout=${encodeURIComponent(type || 'produkt')}`;
}

function applyGlobalSessionUi(session = accountSession) {
  const authenticated = Boolean(session && session.authenticated);
  const member = isActiveMember(session);
  const firstName = authenticated
    ? (session.customer.firstName || (session.customer.displayName || '').split(' ')[0] || '')
    : '';

  document.body.classList.toggle('is-authenticated', authenticated);
  document.body.classList.toggle('is-member', member);
  renderLuxuryMenu();
  renderSuggestionAccess(session);

  document.querySelectorAll('a[href="/medlemskap"], a[href^="/medlemskap?"]').forEach((link) => {
    link.hidden = member;
  });

  document.querySelectorAll('[data-member-home]').forEach((element) => {
    element.hidden = !member;
  });

  setText('[data-member-home-title]', firstName ? `Välkommen tillbaka, ${firstName}` : 'Välkommen tillbaka');
  if (verificationToken) {
    setText('[data-account-hero-title]', 'Skapa lösenord');
    setText('[data-account-hero-copy]', 'Emailen är verifierad. Välj ett lösenord med minst 8 tecken, så skickas du vidare för att starta medlemskapet.');
  } else if (resetToken) {
    setText('[data-account-hero-title]', 'Nytt lösenord');
    setText('[data-account-hero-copy]', 'Välj ett nytt lösenord för ditt konto.');
  } else {
    setText('[data-account-hero-title]', authenticated ? 'Ditt Versen' : 'Skapa konto eller logga in');
    setText(
      '[data-account-hero-copy]',
      authenticated
        ? 'Medlemskap, poäng och orderhistorik samlat på ett ställe.'
        : 'Logga in för att se orderhistorik och spara dina uppgifter.'
    );
  }

  document.querySelectorAll('.menu a[href="/konto"]').forEach((link) => {
    link.textContent = authenticated ? 'Mitt konto' : 'Konto';
  });
}

function syncThemeFromProfile(session = accountSession) {
  const profileTheme = session
    && session.authenticated
    && session.customer
    && session.customer.preferences
    && session.customer.preferences.theme;

  if (!localStorage.getItem(THEME_KEY) && ['auto', 'light', 'dark'].includes(profileTheme)) {
    localStorage.setItem(THEME_KEY, profileTheme);
    applyTheme(profileTheme);
  }
}

function syncShoppingAccess() {
  const member = isActiveMember();
  const cart = readCart();
  const discountInput = document.querySelector('[data-discount-code]');
  const discountFormButton = document.querySelector('[data-discount-form] button');
  const cartStatus = document.querySelector('[data-cart-status]');
  const cartHelp = document.querySelector('[data-cart-help]');
  const membershipCheckout = document.querySelector('[data-membership-checkout]');
  const membershipMessage = document.querySelector('[data-membership-message]');

  document.querySelectorAll('[data-catalog-add]').forEach((button) => {
    button.disabled = false;
    button.textContent = 'Lägg i kundkorg';
  });

  const detailAddButton = document.querySelector('[data-add-to-cart-button]');
  if (detailAddButton) {
    detailAddButton.disabled = false;
    detailAddButton.textContent = 'Lägg i kundkorg';
  }

  const checkoutButton = document.querySelector('[data-cart-checkout]');
  if (checkoutButton) {
    checkoutButton.disabled = !cart.length;
  }

  if (discountInput) {
    discountInput.disabled = !cart.length;
    if (!discountInput.value) discountInput.value = readDiscountCode();
  }

  if (discountFormButton) {
    discountFormButton.disabled = !cart.length;
  }

  if (cartStatus) {
    cartStatus.textContent = cart.length ? 'Redo för checkout' : 'Kundkorgen är tom';
    cartStatus.classList.toggle('is-active', Boolean(cart.length));
  }

  if (cartHelp) {
    cartHelp.textContent = member
      ? 'Fortsätt till Versens checkout med kontakt, leverans och säker kortbetalning.'
      : 'Fortsätt till Versens checkout. Du behöver vara inloggad för att slutföra köpet.';
  }

  if (membershipCheckout) {
    membershipCheckout.hidden = member;
  }

  if (membershipMessage && member) {
    membershipMessage.textContent = 'Du har redan ett aktivt medlemskap. Fortsätt till produkterna.';
  }
}

function adjustAccountScroll(session = accountSession) {
  if (!document.querySelector('[data-account-area]')) {
    return;
  }
}

function addToCart(product, quantity = 1) {
  const cart = readCart();
  const existing = cart.find((item) => item.variantId === product.variantId);
  const nextQuantity = Math.max(1, Number(quantity) || 1);

  if (existing) {
    existing.quantity += nextQuantity;
  } else {
    cart.push({
      variantId: product.variantId,
      handle: product.handle,
      title: product.title,
      category: product.category,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      image: product.image,
      quantity: nextQuantity,
    });
  }

  writeCart(cart);
}

function setCartQuantity(variantId, quantity) {
  const nextQuantity = Number(quantity);
  const cart = readCart()
    .map((item) => (
      item.variantId === variantId
        ? { ...item, quantity: Math.max(1, nextQuantity || 1) }
        : item
    ));

  writeCart(cart);
  renderCart();
}

function removeCartItem(variantId) {
  writeCart(readCart().filter((item) => item.variantId !== variantId));
  renderCart();
}

const filters = document.querySelectorAll('[data-filter]');

filters.forEach((filter) => {
  filter.addEventListener('click', () => {
    selectCatalogCategory(filter.dataset.filter, { scroll: false });
  });
});

document.querySelectorAll('.sort-pill').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.sort-pill').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    catalogSort = button.dataset.sort || 'brand';
    renderCatalogProducts(selectedCatalogCategory);
  });
});

function productCard(product) {
  const image = product.image && product.image.url
    ? `<img src="${escapeHtml(product.image.url)}" alt="${escapeHtml(product.image.altText || product.title)}">`
    : `<img src="assets/hero-studio/snabbforsegling-tershine-amplify-500-ml.png" alt="${escapeHtml(product.title || 'Versen produkt')}">`;

  const compareAtPrice = product.compareAtPrice || product.price || '';
  const memberPrice = product.price || 'Pris kommer';
  const productUrl = `/produkt?handle=${encodeURIComponent(product.handle)}`;
  const variantText = product.variants && product.variants.length > 1
    ? `<span>${product.variants.length} val</span>`
    : '';
  const vendor = product.vendor || product.category || 'Versen';
  const flags = product.flags || {};
  const discount = productDiscountAmount(product);
  const discountPercent = productDiscountPercent(product);
  const badges = [
    flags.greatPrice || discountPercent >= 18 ? '<span class="great-price">Utvald</span>' : '',
    flags.fewLeft ? '<span class="few-left">Få kvar</span>' : '',
  ].filter(Boolean).join('');
  const liked = isProductLiked(product.handle);

  return `
    <article class="product-card ${flags.greatPrice ? 'has-great-price' : ''} ${flags.fewLeft ? 'has-few-left' : ''}" role="link" tabindex="0" data-product-url="${escapeHtml(productUrl)}" data-category="${escapeHtml(product.category)}" data-product-handle="${escapeHtml(product.handle)}" data-variant-id="${escapeHtml(product.variantId || '')}" data-product-title="${escapeHtml(product.title)}" data-product-price="${escapeHtml(memberPrice)}" data-product-compare-at-price="${escapeHtml(compareAtPrice)}" data-product-image-url="${escapeHtml(product.image && product.image.url ? product.image.url : '')}" data-product-image-alt="${escapeHtml(product.image && product.image.altText ? product.image.altText : product.title)}">
      <div class="product-image">
        ${badges ? `<div class="product-badges">${badges}</div>` : ''}
        ${image}
        <button class="product-quick-add" type="button" data-catalog-add aria-label="Lägg ${escapeHtml(product.title)} i kundkorg">+</button>
      </div>
      <button class="product-wishlist-button ${liked ? 'active' : ''}" type="button" data-wishlist-toggle="${escapeHtml(product.handle)}" aria-pressed="${liked ? 'true' : 'false'}" aria-label="${liked ? 'Ta bort från gillade' : 'Lägg till i gillade'}"></button>
      <div class="product-info">
        <div class="product-card-meta">
          <div class="product-category">${escapeHtml(vendor)}</div>
          ${variantText}
        </div>
        <h3>${escapeHtml(product.title)}</h3>
        <div class="product-prices">
          <span class="old">${escapeHtml(compareAtPrice)}</span>
          <span class="new">${escapeHtml(memberPrice)}</span>
        </div>
        ${discount ? `<div class="product-saving">Du sparar ${escapeHtml(formatSavingsSek(discount))}${discountPercent ? ` (${discountPercent}%)` : ''}</div>` : ''}
        <div class="product-actions">
          <a class="product-btn secondary" href="${escapeHtml(productUrl)}">Detaljer</a>
          <button class="product-btn" type="button" data-catalog-add>Lägg i kundkorg</button>
        </div>
      </div>
    </article>
  `;
}

function liveProductCard(product, index = 0) {
  const viewers = randomInt(3, 11);
  const image = product.image && product.image.url
    ? `<img src="${escapeHtml(product.image.url)}" alt="${escapeHtml(product.image.altText || product.title)}">`
    : '';
  const vendor = product.vendor || product.category || 'Versen';
  const memberPrice = product.price || 'Medlemspris';
  const compareAtPrice = product.compareAtPrice && product.compareAtPrice !== product.price ? product.compareAtPrice : '';
  const flags = product.flags || {};
  const badges = [
    flags.greatPrice ? '<span class="great-price">Grymt pris</span>' : '',
    flags.fewLeft ? '<span class="few-left">Få kvar</span>' : '',
  ].filter(Boolean).join('');

  return `
    <article class="live-product-card ${flags.greatPrice ? 'has-great-price' : ''}">
      <div class="live-product-top">
        <div class="live-viewers">${viewers} personer tittar på denna just nu</div>
        ${badges ? `<div class="live-product-badges">${badges}</div>` : ''}
      </div>
      <div class="live-product-image">${image}</div>
      <div class="live-product-info">
        <small>${escapeHtml(vendor)}</small>
        <strong>${escapeHtml(product.title)}</strong>
        <div class="live-product-prices">
          ${compareAtPrice ? `<span class="old">${escapeHtml(compareAtPrice)}</span>` : ''}
          <span class="new">${escapeHtml(memberPrice)}</span>
        </div>
      </div>
    </article>
  `;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandomProducts(products, count = 3) {
  return [...products]
    .sort(() => Math.random() - 0.5)
    .slice(0, count);
}

function topDiscountProducts(products, count = 4) {
  return [...products]
    .filter((product) => product.handle !== 'medlemskap' && product.image && product.image.url && productDiscountAmount(product) > 0)
    .sort((a, b) => (
      productDiscountPercent(b) - productDiscountPercent(a)
      || productDiscountAmount(b) - productDiscountAmount(a)
    ))
    .slice(0, count);
}

function addUniqueProduct(target, product, used) {
  if (!product || used.has(product.handle)) {
    return false;
  }

  used.add(product.handle);
  target.push(product);
  return true;
}

function homeDealTeaserCard(products) {
  const picks = products.slice(0, 3);
  const primary = picks[0];

  if (!primary) {
    return '';
  }

  return `
    <div class="home-featured-product" aria-label="Veckans utvalda produkter">
      <div class="home-featured-stack">
        ${picks.map((product, index) => {
          const discount = productDiscountPercent(product);
          const productUrl = `/produkt?handle=${encodeURIComponent(product.handle)}`;

          return `
            <a class="home-featured-item item-${index + 1}" href="${escapeHtml(productUrl)}" aria-label="${escapeHtml(product.title)}">
              <span class="home-featured-badge">${discount ? `-${discount}%` : 'Deal'}</span>
              <span class="home-featured-image">
                <img src="${escapeHtml(product.image.url)}" alt="${escapeHtml(product.image.altText || product.title)}">
              </span>
              <span class="home-featured-panel">
                <small>${escapeHtml(product.vendor || product.category || 'Versen')}</small>
                <strong>${escapeHtml(product.title)}</strong>
                <span class="home-featured-prices">
                  <em>${escapeHtml(product.price || 'Medlemspris')}</em>
                  ${product.compareAtPrice ? `<del>${escapeHtml(product.compareAtPrice)}</del>` : ''}
                </span>
                ${productDiscountAmount(product) ? `<span class="home-featured-saving">Du sparar ${escapeHtml(formatSavingsSek(productDiscountAmount(product)))}</span>` : ''}
              </span>
            </a>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function homeTrendingCard(product) {
  const productUrl = `/produkt?handle=${encodeURIComponent(product.handle)}`;
  const image = product.image && product.image.url
    ? `<img src="${escapeHtml(product.image.url)}" alt="${escapeHtml(product.image.altText || product.title)}">`
    : `<img src="assets/hero-studio/snabbforsegling-tershine-amplify-500-ml.png" alt="${escapeHtml(product.title || 'Versen produkt')}">`;
  const compareAtPrice = product.compareAtPrice && product.compareAtPrice !== product.price ? product.compareAtPrice : '';
  const discount = productDiscountPercent(product);
  const saving = productDiscountAmount(product);
  const vendor = product.vendor || product.category || 'Versen';

  return `
    <article class="home-trending-card" data-category="${escapeHtml(product.category || '')}" data-product-handle="${escapeHtml(product.handle || '')}" data-variant-id="${escapeHtml(product.variantId || '')}" data-product-title="${escapeHtml(product.title || '')}" data-product-price="${escapeHtml(product.price || '')}" data-product-compare-at-price="${escapeHtml(product.compareAtPrice || '')}" data-product-image-url="${escapeHtml(product.image && product.image.url ? product.image.url : '')}" data-product-image-alt="${escapeHtml(product.image && product.image.altText ? product.image.altText : product.title || '')}">
      <div class="home-trending-image-wrap">
        ${discount ? `<span class="home-deal-badge">-${discount}%</span>` : ''}
        <a class="home-trending-image" href="${escapeHtml(productUrl)}">${image}</a>
        <button class="home-add-button" type="button" data-catalog-add aria-label="Lägg ${escapeHtml(product.title)} i kundkorg">+</button>
      </div>
      <a class="home-trending-copy" href="${escapeHtml(productUrl)}">
        <small>${escapeHtml(vendor)}</small>
        <strong>${escapeHtml(product.title)}</strong>
        <span class="home-trending-prices">
          <em>${escapeHtml(product.price || 'Medlemspris')}</em>
          ${compareAtPrice ? `<del>${escapeHtml(compareAtPrice)}</del>` : ''}
        </span>
        ${saving ? `<span class="home-trending-saving">Du sparar ${escapeHtml(formatSavingsSek(saving))}</span>` : ''}
      </a>
    </article>
  `;
}

function renderRelatedProducts(currentProduct, products = []) {
  const grid = document.querySelector('[data-related-products]');

  if (!grid || !currentProduct) {
    return;
  }

  const related = products
    .filter((product) => (
      product
      && product.handle
      && product.handle !== currentProduct.handle
      && product.handle !== 'medlemskap'
      && (
        product.category === currentProduct.category
        || product.vendor === currentProduct.vendor
        || product.productType === currentProduct.productType
      )
    ))
    .slice(0, 4);

  const fallback = products
    .filter((product) => (
      product
      && product.handle
      && product.handle !== currentProduct.handle
      && product.handle !== 'medlemskap'
      && !related.some((item) => item.handle === product.handle)
    ))
    .slice(0, Math.max(0, 4 - related.length));

  const items = [...related, ...fallback];

  if (!items.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <span>Relaterade produkter fylls på</span>
        <p>Gå till katalogen för att se alla aktiva medlemsdeals.</p>
        <a class="product-btn" href="/produkter">Visa produkter</a>
      </div>
    `;
    return;
  }

  grid.innerHTML = items.map(homeTrendingCard).join('');
}

function homePreferredDeals(products) {
  const categoryMinimums = [
    'Bilvård & tvätt',
    'Träning & hälsa',
    'Skönhet & Smink',
  ];
  const wanted = [
    ['tershine'],
    ['10 st', 'whey', 'portions'],
    ['celsius', 'apelsin'],
    ['gyeon', 'wetcoat'],
    ['body science', 'whey'],
    ['ola', 'henriksen'],
    ['body mist'],
    ['parfym'],
  ];
  const used = new Set();
  const picks = [];

  categoryMinimums.forEach((category) => {
    topDiscountProducts(
      products.filter((product) => productMatchesCategory(product, category)),
      2
    ).forEach((product) => addUniqueProduct(picks, product, used));
  });

  wanted.forEach((needles) => {
    const match = products.find((product) => {
      if (used.has(product.handle)) return false;
      const haystack = [
        product.title,
        product.vendor,
        product.category,
        ...(Array.isArray(product.tags) ? product.tags : []),
      ].join(' ').toLowerCase();

      return needles.every((needle) => haystack.includes(needle));
    });

    if (match) {
      addUniqueProduct(picks, match, used);
    }
  });

  const filler = topDiscountProducts(products, 8)
    .filter((product) => !used.has(product.handle));

  return [...picks, ...filler].slice(0, 8);
}

function renderHomeTrendingFallback() {
  const trending = document.querySelector('[data-home-trending]');

  if (!trending || trending.children.length) {
    return;
  }

  trending.innerHTML = `
    <article class="home-trending-card home-static-card">
      <span class="home-deal-badge">-21%</span>
      <span class="home-trending-image"><img src="assets/product-clean/10-st-whey-100-portionspase.jpg?v=20260510-cardbg" alt="Body Science Whey 100% Chocolate"></span>
      <span class="home-trending-copy">
        <small>Body Science</small>
        <strong>10 st Whey 100% Portionspåse</strong>
        <span class="member-price-label">Medlemspris</span>
        <span class="home-trending-prices"><em>119 kr</em><del>150 kr</del></span>
        <span class="home-trending-saving">Du sparar -31 kr</span>
      </span>
      <a class="home-add-button" href="/produkter" aria-label="Visa produkter">+</a>
    </article>
    <article class="home-trending-card home-static-card">
      <span class="home-deal-badge">-20%</span>
      <span class="home-trending-image"><img src="assets/product-clean/bilschampo-tershine-purify-s-keramiskt.jpg?v=20260510-cardbg" alt=""></span>
      <span class="home-trending-copy">
        <small>Versen</small>
        <strong>Purify S Keramiskt schampo</strong>
        <span class="member-price-label">Medlemspris</span>
        <span class="home-trending-prices"><em>159 kr</em><del>199 kr</del></span>
        <span class="home-trending-saving">Du sparar -40 kr</span>
      </span>
      <a class="home-add-button" href="/produkter" aria-label="Visa produkter">+</a>
    </article>
    <article class="home-trending-card home-static-card">
      <span class="home-deal-badge">-25%</span>
      <span class="home-trending-image"><img src="assets/product-clean/snabbforsegling-tershine-amplify-500-ml.jpg?v=20260510-cardbg" alt=""></span>
      <span class="home-trending-copy">
        <small>Versen</small>
        <strong>Amplify snabbförsegling</strong>
        <span class="member-price-label">Medlemspris</span>
        <span class="home-trending-prices"><em>149 kr</em><del>199 kr</del></span>
        <span class="home-trending-saving">Du sparar -50 kr</span>
      </span>
      <a class="home-add-button" href="/produkter" aria-label="Visa produkter">+</a>
    </article>
  `;
}

function renderHomeDealTeaser(products) {
  const teaser = document.querySelector('[data-home-deal-teaser]');
  const trending = document.querySelector('[data-home-trending]');

  if (!teaser && !trending) {
    return;
  }

  const deals = topDiscountProducts(products, 8);

  if (teaser && deals.length) {
    teaser.innerHTML = homeDealTeaserCard(pickRandomProducts(deals, 3));
  }

  if (trending) {
    const items = homePreferredDeals(products);
    trending.innerHTML = items.map(homeTrendingCard).join('');
  }
}

function productMatchesCategory(product, category) {
  if (!category || category === 'Alla') return true;

  const values = [
    product.category,
    product.vendor,
    product.productType,
    ...(Array.isArray(product.tags) ? product.tags : []),
  ].map((value) => String(value || '').toLowerCase());
  const target = String(category).toLowerCase();

  if (values.some((value) => value === target || value.includes(target))) {
    return true;
  }

  if (target === 'bilvård' || target === 'bilvård & tvätt') {
    return values.some((value) => ['tershine', 'gyeon', 'bilvard', 'car care'].some((needle) => value.includes(needle)));
  }

  if (target === 'träning & hälsa') {
    return values.some((value) => ['träning', 'halsa', 'hälsa', 'training', 'nocco', 'barebells', 'body science', 'protein'].some((needle) => value.includes(needle)));
  }

  if (target === 'skönhet & smink') {
    return values.some((value) => ['skönhet', 'skonhet', 'smink', 'beauty', 'makeup', 'parfym', 'perfume', 'fragrance', 'body mist', 'ola henriksen', 'ole henriksen', 'hudvård', 'hudvard', 'skincare'].some((needle) => value.includes(needle)));
  }

  return false;
}

function renderCategoryLaunch(products) {
  document.querySelectorAll('[data-category-count]').forEach((element) => {
    const count = element.dataset.categoryCount === 'Alla'
      ? products.length
      : products.filter((product) => productMatchesCategory(product, element.dataset.categoryCount)).length;
    element.textContent = count ? `${count} produkter denna vecka` : 'Fylls på snart';
  });

  document.querySelectorAll('[data-category-images]').forEach((element) => {
    const images = products
      .filter((product) => (
        productMatchesCategory(product, element.dataset.categoryImages)
        && product.image
        && product.image.url
      ))
      .slice(0, 4);

    element.innerHTML = images.map((product) => `
      <img src="${escapeHtml(product.image.url)}" alt="${escapeHtml(product.image.altText || product.title)}">
    `).join('');
  });
}

function renderCatalogProducts(category) {
  const grid = document.querySelector('[data-products-grid]');

  if (!grid) {
    return;
  }

  const products = sortCatalogProducts(
    category && category !== 'Alla'
      ? catalogProducts.filter((product) => productMatchesCategory(product, category))
      : catalogProducts
  );

  if (!products.length) {
    grid.innerHTML = `
      <div class="empty-state catalog-empty">
        <span>Inget i kategorin ännu</span>
        <p>Välj en annan kategori eller kom tillbaka nästa torsdag.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = products.map(productCard).join('');
  prepareProductCardLinks(grid);
  syncShoppingAccess();
}

function sortCatalogProducts(products) {
  return [...products].sort((a, b) => {
    if (catalogSort === 'price') {
      return parsePrice(a.price) - parsePrice(b.price);
    }

    return `${a.vendor || ''} ${a.title || ''}`.localeCompare(`${b.vendor || ''} ${b.title || ''}`, 'sv');
  });
}

function selectCatalogCategory(category, options = {}) {
  if (!category) {
    return;
  }

  if (document.querySelector('[data-category-launch]') && accountSession === null && document.body.classList.contains('auth-loading')) {
    window.setTimeout(() => selectCatalogCategory(category, options), 120);
    return;
  }

  selectedCatalogCategory = category;

  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === category);
  });

  document.querySelectorAll('[data-category-select]').forEach((button) => {
    button.classList.toggle('active', button.dataset.categorySelect === category);
  });

  renderCatalogProducts(category);

  if (options.scroll !== false) {
    document.querySelector('.catalog-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

document.querySelectorAll('[data-category-select]').forEach((button) => {
  button.addEventListener('click', () => {
    selectCatalogCategory(button.dataset.categorySelect, { scroll: false });
  });
});

function showMembershipGate(options = {}) {
  if (document.querySelector('.category-lock-popover')) {
    return;
  }

  const badge = options.badge || 'Medlemskatalog';
  const title = options.title || 'Bli medlem för att öppna veckans deals';
  const copy = options.copy || 'Din kundkorg är sparad. Fortsätt för att slutföra checkout med de här priserna.';
  const href = options.href || '/medlemskap';
  const cta = options.cta || 'Fortsätt';
  const required = Boolean(options.required);

  const modal = document.createElement('div');
  modal.className = `category-lock-popover${required ? ' is-required' : ''}`;
  modal.innerHTML = `
    <div class="category-lock-card">
      <div class="badge">${escapeHtml(badge)}</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(copy)}</p>
      <div class="category-lock-actions">
        <a class="product-btn" href="${escapeHtml(href)}">${escapeHtml(cta)}</a>
        ${required ? '' : '<button class="product-btn secondary" type="button" data-close-category-lock>Inte nu</button>'}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  window.setTimeout(() => modal.classList.add('show'), 20);

  modal.addEventListener('click', (event) => {
    if (required) {
      return;
    }

    if (event.target === modal || event.target.closest('[data-close-category-lock]')) {
      modal.classList.remove('show');
      window.setTimeout(() => modal.remove(), 200);
    }
  });
}

function showCheckoutMembershipGate() {
  const authenticated = Boolean(accountSession && accountSession.authenticated);
  rememberMembershipReturn({
    type: 'checkout',
    step: currentCheckoutStep(),
    startedAt: new Date().toISOString(),
  });
  showMembershipGate({
    badge: 'Checkout',
    title: 'Bli medlem för att slutföra ditt köp.',
    copy: 'Versen är en medlemsklubb med exklusiva priser och utvalda drops. Din kundkorg är sparad.',
    href: authenticated ? `/medlemskap?return=checkout&step=${encodeURIComponent(currentCheckoutStep())}` : `/konto?next=checkout&step=${encodeURIComponent(currentCheckoutStep())}`,
    cta: authenticated ? 'Bli medlem & fortsätt' : 'Skapa konto & fortsätt',
    required: true,
  });
}

function renderSuggestionAccess(session = accountSession) {
  const page = document.querySelector('[data-suggestion-page]');
  const form = document.querySelector('[data-suggestion-form]');

  if (!page || !form || !session) {
    return;
  }

  const member = isActiveMember(session);
  const authenticated = Boolean(session && session.authenticated);
  const lockNote = document.querySelector('[data-suggestion-lock-note]');

  document.body.classList.toggle('suggestion-locked', !member);
  page.classList.toggle('is-locked', !member);
  if (lockNote) lockNote.hidden = member;

  form.querySelectorAll('input, textarea, button').forEach((field) => {
    field.disabled = !member;
  });

  if (!member && !document.body.dataset.suggestionGateShown) {
    document.body.dataset.suggestionGateShown = '1';
    window.setTimeout(() => {
      showMembershipGate({
        badge: 'Community drop',
        title: 'Bli medlem för att föreslå nästa drop.',
        copy: 'Medlemmar kan tipsa om produkter och påverka vad vi jagar in till kommande veckor.',
        href: authenticated ? '/medlemskap' : '/konto?next=membership',
        cta: authenticated ? 'Bli medlem' : 'Skapa konto & bli medlem',
      });
    }, 260);
  }
}

function prepareProductCardLinks(root = document) {
  root.querySelectorAll('.product-card').forEach((card) => {
    const link = card.querySelector('a[href*="/produkt"]');

    if (!link) {
      return;
    }

    card.dataset.productUrl = card.dataset.productUrl || link.getAttribute('href');
    card.setAttribute('role', 'link');

    if (!card.hasAttribute('tabindex')) {
      card.tabIndex = 0;
    }
  });
  updateWishlistButtons();
}

document.addEventListener('click', (event) => {
  const wishlistButton = event.target.closest('[data-wishlist-toggle]');

  if (wishlistButton) {
    event.preventDefault();
    event.stopPropagation();
    const source = wishlistButton.closest('[data-product-handle], [data-product-detail]');
    if (source) {
      toggleLikedProduct(productFromDataset(source.dataset));
    }
    return;
  }

  const card = event.target.closest('.product-card');

  if (!card || event.target.closest('a, button, input, select, textarea')) {
    return;
  }

  const url = card.dataset.productUrl;

  if (url) {
    window.location.href = url;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  const card = event.target.closest('.product-card');

  if (!card || event.target.closest('a, button, input, select, textarea')) {
    return;
  }

  const url = card.dataset.productUrl;

  if (url) {
    event.preventDefault();
    window.location.href = url;
  }
});

async function loadProducts() {
  const grid = document.querySelector('[data-products-grid]');

  if (!grid) {
    return;
  }

  try {
    const response = await fetch('/api/products');

    if (!response.ok) {
      renderHomeTrendingFallback();
      return;
    }

    const data = await response.json();

    if (!data.products || !data.products.length) {
      return;
    }

    const visibleProducts = data.products.filter((product) => product.handle !== 'medlemskap');

    if (!visibleProducts.length) {
      return;
    }

    catalogProducts = visibleProducts;
    renderCategoryLaunch(visibleProducts);

    const categoryFromUrl = new URLSearchParams(window.location.search).get('kategori');
    const initialCategory = categoryFromUrl || selectedCatalogCategory || 'Alla';

    selectCatalogCategory(initialCategory, { scroll: false });
  } catch (error) {
    return;
  }
}

prepareProductCardLinks();
loadProducts();

function renderLikedPage() {
  const grid = document.querySelector('[data-liked-grid]');
  const warning = document.querySelector('[data-liked-guest-warning]');

  if (!grid) {
    return;
  }

  const liked = readLikedProducts();

  if (warning) {
    warning.hidden = Boolean(accountSession && accountSession.authenticated);
  }

  if (!liked.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <span>Inget sparat än</span>
        <p>Tryck på hjärtat på en produkt för att lägga den här.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = liked.map((product) => productCard({
    ...product,
    vendor: product.vendor || product.category || 'Versen',
    variantId: product.variantId || '',
    flags: product.flags || {},
  })).join('');
  prepareProductCardLinks(grid);
}

async function hydrateLikedFromCatalog() {
  if (!document.querySelector('[data-liked-grid]')) {
    return;
  }

  try {
    const response = await fetch('/api/products');
    if (!response.ok) return;
    const data = await response.json();
    const products = (data.products || []).filter((product) => product.handle !== 'medlemskap');
    catalogProducts = products;
    const likedHandles = new Set(readLikedProducts().map((product) => product.handle));
    const hydrated = products.filter((product) => likedHandles.has(product.handle));
    if (hydrated.length) {
      writeLikedProducts([...hydrated, ...readLikedProducts()]);
    } else {
      renderLikedPage();
    }
  } catch (error) {
    renderLikedPage();
  }
}

hydrateLikedFromCatalog();

async function loadMemberHomeProducts() {
  const grid = document.querySelector('[data-member-products]');
  const homeTeaser = document.querySelector('[data-home-deal-teaser]');
  const homeTrending = document.querySelector('[data-home-trending]');

  if (!grid && !homeTeaser && !homeTrending) {
    return;
  }

  try {
    const response = await fetch('/api/products');

    if (!response.ok) {
      renderHomeTrendingFallback();
      return;
    }

    const data = await response.json();
    const visibleProducts = (data.products || [])
      .filter((product) => product.handle !== 'medlemskap');

    if (!visibleProducts.length) {
      renderHomeTrendingFallback();
      return;
    }

    renderHomeDealTeaser(visibleProducts);

    if (!grid) {
      return;
    }

    memberLiveProducts = visibleProducts;

    if (!memberLiveProducts.length) {
      return;
    }

    renderMemberLiveProducts(grid);

    if (!memberLiveTimer) {
      memberLiveTimer = window.setInterval(() => renderMemberLiveProducts(grid), 60000);
    }
  } catch (error) {
    renderHomeTrendingFallback();
    return;
  }
}

loadMemberHomeProducts();

function renderMemberLiveProducts(grid) {
  const products = pickRandomProducts(memberLiveProducts, 3);
  grid.innerHTML = products.map(liveProductCard).join('');
}

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (element && value) {
    element.textContent = value;
  }
}

const PRODUCT_SECTION_TITLES = [
  'Egenskaper',
  'Innehåll',
  'Ingredienser',
  'Rekommenderad användning',
  'Autodudes snabbmanual',
  'Rengörings- och underhållsinstruktioner',
  'Användning',
  'Dosering',
  'Förvaring',
  'Säkerhet',
];

const PRODUCT_SPEC_LABELS = [
  'Produkt',
  'Användningsområde',
  'Förpackning',
  'Blandningsförhållande',
  'Utspädning',
  'Storlek',
  'Doft',
  'Volym',
  'Material',
  'Färg',
];

const PRODUCT_FEATURE_PHRASES = [
  'Utvecklat i Sverige',
  'Ej märkningspliktig enligt CLP-förordningen (EG) 1272/2008',
  'Förvaras oåtkomligt för barn',
  'Bra absorptionsförmåga',
  'Smart söm i handskens inre för bättre grepp',
  'Tål att tvättas (40-60 grader, utan mjuk- och tvättmedel)',
];

function normalizeProductText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function splitProductSections(description) {
  const text = normalizeProductText(description);

  if (!text) {
    return [];
  }

  const titlePattern = PRODUCT_SECTION_TITLES
    .map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const headingRegex = new RegExp(`\\b(${titlePattern})\\b:?`, 'g');
  const matches = Array.from(text.matchAll(headingRegex));

  if (!matches.length) {
    return [{ title: '', body: text }];
  }

  const sections = [];
  const firstIndex = matches[0].index || 0;

  if (firstIndex > 0) {
    sections.push({ title: '', body: text.slice(0, firstIndex).trim() });
  }

  matches.forEach((match, index) => {
    const next = matches[index + 1];
    const start = (match.index || 0) + match[0].length;
    const end = next ? next.index : text.length;
    sections.push({
      title: match[1],
      body: text.slice(start, end).replace(/^:\s*/, '').trim(),
    });
  });

  return sections.filter((section) => section.body);
}

function parseSpecRows(body) {
  const labelPattern = PRODUCT_SPEC_LABELS
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const regex = new RegExp(`\\b(${labelPattern}):\\s*`, 'gi');
  const matches = Array.from(body.matchAll(regex));

  if (!matches.length) {
    return { rows: [], rest: body, notes: [] };
  }

  const notes = [];
  const featurePattern = PRODUCT_FEATURE_PHRASES
    .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const featureRegex = new RegExp(`\\b(${featurePattern})\\.?`, 'i');
  const collectFeatureNotes = (value) => {
    PRODUCT_FEATURE_PHRASES.forEach((phrase) => {
      if (value.includes(phrase) && !notes.includes(phrase)) {
        notes.push(phrase);
      }
    });
  };

  const rows = matches.map((match, index) => {
    const next = matches[index + 1];
    const start = (match.index || 0) + match[0].length;
    const end = next ? next.index : body.length;
    let value = body.slice(start, end).trim().replace(/[.,]\s*$/, '');
    const featureMatch = value.match(featureRegex);

    if (featureMatch) {
      const noteText = value.slice(featureMatch.index).trim().replace(/\s+/g, ' ');
      value = value.slice(0, featureMatch.index).trim().replace(/[.,]\s*$/, '');
      collectFeatureNotes(noteText);
    }

    return {
      label: match[1],
      value,
    };
  }).filter((row) => row.value);

  const firstIndex = matches[0].index || 0;
  const rest = firstIndex > 0 ? body.slice(0, firstIndex).trim() : '';

  return { rows, rest, notes };
}

function sentenceParagraphs(body) {
  const normalized = normalizeProductText(body);

  if (!normalized) {
    return [];
  }

  const lineParts = normalized.split(/\n+/).map((part) => part.trim()).filter(Boolean);

  if (lineParts.length > 1) {
    return lineParts;
  }

  const sentences = normalized
    .replace(/\s+(?=(?:Förvaras|Produkten|Repel|Tillsätt|Använd|Blanda|Spola|Gör)\b)/g, '\n')
    .split(/(?<=[.!?])\s+(?=(?:[A-ZÅÄÖ0-9]|tershine|gyeon|barebells)\b)/)
    .reduce((groups, sentence) => {
      const clean = sentence.trim();
      const last = groups[groups.length - 1] || '';

      if (!clean) {
        return groups;
      }

      if (!last || last.length > 220 || last.length + clean.length > 420) {
        groups.push(clean);
      } else {
        groups[groups.length - 1] = `${last} ${clean}`;
      }

      return groups;
    }, []);

  return sentences.flatMap((paragraph) => splitLongParagraph(paragraph));
}

function splitLongParagraph(paragraph) {
  if (paragraph.length <= 720) {
    return [paragraph];
  }

  const parts = paragraph
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return [paragraph];
  }

  return parts.reduce((groups, part) => {
    const last = groups[groups.length - 1] || '';

    if (!last || last.length + part.length > 620) {
      groups.push(part);
    } else {
      groups[groups.length - 1] = `${last} ${part}`;
    }

    return groups;
  }, []);
}

function renderBodyText(body) {
  return sentenceParagraphs(body)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');
}

function renderProductDescription(description) {
  const sections = splitProductSections(description);

  if (!sections.length) {
    return '<p>Produktinformation hämtas från Versens katalog.</p>';
  }

  return sections.map((section, index) => {
    const title = section.title ? `<h3>${escapeHtml(section.title)}</h3>` : '';
    const isSpecSection = /^Egenskaper$/i.test(section.title);
    const isIngredientSection = /^(Innehåll|Ingredienser)$/i.test(section.title);

    if (isSpecSection) {
      const { rows, rest, notes } = parseSpecRows(section.body);
      const specs = rows.length
        ? `<dl class="product-spec-list">${rows.map((row) => `
            <div>
              <dt>${escapeHtml(row.label)}</dt>
              <dd>${escapeHtml(row.value)}</dd>
            </div>
          `).join('')}</dl>`
        : '';
      const noteList = notes.length
        ? `<ul class="product-note-list">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
        : '';
      const restText = rest ? renderBodyText(rest) : '';

      return `<section class="product-copy-section product-spec-section ${index === 0 ? 'is-intro' : ''}">${title}${restText}${specs}${noteList}</section>`;
    }

    if (isIngredientSection) {
      return `
        <section class="product-copy-section product-ingredient-section">
          ${title}
          <p>${escapeHtml(section.body)}</p>
        </section>
      `;
    }

    return `<section class="product-copy-section ${index === 0 ? 'is-intro' : ''}">${title}${renderBodyText(section.body)}</section>`;
  }).join('');
}

function setProductDescription(product) {
  const element = document.querySelector('[data-product-description]');

  if (!element) {
    return;
  }

  element.innerHTML = renderProductDescription(product.description || 'Produktinformation hämtas från Versens katalog.');
}

function productSummaryText(product) {
  const sections = splitProductSections(product && product.description ? product.description : '');
  const firstText = (
    sections.find((section) => section.body && !/^(Egenskaper|Innehåll|Ingredienser)$/i.test(section.title || '')) ||
    sections.find((section) => section.body)
  )?.body || '';
  const fallback = product && product.title
    ? `${product.title} till medlemspris hos Versen.`
    : 'Produktinformation hämtas från Versens katalog.';
  const text = sentenceParagraphs(firstText)[0] || fallback;

  return text.length > 240 ? `${text.slice(0, 237).trim()}...` : text;
}

function setProductSummary(product) {
  const summary = productSummaryText(product);

  document.querySelectorAll('[data-product-summary]').forEach((element) => {
    element.textContent = summary;
  });
}

function setProductChrome(product) {
  document.querySelectorAll('[data-product-breadcrumb-title]').forEach((element) => {
    element.textContent = product.title || 'Produkt';
  });

  document.querySelectorAll('[data-product-category-crumb]').forEach((element) => {
    element.textContent = product.category || 'Shop';
  });
}

function setProductThumbImages(image, product) {
  document.querySelectorAll('[data-product-thumb-image]').forEach((element) => {
    if (!image || !image.url) {
      element.textContent = 'Bild';
      return;
    }

    element.innerHTML = `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.altText || product.title || '')}">`;
  });
}

function variantLabel(variant) {
  if (!variant) {
    return '';
  }

  if (variant.label) {
    return variant.label;
  }

  const options = variant.selectedOptions || [];
  return options.map((option) => option.value).filter(Boolean).join(' / ');
}

function variantDisplayTitle(product, variant) {
  const label = variantLabel(variant);

  return label ? `${product.title} - ${label}` : product.title;
}

function updateProductVariant(product, variant) {
  const detail = document.querySelector('[data-product-detail]');

  if (!detail || !product || !variant) {
    return;
  }

  const image = variant.image || product.image;
  const price = variant.price || product.price || 'Pris kommer';
  const compareAtPrice = variant.compareAtPrice || product.compareAtPrice || price;

  detail.dataset.variantId = variant.id || product.variantId || '';
  detail.dataset.cartHandle = product.handle || '';
  detail.dataset.cartTitle = variantDisplayTitle(product, variant);
  detail.dataset.cartCategory = product.category || '';
  detail.dataset.cartPrice = price;
  detail.dataset.cartCompareAtPrice = compareAtPrice;
  detail.dataset.cartImageUrl = image && image.url ? image.url : '';
  detail.dataset.cartImageAlt = image && image.altText ? image.altText : product.title || '';

  setText('[data-product-compare-price]', compareAtPrice);
  setText('[data-product-price]', price);

  const savingElement = document.querySelector('[data-product-saving]');
  if (savingElement) {
    const savingAmount = parsePrice(compareAtPrice) - parsePrice(price);
    const savingPercent = parsePrice(compareAtPrice)
      ? Math.round((savingAmount / parsePrice(compareAtPrice)) * 100)
      : 0;
    savingElement.textContent = savingAmount > 0
      ? `Du sparar ${formatSavingsSek(savingAmount)}${savingPercent > 0 ? ` (${savingPercent}%)` : ''}`
      : '';
    savingElement.hidden = savingAmount <= 0;
  }

  const urgency = document.querySelector('[data-product-urgency]');
  if (urgency) {
    urgency.textContent = 'Finns i lager';
  }

  const imageElement = document.querySelector('[data-product-image]');
  if (imageElement && image && image.url) {
    const current = imageElement.querySelector('img');
    setProductThumbImages(image, product);

    if (current && current.getAttribute('src') === image.url) {
      return;
    }

    const next = new Image();
    next.onload = () => {
      imageElement.innerHTML = '';
      imageElement.appendChild(next);
    };
    next.alt = image.altText || product.title || '';
    next.src = image.url;
  }
}

function renderVariantPicker(product) {
  const picker = document.querySelector('[data-variant-picker]');
  const variants = (product.variants || []).filter((variant) => variant && variant.id);
  const selectedId = document.querySelector('[data-product-detail]')?.dataset.variantId;

  if (!picker) {
    return;
  }

  if (variants.length <= 1) {
    picker.hidden = true;
    picker.innerHTML = '';
    return;
  }

  const optionName = (variants[0].selectedOptions || [])[0]?.name || 'Välj alternativ';
  const activeVariant = variants.find((variant, index) => variant.id === selectedId || (!selectedId && index === 0)) || variants[0];

  picker.hidden = false;
  picker.innerHTML = `
    <label for="product-variant-select">${escapeHtml(optionName)}</label>
    <div class="variant-select-wrap">
      <select id="product-variant-select" data-variant-select>
      ${variants.map((variant, index) => `
        <option value="${escapeHtml(variant.id)}" ${variant.id === activeVariant.id ? 'selected' : ''} ${variant.availableForSale ? '' : 'disabled'}>
          ${escapeHtml(variantLabel(variant) || `Val ${index + 1}`)}
        </option>
      `).join('')}
      </select>
    </div>
  `;

  picker.querySelector('[data-variant-select]')?.addEventListener('change', (event) => {
    const nextVariant = variants.find((variant) => variant.id === event.target.value);

    if (!nextVariant) {
      return;
    }

    updateProductVariant(product, nextVariant);
  });
}

function setProductDetail(product) {
  const detail = document.querySelector('[data-product-detail]');

  if (!detail || !product) {
    return;
  }

  const variants = (product.variants || []).filter((variant) => variant && variant.id);
  const selectedVariant = variants.find((variant) => variant.id === product.variantId) || variants[0] || {
    id: product.variantId,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    image: product.image,
  };

  setText('[data-product-category]', product.category);
  setText('[data-product-title]', product.title);
  setProductChrome(product);
  setProductSummary(product);
  setProductDescription(product);
  updateProductVariant(product, selectedVariant);
  renderVariantPicker(product);

  syncShoppingAccess();
}

async function loadProductDetail() {
  const detail = document.querySelector('[data-product-detail]');

  if (!detail) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const requestedHandle = params.get('handle');

  try {
    if (requestedHandle) {
      const response = await fetch(`/api/products?handle=${encodeURIComponent(requestedHandle)}`);

      if (response.ok) {
        const data = await response.json();
        setProductDetail(data.product);
        fetch('/api/products')
          .then((relatedResponse) => relatedResponse.ok ? relatedResponse.json() : null)
          .then((relatedData) => renderRelatedProducts(data.product, relatedData && relatedData.products ? relatedData.products : []))
          .catch(() => renderRelatedProducts(data.product, []));
        return;
      }
    }

    const response = await fetch('/api/products');

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const product = (data.products || []).find((item) => (
      item.handle !== 'medlemskap' && item.image && item.image.url && item.availableForSale
    )) || (data.products || []).find((item) => item.handle !== 'medlemskap');

    setProductDetail(product);
    renderRelatedProducts(product, data.products || []);
  } catch (error) {
    return;
  }
}

loadProductDetail();

function currentProductFromDetail() {
  const detail = document.querySelector('[data-product-detail]');

  if (!detail || !detail.dataset.variantId) {
    return null;
  }

  return {
    variantId: detail.dataset.variantId,
    handle: detail.dataset.cartHandle,
    title: detail.dataset.cartTitle,
    category: detail.dataset.cartCategory,
    price: detail.dataset.cartPrice,
    compareAtPrice: detail.dataset.cartCompareAtPrice,
    image: detail.dataset.cartImageUrl
      ? {
        url: detail.dataset.cartImageUrl,
        altText: detail.dataset.cartImageAlt,
      }
      : null,
  };
}

const quantityInput = document.querySelector('[data-product-quantity]');
const quantityMinus = document.querySelector('[data-quantity-minus]');
const quantityPlus = document.querySelector('[data-quantity-plus]');

if (quantityInput && quantityMinus && quantityPlus) {
  quantityMinus.addEventListener('click', () => {
    quantityInput.value = Math.max(1, Number(quantityInput.value) - 1 || 1);
  });

  quantityPlus.addEventListener('click', () => {
    quantityInput.value = Math.max(1, Number(quantityInput.value) + 1 || 2);
  });
}

const addToCartButton = document.querySelector('[data-add-to-cart-button]');
const buyNowButton = document.querySelector('[data-buy-now-button]');

if (addToCartButton) {
  addToCartButton.addEventListener('click', () => {
    const product = currentProductFromDetail();
    const message = document.querySelector('[data-checkout-message]');
    const quantity = quantityInput ? Number(quantityInput.value) : 1;

    if (!product) {
      if (message) message.textContent = 'Produkten är inte redo för kundkorgen ännu.';
      return;
    }

    addToCart(product, quantity);
    if (message) message.textContent = 'Produkten ligger nu i kundkorgen.';
    addToCartButton.textContent = 'Tillagd i kundkorg';

    window.setTimeout(() => {
      addToCartButton.textContent = 'Lägg i kundkorg';
    }, 1400);
  });
}

if (buyNowButton) {
  buyNowButton.addEventListener('click', () => {
    const product = currentProductFromDetail();
    const message = document.querySelector('[data-checkout-message]');
    const quantity = quantityInput ? Number(quantityInput.value) : 1;

    if (!product) {
      if (message) message.textContent = 'Produkten är inte redo för kundkorgen ännu.';
      return;
    }

    addToCart(product, quantity);
    window.location.href = '/kundvagn';
  });
}

function cartItemTemplate(item) {
  const image = item.image && item.image.url
    ? `<img src="${escapeHtml(item.image.url)}" alt="${escapeHtml(item.image.altText || item.title)}">`
    : 'Bild';

  return `
    <article class="cart-item" data-cart-item="${escapeHtml(item.variantId)}">
      <a class="cart-item-image" href="/produkt?handle=${encodeURIComponent(item.handle)}">${image}</a>
      <div class="cart-item-info">
        <div class="product-category">${escapeHtml(item.category || 'Produkt')}</div>
        <h3>${escapeHtml(item.title)}</h3>
        <div class="product-prices">
          <span class="old">${escapeHtml(item.compareAtPrice || '')}</span>
          <span class="new">${escapeHtml(item.price || 'Pris kommer')}</span>
        </div>
        <div class="cart-actions">
          <div class="quantity-control small" aria-label="Ändra antal">
            <button type="button" aria-label="Minska antal" data-cart-minus="${escapeHtml(item.variantId)}">-</button>
            <span class="quantity-value">
              <input type="number" min="1" value="${Number(item.quantity) || 1}" inputmode="numeric" aria-label="Antal" data-cart-quantity="${escapeHtml(item.variantId)}">
            </span>
            <button type="button" aria-label="Öka antal" data-cart-plus="${escapeHtml(item.variantId)}">+</button>
          </div>
          <button class="remove-btn" type="button" aria-label="Ta bort ${escapeHtml(item.title)}" data-cart-remove="${escapeHtml(item.variantId)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderCart() {
  const list = document.querySelector('[data-cart-items]');

  if (!list) {
    return;
  }

  const cart = readCart();
  const totalItems = cartQuantity(cart);
  const total = cart.reduce((sum, item) => sum + (parsePrice(item.price) * (Number(item.quantity) || 1)), 0);
  const savings = cartSavingsAmount(cart);
  document.body.classList.toggle('cart-has-items', Boolean(cart.length));

  if (!cart.length) {
    list.innerHTML = `
      <div class="empty-cart">
        <h2>Kundkorgen är tom</h2>
        <p>Lägg till produkter från katalogen innan du går vidare till checkout.</p>
        <a class="product-btn" href="/produkter">Handla</a>
      </div>
    `;
  } else {
    list.innerHTML = cart.map(cartItemTemplate).join('');
  }

  setText('[data-cart-total-items]', `${totalItems} st`);
  setText('[data-cart-heading-items]', `${totalItems} st`);
  setText('[data-cart-total]', formatSek(total));
  setText('[data-cart-saving]', formatSavingsSek(savings));
  document.querySelectorAll('[data-cart-saving-row]').forEach((element) => {
    element.hidden = savings <= 0;
  });
  setText('[data-cart-heading-title]', cart.length ? `Kundkorg ${totalItems} st` : 'Här var det ensamt.. handla mer');
  setText('[data-cart-heading-copy]', 'Kika igenom vad du lagt till och glöm inte skriva in rabattkod om du har det.');

  const checkoutButton = document.querySelector('[data-cart-checkout]');
  if (checkoutButton) {
    checkoutButton.disabled = !cart.length;
  }

  updateCartCount();
  syncShoppingAccess();
}

document.addEventListener('click', (event) => {
  const catalogAddButton = event.target.closest('[data-catalog-add]');
  const removeButton = event.target.closest('[data-cart-remove]');
  const minusButton = event.target.closest('[data-cart-minus]');
  const plusButton = event.target.closest('[data-cart-plus]');

  if (catalogAddButton) {
    const card = catalogAddButton.closest('[data-variant-id]');

    if (card && card.dataset.variantId) {
      addToCart({
        variantId: card.dataset.variantId,
        handle: card.dataset.productHandle,
        title: card.dataset.productTitle,
        category: card.dataset.category,
        price: card.dataset.productPrice,
        compareAtPrice: card.dataset.productCompareAtPrice,
        image: card.dataset.productImageUrl
          ? {
            url: card.dataset.productImageUrl,
            altText: card.dataset.productImageAlt,
          }
          : null,
      });

      catalogAddButton.textContent = 'Tillagd';
      window.setTimeout(() => {
        catalogAddButton.textContent = 'Lägg i kundkorg';
      }, 1200);
    }
  }

  if (removeButton) {
    removeCartItem(removeButton.dataset.cartRemove);
  }

  if (minusButton) {
    const item = readCart().find((cartItem) => cartItem.variantId === minusButton.dataset.cartMinus);
    setCartQuantity(minusButton.dataset.cartMinus, Math.max(1, (Number(item && item.quantity) || 1) - 1));
  }

  if (plusButton) {
    const item = readCart().find((cartItem) => cartItem.variantId === plusButton.dataset.cartPlus);
    setCartQuantity(plusButton.dataset.cartPlus, (Number(item && item.quantity) || 1) + 1);
  }
});

document.addEventListener('change', (event) => {
  const input = event.target.closest('[data-cart-quantity]');

  if (input) {
    setCartQuantity(input.dataset.cartQuantity, input.value);
  }
});

const cartCheckoutButton = document.querySelector('[data-cart-checkout]');

if (cartCheckoutButton) {
  cartCheckoutButton.addEventListener('click', () => {
    const cart = readCart();
    const message = document.querySelector('[data-cart-message]');

    if (!cart.length) {
      if (message) message.textContent = 'Kundkorgen är tom.';
      return;
    }

    if (message) message.textContent = '';
    window.location.href = '/checkout?step=kontakt';
  });
}

const discountForm = document.querySelector('[data-discount-form]');

if (discountForm) {
  const input = document.querySelector('[data-discount-code]');
  const message = document.querySelector('[data-discount-message]');

  discountForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const cart = readCart();
    const code = input ? input.value.trim() : '';

    if (!cart.length) {
      if (message) message.textContent = 'Lägg till en produkt innan du kontrollerar rabattkod.';
      return;
    }

    if (!isActiveMember()) {
      writeDiscountCode(code);
      if (message) message.textContent = code ? 'Rabattkoden sparas till checkout.' : 'Rabattkod borttagen.';
      return;
    }

    if (!code) {
      writeDiscountCode('');
      if (message) message.textContent = 'Rabattkod borttagen.';
      return;
    }

    if (message) message.textContent = 'Kontrollerar rabattkod...';

    try {
      const response = await fetch('/api/cart', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: cart.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          })),
          discountCode: code,
          validateOnly: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (message) message.textContent = data.error || 'Kunde inte kontrollera rabattkod.';
        return;
      }

      const match = (data.discountCodes || []).find((item) => item.code.toLowerCase() === code.toLowerCase());

      if (match && match.applicable) {
        writeDiscountCode(code);
        if (message) message.textContent = `Rabattkoden är aktiv. Beräknad rabatt: ${data.discountTotal || 'bekräftas i checkout'}.`;
      } else {
        writeDiscountCode('');
        if (message) message.textContent = 'Rabattkoden gäller inte för den här kundkorgen.';
      }
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta orderflödet.';
    }
  });
}

let checkoutStripe = null;
let checkoutElements = null;
let checkoutPaymentReady = false;
let checkoutFreeCheckout = false;
let checkoutPaymentIntentId = '';

function checkoutBillingDetails() {
  const draft = readCheckoutDraft();
  return {
    email: draft.contact && draft.contact.email,
    phone: draft.contact && draft.contact.phone,
    name: draft.shippingAddress ? `${draft.shippingAddress.firstName || ''} ${draft.shippingAddress.lastName || ''}`.trim() : undefined,
    address: draft.shippingAddress ? {
      line1: draft.shippingAddress.address1,
      line2: draft.shippingAddress.address2,
      city: draft.shippingAddress.city,
      postal_code: draft.shippingAddress.postalCode,
      country: 'SE',
    } : undefined,
  };
}

async function confirmCheckoutStripePayment() {
  return checkoutStripe.confirmPayment({
    elements: checkoutElements,
    confirmParams: {
      return_url: new URL('/checkout?step=bekraftelse', window.location.href).href,
      payment_method_data: {
        billing_details: checkoutBillingDetails(),
      },
    },
    redirect: 'if_required',
  });
}

async function finishCheckoutStripePayment(result) {
  const message = document.querySelector('[data-checkout-payment-message]');
  const payButton = document.querySelector('[data-checkout-pay-button]');

  if (result.error) {
    if (message) message.textContent = result.error.message || 'Betalningen kunde inte genomföras.';
    if (payButton) payButton.disabled = false;
    renderCheckoutSummary();
    return;
  }

  const paymentIntentId = result.paymentIntent && result.paymentIntent.id
    ? result.paymentIntent.id
    : checkoutPaymentIntentId;
  const order = await completeCheckoutOrder(paymentIntentId);

  if (order) {
    window.location.href = `/checkout?step=bekraftelse&order=${encodeURIComponent(order.id)}`;
  } else if (payButton) {
    payButton.disabled = false;
    renderCheckoutSummary();
  }
}

function currentCheckoutStep() {
  const requested = pageParams.get('step') || 'kontakt';
  return ['kontakt', 'leverans', 'betalning', 'bekraftelse'].includes(requested) ? requested : 'kontakt';
}

function checkoutItemsPayload() {
  return readCart().map((item) => ({
    variantId: item.variantId,
    quantity: item.quantity,
  }));
}

function fillForm(form, values = {}) {
  if (!form) return;

  Object.entries(values).forEach(([name, value]) => {
    const field = form.elements[name];
    if (!field || field.type === 'checkbox') return;
    if (!field.value && value) field.value = value;
  });
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setCheckoutPaymentLocked(locked) {
  const page = document.querySelector('[data-checkout-page]');
  const paymentPanel = document.querySelector('[data-checkout-step="betalning"]');
  const payButton = document.querySelector('[data-checkout-pay-button]');

  document.body.classList.toggle('checkout-payment-locked', Boolean(locked));
  if (page) page.classList.toggle('is-payment-locked', Boolean(locked));

  if (paymentPanel) {
    paymentPanel.querySelectorAll('input, select, button').forEach((field) => {
      field.disabled = Boolean(locked);
    });
  }

  if (payButton && locked) {
    payButton.disabled = true;
  }
}

function setCheckoutStep(step) {
  document.querySelectorAll('[data-checkout-step]').forEach((panel) => {
    panel.hidden = panel.dataset.checkoutStep !== step;
  });

  const order = ['kontakt', 'leverans', 'betalning', 'bekraftelse'];
  const activeIndex = order.indexOf(step);
  document.querySelectorAll('[data-progress-step]').forEach((item) => {
    const index = order.indexOf(item.dataset.progressStep);
    item.classList.toggle('is-active', index === activeIndex);
    item.classList.toggle('is-complete', index < activeIndex);
  });
}

function goCheckoutStep(step) {
  window.location.href = `/checkout?step=${encodeURIComponent(step)}`;
}

const CHECKOUT_STANDARD_SHIPPING = 55;

function renderCheckoutSummary(data = {}) {
  const items = data.items || readCart().map((item) => ({
    title: item.title,
    category: item.category,
    image: item.image,
    quantity: Number(item.quantity) || 1,
    total_price: parsePrice(item.price) * (Number(item.quantity) || 1) * 100,
  }));
  const fallbackSubtotal = readCart().reduce((sum, item) => sum + (parsePrice(item.price) * (Number(item.quantity) || 1)), 0);
  const savings = cartSavingsAmount(items);
  const summary = data.summary || {
    subtotal: formatSek(fallbackSubtotal),
    shipping: `${CHECKOUT_STANDARD_SHIPPING} kr`,
    tax: formatSek((fallbackSubtotal + CHECKOUT_STANDARD_SHIPPING) * 0.25),
    total: formatSek(fallbackSubtotal + CHECKOUT_STANDARD_SHIPPING),
  };
  const list = document.querySelector('[data-checkout-summary-items]');

  if (list) {
    list.innerHTML = items.map((item) => {
      const image = item.image && item.image.url
        ? `<img src="${escapeHtml(item.image.url)}" alt="${escapeHtml(item.image.altText || item.title)}">`
        : '';
      return `
        <article class="checkout-mini-item">
          <span class="checkout-mini-image">${image}</span>
          <span>
            <small>${escapeHtml(item.category || 'Produkt')}</small>
            <strong>${escapeHtml(item.title || item.product_title || 'Produkt')}</strong>
          </span>
          <em>${escapeHtml(formatSek((Number(item.total_price) || 0) / 100))}</em>
        </article>
      `;
    }).join('');
  }

  setText('[data-checkout-subtotal]', summary.subtotal || '0 kr');
  setText('[data-checkout-shipping]', summary.shipping || '0 kr');
  setText('[data-checkout-tax]', summary.tax || '0 kr');
  setText('[data-checkout-total]', summary.total || '0 kr');
  setText('[data-checkout-saving]', formatSavingsSek(savings));
  document.querySelectorAll('[data-checkout-saving-row]').forEach((element) => {
    element.hidden = savings <= 0;
  });

  const payButton = document.querySelector('[data-checkout-pay-button]');
  if (payButton) {
    payButton.textContent = summary.total ? `Betala ${summary.total}` : 'Betala';
  }
}

async function quoteCheckout() {
  const { response, data } = await postJson('/api/checkout', {
    action: 'quote',
    items: checkoutItemsPayload(),
    discountCode: readDiscountCode(),
  });

  if (!response.ok) {
    throw new Error(data.error || 'Kunde inte validera varukorgen.');
  }

  renderCheckoutSummary(data);
  return data;
}

async function trackAbandonedCheckout(latestActivity) {
  const draft = readCheckoutDraft();

  if (!draft.contact || !draft.contact.email || !cart.length) {
    return;
  }

  await postJson('/api/checkout', {
    action: 'abandoned_checkout',
    items: checkoutItemsPayload(),
    discountCode: readDiscountCode(),
    contact: draft.contact,
    shippingAddress: draft.shippingAddress || {},
    latestActivity,
  });
}

async function setupCheckoutPayment() {
  const form = document.querySelector('[data-checkout-payment-form]');
  const message = document.querySelector('[data-checkout-payment-message]');
  const payButton = document.querySelector('[data-checkout-pay-button]');

  if (!form || checkoutPaymentReady) {
    return;
  }

  if (!isActiveMember()) {
    renderCheckoutSummary();
    setCheckoutPaymentLocked(true);
    if (message) message.textContent = '';
    window.setTimeout(() => showCheckoutMembershipGate(), 180);
    return;
  }

  setCheckoutPaymentLocked(false);

  const draft = readCheckoutDraft();
  if (!draft.contact || !draft.shippingAddress) {
    goCheckoutStep(!draft.contact ? 'kontakt' : 'leverans');
    return;
  }

  if (payButton) payButton.disabled = true;
  if (message) message.textContent = 'Validerar din beställning...';

  try {
    const { response, data } = await postJson('/api/checkout', {
      action: 'payment_intent',
      items: checkoutItemsPayload(),
      discountCode: readDiscountCode(),
      contact: draft.contact,
      shippingAddress: draft.shippingAddress,
    });

    if (!response.ok) {
      throw new Error(data.error || 'Kunde inte starta betalning.');
    }

    checkoutPaymentIntentId = data.paymentIntentId;
    renderCheckoutSummary(data);

    if (data.freeCheckout) {
      checkoutStripe = null;
      checkoutElements = null;
      checkoutFreeCheckout = true;
      checkoutPaymentReady = true;
      if (payButton) {
        payButton.disabled = false;
        payButton.textContent = 'Slutför gratis order';
      }
      if (message) message.textContent = 'Testkoden är aktiv. Ingen betalning tas.';
      return;
    }

    checkoutFreeCheckout = false;

    if (!data.stripeReady || !data.publishableKey || !data.clientSecret || !window.Stripe) {
      if (message) message.textContent = 'Stripe är inte färdigkonfigurerat. Lägg till Stripe-nycklar i Vercel innan köp kan tas betalt.';
      return;
    }

    checkoutStripe = window.Stripe(data.publishableKey);
    checkoutElements = checkoutStripe.elements({
      clientSecret: data.clientSecret,
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary: '#0b0c0c',
          colorText: '#0b0c0c',
          colorBackground: '#fffdfa',
          borderRadius: '8px',
          fontFamily: 'Inter, system-ui, sans-serif',
        },
      },
    });

    const paymentElement = checkoutElements.create('payment', {
      fields: {
        billingDetails: {
          email: 'never',
        },
      },
    });
    const walletShell = document.querySelector('[data-checkout-wallets]');
    const walletMount = document.querySelector('#express-checkout-element');
    if (walletShell && walletMount) {
      walletShell.hidden = true;
      walletMount.innerHTML = '';
      const expressCheckoutElement = checkoutElements.create('expressCheckout', {
        paymentMethods: {
          applePay: 'always',
          googlePay: 'always',
          link: 'never',
        },
        paymentMethodOrder: ['applePay', 'googlePay'],
        buttonType: {
          applePay: 'check-out',
          googlePay: 'checkout',
        },
        buttonTheme: {
          applePay: 'white-outline',
        },
        buttonHeight: 50,
        layout: {
          maxColumns: 1,
          maxRows: 2,
        },
      });
      expressCheckoutElement.on('ready', (event) => {
        const methods = event && event.availablePaymentMethods ? event.availablePaymentMethods : {};
        walletShell.hidden = !Object.keys(methods).some((key) => Boolean(methods[key]));
      });
      expressCheckoutElement.on('confirm', async () => {
        if (payButton) {
          payButton.disabled = true;
          payButton.textContent = 'Bekräftar...';
        }
        if (message) message.textContent = '';
        const result = await confirmCheckoutStripePayment();
        await finishCheckoutStripePayment(result);
      });
      expressCheckoutElement.mount('#express-checkout-element');
    }
    paymentElement.mount('#payment-element');
    checkoutPaymentReady = true;
    if (payButton) payButton.disabled = false;
    if (message) message.textContent = '';
  } catch (error) {
    if (message) message.textContent = error.message || 'Kunde inte starta betalning.';
  }
}

async function completeCheckoutOrder(paymentIntentId) {
  const message = document.querySelector('[data-checkout-confirmation-message], [data-checkout-payment-message]');
  const draft = readCheckoutDraft();

  if (!paymentIntentId) {
    if (message) message.textContent = 'Betalningsreferens saknas.';
    return null;
  }

  if (message) message.textContent = 'Bekräftar din order...';

  try {
    const { response, data } = await postJson('/api/checkout', {
      action: 'complete',
      paymentIntentId,
      items: checkoutItemsPayload(),
      discountCode: readDiscountCode(),
      contact: draft.contact,
      shippingAddress: draft.shippingAddress,
    });

    if (!response.ok) {
      throw new Error(data.error || 'Kunde inte skapa order.');
    }

    writeLastOrder(data.order);
    clearCart();
    localStorage.removeItem(CHECKOUT_DRAFT_KEY);
    renderCheckoutConfirmation(data.order);
    return data.order;
  } catch (error) {
    if (message) message.textContent = error.message || 'Kunde inte bekräfta ordern.';
    return null;
  }
}

function renderCheckoutConfirmation(order = readLastOrder()) {
  const paymentIntentFromUrl = pageParams.get('payment_intent');

  if (!order && paymentIntentFromUrl) {
    fetch(`/api/checkout?action=orders&payment_intent=${encodeURIComponent(paymentIntentFromUrl)}`, { credentials: 'same-origin' })
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (response.ok && data.order) {
          writeLastOrder(data.order);
          renderCheckoutConfirmation(data.order);
        } else {
          completeCheckoutOrder(paymentIntentFromUrl);
        }
      })
      .catch(() => completeCheckoutOrder(paymentIntentFromUrl));
    return;
  }

  if (!order && checkoutPaymentIntentId) {
    completeCheckoutOrder(checkoutPaymentIntentId);
    return;
  }

  if (!order) {
    const message = document.querySelector('[data-checkout-confirmation-message]');
    if (message) message.textContent = 'Vi hittar ingen order ännu. Ladda om sidan om betalningen precis blev klar.';
    return;
  }

  setText('[data-confirmation-email]', `En orderbekräftelse har skickats till ${order.email || 'din e-post'}`);
  setText('[data-confirmation-order-number]', order.order_number || order.id || '#V000000');
}

function initCheckoutPage(session = accountSession) {
  const page = document.querySelector('[data-checkout-page]');

  if (!page) {
    return;
  }

  const cart = readCart();
  const step = currentCheckoutStep();

  if (!cart.length && step !== 'bekraftelse') {
    window.location.href = '/kundvagn';
    return;
  }

  setCheckoutStep(step);
  setCheckoutPaymentLocked(false);

  const draft = readCheckoutDraft();
  const customer = session && session.customer ? session.customer : {};
  const contactForm = document.querySelector('[data-checkout-contact-form]');
  const shippingForm = document.querySelector('[data-checkout-shipping-form]');

  fillForm(contactForm, {
    email: draft.contact && draft.contact.email,
    phone: draft.contact && draft.contact.phone,
  });
  fillForm(contactForm, {
    email: customer.email,
  });
  fillForm(shippingForm, {
    ...(draft.shippingAddress || {}),
    firstName: (draft.shippingAddress && draft.shippingAddress.firstName) || customer.firstName,
    lastName: (draft.shippingAddress && draft.shippingAddress.lastName) || customer.lastName,
    country: (draft.shippingAddress && draft.shippingAddress.country) || 'Sverige',
  });

  if (step === 'betalning') {
    renderCheckoutSummary();
    setupCheckoutPayment();
  }

  if (step === 'bekraftelse') {
    renderCheckoutConfirmation();
  }
}

const checkoutContactForm = document.querySelector('[data-checkout-contact-form]');

if (checkoutContactForm) {
  checkoutContactForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = formValues(checkoutContactForm);
    writeCheckoutDraft({
      contact: {
        email: values.email,
        phone: values.phone,
      },
    });
    trackAbandonedCheckout('Kontaktuppgifter sparade').catch(() => {});
    goCheckoutStep('leverans');
  });
}

const checkoutShippingForm = document.querySelector('[data-checkout-shipping-form]');

if (checkoutShippingForm) {
  checkoutShippingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = formValues(checkoutShippingForm);
    writeCheckoutDraft({
      shippingAddress: {
        firstName: values.firstName,
        lastName: values.lastName,
        address1: values.address1,
        address2: values.address2,
        postalCode: values.postalCode,
        city: values.city,
        country: values.country || 'Sverige',
        alternateAddress: Boolean(values.alternateAddress),
      },
    });
    trackAbandonedCheckout('Leveransadress sparad').catch(() => {});
    goCheckoutStep('betalning');
  });
}

const checkoutPayButton = document.querySelector('[data-checkout-pay-button]');

if (checkoutPayButton) {
  checkoutPayButton.addEventListener('click', async () => {
    const message = document.querySelector('[data-checkout-payment-message]');

    if (checkoutFreeCheckout) {
      checkoutPayButton.disabled = true;
      checkoutPayButton.textContent = 'Skapar order...';
      const order = await completeCheckoutOrder(checkoutPaymentIntentId);

      if (order) {
        window.location.href = `/checkout?step=bekraftelse&order=${encodeURIComponent(order.id)}`;
      } else {
        checkoutPayButton.disabled = false;
        checkoutPayButton.textContent = 'Slutför gratis order';
      }
      return;
    }

    if (!checkoutStripe || !checkoutElements) {
      if (message) message.textContent = 'Betalningen är inte redo ännu.';
      return;
    }

    checkoutPayButton.disabled = true;
    checkoutPayButton.textContent = 'Bekräftar...';
    if (message) message.textContent = '';

    const result = await confirmCheckoutStripePayment();
    await finishCheckoutStripePayment(result);
  });
}

function renderOrders(orders) {
  const list = document.querySelector('[data-orders-list]');

  if (!list) {
    return;
  }

  if (!orders || !orders.length) {
    list.innerHTML = '<span>Inga ordrar ännu</span><p>Dina köp visas här efter första checkout.</p>';
    return;
  }

  const latestOrder = [...orders].sort((a, b) => orderTime(b) - orderTime(a))[0];
  const orderDate = formatDate(latestOrder.processedAt || latestOrder.createdAt) || '';

  list.innerHTML = `
    <div class="order-row">
      <strong>${escapeHtml(latestOrder.name)}</strong>
      <span>${escapeHtml(latestOrder.total || '')}</span>
      <small>${escapeHtml(orderDate)}</small>
      <p>${escapeHtml((latestOrder.items || []).join(', '))}</p>
      ${latestOrder.statusUrl ? `<a href="${escapeHtml(latestOrder.statusUrl)}" target="_blank" rel="noreferrer">Visa order</a>` : ''}
    </div>
    <a class="account-order-link" href="/order"><span>Se alla ordrar</span><i aria-hidden="true"></i></a>
  `;
}

async function renderStoredOrders(existingOrders = []) {
  const list = document.querySelector('[data-orders-list]');

  if (!list || !accountSession || !accountSession.authenticated) {
    return;
  }

  try {
    const response = await fetch('/api/checkout?action=orders', { credentials: 'same-origin' });
    const data = await response.json();

    if (!response.ok || !Array.isArray(data.orders) || !data.orders.length) {
      return;
    }

    const storedOrders = data.orders.map((order) => ({
      id: order.id,
      name: order.order_number || order.id,
      processedAt: order.created_at,
      statusUrl: '',
      orderStatus: order.order_status || 'pending',
      trackingUrl: order.tracking_url || '',
      trackingNumber: order.tracking_number || '',
      total: order.summary && order.summary.total ? order.summary.total : formatSek((Number(order.total) || 0) / 100),
      items: (order.items || []).map((item) => `${item.quantity} x ${item.title}`),
    }));
    const merged = [...storedOrders, ...(existingOrders || [])]
      .filter((order, index, listItems) => listItems.findIndex((item) => (item.id || item.name) === (order.id || order.name)) === index);

    renderOrders(merged);
  } catch (error) {
    // Shopify orders remain visible if the internal order store is unavailable.
  }
}

function orderTime(order) {
  const value = order && (order.processedAt || order.createdAt);
  const time = value ? new Date(value).getTime() : 0;

  return Number.isNaN(time) ? 0 : time;
}

function pendingCheckoutTime(pending) {
  const time = pending && pending.startedAt ? new Date(pending.startedAt).getTime() : 0;

  return Number.isNaN(time) ? 0 : time;
}

function updateMemberStatus(session = accountSession) {
  syncThemeFromProfile(session);
  applyGlobalSessionUi(session);
  syncShoppingAccess();

  const status = document.querySelector('[data-member-status]');

  if (!status) {
    renderSettingsPage(session);
    renderPaymentUpdatePage(session);
    return;
  }

  const accountFlow = document.querySelector('[data-account-flow]');
  const authCard = document.querySelector('[data-auth-card]');
  const statusCard = document.querySelector('[data-status-card]');
  const ordersCard = document.querySelector('[data-orders-card]');
  const email = document.querySelector('[data-account-email]');
  const logoutButtons = document.querySelectorAll('[data-logout-button]');
  const membershipLink = document.querySelector('[data-membership-link]');
  const settingsLink = document.querySelector('[data-settings-link]');
  const greeting = document.querySelector('[data-account-greeting]');
  const summary = document.querySelector('[data-account-summary]');
  const memberNote = document.querySelector('[data-member-note]');
  const dashboardMembership = document.querySelector('[data-dashboard-membership]');
  const dashboardDiscount = document.querySelector('[data-dashboard-discount]');
  const dashboardOrders = document.querySelector('[data-dashboard-orders]');
  const dashboardPoints = document.querySelector('[data-dashboard-points]');
  const dashboardRenewal = document.querySelector('[data-dashboard-renewal]');

  if (!session || !session.authenticated) {
    status.textContent = 'Ej inloggad';
    status.classList.remove('is-active');
    if (authCard) authCard.hidden = true;
    if (statusCard) statusCard.hidden = true;
    if (ordersCard) ordersCard.hidden = true;
    if (accountFlow) accountFlow.hidden = true;
    if (!verificationToken && !resetToken) {
      showAccountAuthMode(accountAuthMode);
    }
    if (resetCard) resetCard.hidden = !resetToken;
    if (email) email.textContent = 'Logga in för att se kontot.';
    logoutButtons.forEach((button) => {
      button.hidden = true;
    });
    if (membershipLink) membershipLink.hidden = true;
    if (settingsLink) settingsLink.hidden = true;
    renderOrders([]);
    renderSettingsPage(session);
    renderPaymentUpdatePage(session);
    return;
  }

  const firstName = session.customer.firstName || (session.customer.displayName || '').split(' ')[0] || 'där';
  const orderCount = Number(session.customer.numberOfOrders || 0);
  const hasMemberDiscount = Boolean(session.customer.member);
  const membership = session.customer.membership || {};
  const nextDate = formatDate(membership.activeUntil || membership.nextChargeScheduledAt);

  if (accountFlow) accountFlow.hidden = true;
  if (authCard) authCard.hidden = false;
  if (statusCard) statusCard.hidden = false;
  if (ordersCard) ordersCard.hidden = false;
  if (loginCard) loginCard.hidden = true;
  if (createCard) createCard.hidden = true;
  if (resetCard) resetCard.hidden = true;

  status.textContent = hasMemberDiscount ? 'Aktivt medlemskap' : 'Konto aktivt';
  status.classList.toggle('is-active', hasMemberDiscount);
  if (greeting) greeting.textContent = `Hej ${firstName}`;
  if (summary) summary.textContent = `Inloggad som ${session.customer.email}.`;
  if (email) email.textContent = session.customer.email;
  if (memberNote) {
    memberNote.textContent = hasMemberDiscount
      ? (membership.cancellationRequested
        ? `Medlemskapet är aktivt till ${nextDate || 'sista perioden'} och förnyas inte efter det.`
        : `Medlemspriser, poäng och checkout är upplåsta.${nextDate ? ` Nästa förnyelse ${nextDate}.` : ''}`)
      : 'Kontot är klart. Starta medlemskap för att låsa upp checkout, poäng och medlemspriser.';
  }
  if (dashboardMembership) dashboardMembership.textContent = hasMemberDiscount
    ? (membership.cancellationRequested ? 'Aktivt till slutdatum' : 'Aktivt')
    : 'Ej aktivt';
  if (dashboardDiscount) dashboardDiscount.textContent = hasMemberDiscount ? 'Upplåsta' : 'Låsta';
  if (dashboardOrders) dashboardOrders.textContent = String(orderCount);
  if (dashboardPoints) dashboardPoints.textContent = String(session.customer.points || 0);
  if (dashboardRenewal) dashboardRenewal.textContent = hasMemberDiscount
    ? (nextDate || 'Aktivt')
    : 'Ej aktivt';
  showPointsIntroIfNeeded(session);
  logoutButtons.forEach((button) => {
    button.hidden = false;
  });
  if (membershipLink) membershipLink.hidden = hasMemberDiscount;
  if (settingsLink) settingsLink.hidden = false;
  renderOrders(session.customer.orders);
  renderStoredOrders(session.customer.orders);
  renderSettingsPage(session);
  renderPaymentUpdatePage(session);
}

function showPointsIntroIfNeeded(session) {
  if (!document.querySelector('[data-dashboard-points]') || !session || !session.customer) {
    return;
  }

  const email = session.customer.email || '';
  const storageKey = `${POINTS_INTRO_KEY}:${email}`;

  if (!session.customer.member || localStorage.getItem(storageKey) === '1') {
    return;
  }

  localStorage.setItem(storageKey, '1');

  const modal = document.createElement('div');
  modal.className = 'points-popover';
  modal.innerHTML = `
    <div class="points-popover-card">
      <span>Versen poäng</span>
      <h2>Poäng blir extra rabatt och inflytande</h2>
      <p>Varje krona du handlar för ger 2 poäng. Poängen kan växlas mot extra rabatt ovanpå medlemspriserna, och ju mer du samlar desto mer väger dina produktförslag inför kommande drops.</p>
      <button class="product-btn" type="button">Jag fattar</button>
    </div>
  `;

  document.body.appendChild(modal);
  window.setTimeout(() => modal.classList.add('show'), 50);
  modal.querySelector('button')?.addEventListener('click', () => {
    modal.classList.remove('show');
    window.setTimeout(() => modal.remove(), 240);
  });
}

function renderSettingsPage(session = accountSession) {
  const shell = document.querySelector('[data-settings-page]');

  if (!shell) {
    return;
  }

  const status = document.querySelector('[data-settings-membership-status]');
  const cancelButton = document.querySelector('[data-cancel-membership]');
  const message = document.querySelector('[data-settings-message]');
  const member = isActiveMember(session);
  const membership = session && session.customer && session.customer.membership ? session.customer.membership : {};
  const date = formatDate(membership.activeUntil || membership.nextChargeScheduledAt);

  if (!session || !session.authenticated) {
    if (status) {
      status.innerHTML = `
        <span>Inte inloggad</span>
        <strong>Logga in för medlemsinställningar</strong>
        <p>Logga in för att se och hantera ditt medlemskap.</p>
      `;
    }
    if (cancelButton) cancelButton.hidden = true;
    return;
  }

  if (status) {
    status.innerHTML = member
      ? `
        <span>${membership.cancellationRequested ? 'Avslutas' : 'Aktivt medlemskap'}</span>
        <strong>${membership.cancellationRequested ? `Aktivt till ${date || 'sista perioden'}` : (date ? `Förnyas ${date}` : 'Aktivt')}</strong>
        <p>${membership.cancellationRequested ? 'Du behåller medlemspriserna till slutdatumet. Ingen ny dragning görs.' : 'Medlemspriser, poäng och checkout är aktiva.'}</p>
      `
      : `
        <span>Ej aktivt</span>
        <strong>Inget medlemskap</strong>
        <p>Starta medlemskap för att låsa upp produkter, poäng och checkout.</p>
      `;
  }

  if (cancelButton) {
    cancelButton.hidden = !member || Boolean(membership.cancellationRequested);
  }

  if (message && membership.cancellationRequested) {
    message.textContent = `Prenumerationen är avslutad. Access ligger kvar till ${date || 'sista perioden'}.`;
  }
}

function renderPaymentUpdatePage(session = accountSession) {
  const shell = document.querySelector('[data-payment-update-page]');

  if (!shell) {
    return;
  }

  const status = document.querySelector('[data-payment-update-status]');
  const button = document.querySelector('[data-update-payment-button]');
  const loginLink = document.querySelector('[data-payment-update-login]');
  const message = document.querySelector('[data-payment-update-message]');
  const membership = session && session.customer && session.customer.membership ? session.customer.membership : {};
  const date = formatDate(membership.activeUntil || membership.nextChargeScheduledAt);

  if (!session || !session.authenticated) {
    if (status) {
      status.innerHTML = `
        <span>Inloggning krävs</span>
        <strong>Logga in för att uppdatera kortet</strong>
        <p>Vi behöver koppla betalningen till ditt Versen-konto innan Stripe öppnas.</p>
      `;
    }
    if (button) button.hidden = true;
    if (loginLink) loginLink.hidden = false;
    if (message) message.textContent = '';
    return;
  }

  if (status) {
    status.innerHTML = `
      <span>${membership.status || 'Medlemskap'}</span>
      <strong>${date ? `Förnyas ${date}` : 'Stripe-prenumeration'}</strong>
      <p>Öppna Stripes säkra portal för att byta kort, genomföra betalning eller uppdatera fakturauppgifter.</p>
    `;
  }
  if (button) button.hidden = false;
  if (loginLink) loginLink.hidden = true;
}

function showAccountExpressMembership() {
  const expressMembership = document.querySelector('[data-account-express-membership]');

  if (!expressMembership) {
    window.location.href = '/medlemskap?return=checkout&step=betalning';
    return;
  }

  document.querySelectorAll('[data-auth-card], [data-status-card], [data-orders-card], [data-login-card], [data-create-card], [data-reset-card]').forEach((element) => {
    element.hidden = true;
  });
  expressMembership.hidden = false;
  document.body.classList.add('is-authenticated', 'account-express-active');
  setText('[data-account-hero-title]', 'Välj medlemskap');
  setText('[data-account-hero-copy]', '');
  expressMembership.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function completeAccountIntent(options = {}) {
  if (accountNext === 'liked') {
    window.location.href = '/gillar';
  } else if (accountCheckoutIntent) {
    if (isActiveMember()) {
      window.location.href = membershipReturnTarget();
    } else if (options.inlineMembership) {
      showAccountExpressMembership();
    } else {
      window.location.href = '/medlemskap?return=checkout&step=betalning';
    }
  } else if (isActiveMember()) {
    window.location.href = '/';
  } else if (accountNext === 'membership' || verificationToken) {
    window.location.href = '/medlemskap?ready=1';
  } else {
    window.location.href = '/medlemskap?ready=1';
  }
}

async function refreshAccount() {
  try {
    const response = await fetch('/api/account', { credentials: 'same-origin' });
    accountSession = await response.json();
    mergeProfileLikes(accountSession);
    logVisit(accountSession);
    updateMemberStatus(accountSession);
    renderLikedPage();
    renderOrderPage(accountSession);
    renderMembershipActivation(accountSession);
    initCheckoutPage(accountSession);
  } catch (error) {
    accountSession = { authenticated: false };
    updateMemberStatus(accountSession);
    renderLikedPage();
    renderOrderPage(accountSession);
    renderMembershipActivation(accountSession);
    initCheckoutPage(accountSession);
  } finally {
    document.body.classList.remove('auth-loading');
    adjustAccountScroll(accountSession);
  }
}

function renderMembershipActivation(session = accountSession) {
  const shell = document.querySelector('[data-membership-activation]');

  if (!shell) {
    return;
  }

  const pending = readPendingCheckout();
  const member = isActiveMember(session);
  const firstName = session && session.authenticated && session.customer
    ? (session.customer.firstName || (session.customer.displayName || '').split(' ')[0] || '')
    : '';
  const seenReveal = localStorage.getItem(MEMBERSHIP_REVEAL_KEY) === '1';
  const title = document.querySelector('[data-activation-title]');
  const copy = document.querySelector('[data-activation-copy]');
  const badge = document.querySelector('[data-activation-badge]');
  const status = document.querySelector('[data-activation-status]');
  const actions = document.querySelector('[data-activation-actions]');

  shell.classList.toggle('is-unlocked', member);
  shell.classList.toggle('is-waiting', !member);
  shell.classList.toggle('has-seen-reveal', seenReveal);

  if (member) {
    clearPendingCheckout();
    const returnTarget = membershipReturnTarget();
    const returningToCheckout = returnTarget.startsWith('/checkout');
    if (badge) badge.textContent = seenReveal ? 'Medlemskap aktivt' : 'Välkommen in';
    if (title) title.textContent = seenReveal ? 'Du är medlem' : `Medlemskap aktiverat${firstName ? `, ${firstName}` : ''}`;
    if (copy) {
      copy.textContent = returningToCheckout
        ? 'Ditt medlemskap är aktivt. Fortsätt där du var och slutför produktköpet.'
        : (seenReveal
          ? 'Butiken är upplåst. Dina medlemspriser är redo när du vill handla.'
          : 'Dina medlemspriser är upplåsta. Tryck på knappen och öppna butiken med full access.');
    }
    if (status) {
      status.innerHTML = `
        <span>Access</span>
        <strong>Aktiv medlem</strong>
        <p>Rabatter, produktcheckout och medlemspriser är nu öppna.</p>
      `;
    }
    if (actions) {
      actions.innerHTML = `
        <button class="cta activation-unlock" type="button" data-unlock-store>${returningToCheckout ? 'Fortsätt checkout' : 'Börja handla'}</button>
        <a class="product-btn secondary" href="/konto">Se mitt konto</a>
      `;
    }
    if (!seenReveal) {
      window.setTimeout(() => {
        localStorage.setItem(MEMBERSHIP_REVEAL_KEY, '1');
      }, 2400);
    }
    return;
  }

  if (badge) badge.textContent = 'Väntar på betalning';
  if (title) title.textContent = 'Slutför medlemskapet';
  if (copy) {
    copy.textContent = pending
      ? 'När betalningen är klar aktiveras medlemskapet här automatiskt.'
      : 'Vi hittar ingen aktiv medlemscheckout. Starta medlemskapet igen om du inte kom vidare.';
  }
  if (status) {
    status.innerHTML = `
      <span>Status</span>
      <strong>${pending ? 'Väntar på bekräftelse' : 'Ingen aktiv checkout'}</strong>
      <p>${pending ? 'Det kan ta några sekunder. Den här sidan uppdateras av sig själv.' : 'Gå tillbaka till medlemskap och starta checkout när du är redo.'}</p>
    `;
  }
  if (actions) {
    actions.innerHTML = `
      <button class="product-btn" type="button" data-refresh-membership>Kontrollera igen</button>
      <a class="product-btn secondary" href="/medlemskap">Till medlemskap</a>
    `;
  }
}

const loginForm = document.querySelector('[data-login-form]');

if (loginForm) {
  const message = document.querySelector('[data-login-message]');

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    if (message) message.textContent = 'Loggar in...';

    try {
      const { response, data } = await postJson('/api/account', {
        action: 'login',
        email: formData.get('email'),
        password: formData.get('password'),
      });

      if (!response.ok) {
        if (message) message.textContent = data.error || 'Kunde inte logga in.';
        return;
      }

      accountSession = data;
      updateMemberStatus(accountSession);
      queueLikedSync();
      if (message) message.textContent = 'Du är inloggad.';
      completeAccountIntent();
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
    }
  });
}

const verificationForm = document.querySelector('[data-verification-form]');
const registerForm = document.querySelector('[data-register-form]');
const resetForm = document.querySelector('[data-reset-form]');
const loginCard = document.querySelector('[data-login-card]');
const createCard = document.querySelector('[data-create-card]');
const resetCard = document.querySelector('[data-reset-card]');
let accountAuthMode = 'create';

function showAccountAuthMode(mode = 'create') {
  accountAuthMode = mode === 'login' ? 'login' : 'create';

  if (createCard && !verificationToken && !resetToken) {
    createCard.hidden = false;
  }

  if (loginCard && !resetToken) {
    loginCard.hidden = false;
  }

}

document.querySelector('[data-show-login]')?.addEventListener('click', () => showAccountAuthMode('login'));
document.querySelector('[data-show-create]')?.addEventListener('click', () => showAccountAuthMode('create'));

if (!verificationToken && !resetToken) {
  showAccountAuthMode(accountNext === 'membership' ? 'create' : 'create');
}

function setAccountFlowStep(activeStep) {
  document.querySelectorAll('[data-account-flow] .flow-step').forEach((step, index) => {
    const current = index + 1;
    step.classList.toggle('active', current === activeStep);
    step.classList.toggle('done', current < activeStep);
  });
}

if (accountNext === 'membership' && createCard) {
  createCard.classList.add('is-priority');
  if (loginCard && !verificationToken && !resetToken) loginCard.hidden = false;
}

if (verificationToken && registerForm) {
  const message = document.querySelector('[data-register-message]');
  registerForm.hidden = false;
  if (verificationForm) verificationForm.hidden = true;
  if (loginCard) loginCard.hidden = true;
  if (createCard) createCard.classList.add('is-priority');
  setAccountFlowStep(2);
  setText('[data-account-hero-title]', 'Skapa lösenord');
  setText('[data-account-hero-copy]', 'Emailen är verifierad. Välj ett lösenord med minst 8 tecken, så skickas du vidare för att starta medlemskapet.');
  const createTitle = createCard && createCard.querySelector('h2');
  const createCopy = createCard && createCard.querySelector('p');
  const submit = registerForm.querySelector('button');
  if (createTitle) createTitle.textContent = 'Skriv in lösenord';
  if (createCopy) createCopy.textContent = 'Fyll i ett lösenord för ditt konto, minst 8 tecken. Efter det öppnas medlemskapssidan.';
  if (submit) submit.textContent = 'Fortsätt till medlemskap';
  if (message) message.textContent = 'Email verifierad. Välj lösenord för att skapa kontot.';
}

if (resetToken && resetForm) {
  const message = document.querySelector('[data-reset-message]');
  const accountFlow = document.querySelector('[data-account-flow]');
  resetForm.hidden = false;
  if (loginCard) loginCard.hidden = true;
  if (createCard) createCard.hidden = true;
  if (resetCard) resetCard.hidden = false;
  if (accountFlow) accountFlow.hidden = true;
  if (message) message.textContent = 'Välj ett nytt lösenord för ditt konto.';
}

if (verificationForm) {
  const message = document.querySelector('[data-register-message]');

  verificationForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(verificationForm);
    if (message) message.textContent = 'Skickar verifieringsmail...';

    try {
      const { response, data } = await postJson('/api/account', {
        action: 'start_verification',
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        email: formData.get('email'),
        next: accountNext,
      });

      if (!response.ok) {
        if (message) message.textContent = data.error || 'Kunde inte skicka verifieringsmail.';
        return;
      }

      if (message) message.textContent = data.status || 'Verifieringsmail skickat. Kontrollera inkorgen och skräppost.';
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
    }
  });
}

if (registerForm) {
  const message = document.querySelector('[data-register-message]');

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(registerForm);
    if (message) message.textContent = 'Skapar konto...';

    try {
      const { response, data } = await postJson('/api/account', {
        action: 'create_verified',
        verificationToken,
        password: formData.get('password'),
      });

      if (!response.ok) {
        if (message) message.textContent = data.error || 'Kunde inte skapa konto.';
        return;
      }

      accountSession = data;
      updateMemberStatus(accountSession);
      queueLikedSync();
      if (message) message.textContent = 'Kontot är skapat och du är inloggad.';
      completeAccountIntent({ inlineMembership: accountCheckoutIntent });
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
    }
  });
}

if (resetForm) {
  const message = document.querySelector('[data-reset-message]');

  resetForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(resetForm);
    if (message) message.textContent = 'Uppdaterar lösenord...';

    try {
      const { response, data } = await postJson('/api/account', {
        action: 'reset_password',
        resetToken,
        password: formData.get('password'),
      });

      if (!response.ok) {
        if (message) message.textContent = data.error || 'Kunde inte uppdatera lösenord.';
        return;
      }

      accountSession = data;
      updateMemberStatus(accountSession);
      if (message) message.textContent = 'Lösenordet är uppdaterat och du är inloggad.';
      completeAccountIntent();
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
    }
  });
}

const likedAuthModal = document.querySelector('[data-liked-auth-modal]');

function setLikedAuthMode(mode = 'login') {
  const loginPanel = document.querySelector('[data-liked-login-panel]');
  const createPanel = document.querySelector('[data-liked-create-panel]');
  if (loginPanel) loginPanel.hidden = mode !== 'login';
  if (createPanel) createPanel.hidden = mode !== 'create';
}

document.querySelector('[data-liked-login-open]')?.addEventListener('click', () => {
  setLikedAuthMode('login');
  if (likedAuthModal) likedAuthModal.hidden = false;
});

document.querySelectorAll('[data-liked-auth-close]').forEach((button) => {
  button.addEventListener('click', () => {
    if (likedAuthModal) likedAuthModal.hidden = true;
  });
});

document.querySelector('[data-liked-show-create]')?.addEventListener('click', () => setLikedAuthMode('create'));
document.querySelector('[data-liked-show-login]')?.addEventListener('click', () => setLikedAuthMode('login'));

const likedLoginForm = document.querySelector('[data-liked-login-form]');

if (likedLoginForm) {
  likedLoginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.querySelector('[data-liked-login-message]');
    const formData = new FormData(likedLoginForm);
    if (message) message.textContent = 'Loggar in...';

    try {
      const { response, data } = await postJson('/api/account', {
        action: 'login',
        email: formData.get('email'),
        password: formData.get('password'),
      });

      if (!response.ok) {
        if (message) message.textContent = data.error || 'Kunde inte logga in.';
        return;
      }

      accountSession = data;
      updateMemberStatus(accountSession);
      queueLikedSync();
      renderLikedPage();
      if (likedAuthModal) likedAuthModal.hidden = true;
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
    }
  });
}

const likedVerificationForm = document.querySelector('[data-liked-verification-form]');

if (likedVerificationForm) {
  likedVerificationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.querySelector('[data-liked-register-message]');
    const formData = new FormData(likedVerificationForm);
    if (message) message.textContent = 'Skickar verifieringsmail...';

    try {
      const { response, data } = await postJson('/api/account', {
        action: 'start_verification',
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        email: formData.get('email'),
        next: 'liked',
      });

      if (!response.ok) {
        if (message) message.textContent = data.error || 'Kunde inte skicka verifieringsmail.';
        return;
      }

      if (message) message.textContent = data.status || 'Verifieringsmail skickat. Gillade sparas på kontot när du loggar in.';
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
    }
  });
}

const recoverButton = document.querySelector('[data-recover-button]');

if (recoverButton) {
  recoverButton.addEventListener('click', async () => {
    const message = document.querySelector('[data-login-message]');
    const email = document.querySelector('[data-login-form] input[name="email"]');

    if (!email || !email.value) {
      if (message) message.textContent = 'Fyll i email först.';
      return;
    }

    try {
      const { data } = await postJson('/api/account', {
        action: 'recover',
        email: email.value,
      });
      if (message) message.textContent = data.status || data.error || 'Klart.';
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
    }
  });
}

const contactForm = document.querySelector('[data-contact-form]');

if (contactForm) {
  const message = document.querySelector('[data-contact-message]');

  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(contactForm);
    if (message) message.textContent = 'Skickar ärendet...';

    try {
      const { response, data } = await postJson('/api/account', {
        action: 'contact',
        name: formData.get('name'),
        email: formData.get('email'),
        topic: formData.get('topic'),
        order: formData.get('order'),
        message: formData.get('message'),
      });

      if (!response.ok) {
        if (message) message.textContent = data.error || 'Kunde inte skicka ärendet.';
        return;
      }

      contactForm.reset();
      if (message) message.textContent = data.status || 'Meddelandet är skickat.';
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
    }
  });
}

document.querySelectorAll('[data-logout-button]').forEach((logoutButton) => {
  logoutButton.addEventListener('click', async () => {
    await postJson('/api/account', { action: 'logout' });
    accountSession = { authenticated: false };
    updateMemberStatus(accountSession);
  });
});

document.querySelectorAll('[data-theme-option]').forEach((button) => {
  button.addEventListener('click', async () => {
    setThemePreference(button.dataset.themeOption);
    const message = document.querySelector('[data-settings-message]');

    if (message) {
      message.textContent = button.dataset.themeOption === 'auto'
        ? 'Theme följer enhetens inställning.'
        : `Theme sparat som ${button.dataset.themeOption === 'light' ? 'ljust' : 'mörkt'}.`;
    }
  });
});

applyTheme();

function showConfirmDialog({ title, message, confirmText, cancelText }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'versen-dialog-backdrop';
    backdrop.innerHTML = `
      <div class="versen-dialog" role="dialog" aria-modal="true" aria-labelledby="versen-dialog-title">
        <h2 id="versen-dialog-title">${title}</h2>
        <p>${message}</p>
        <div class="versen-dialog-actions">
          <button class="product-btn danger-action" type="button" data-dialog-confirm>${confirmText}</button>
          <button class="product-btn secondary" type="button" data-dialog-cancel>${cancelText}</button>
        </div>
      </div>
    `;

    const close = (result) => {
      backdrop.classList.remove('show');
      window.setTimeout(() => {
        backdrop.remove();
        resolve(result);
      }, 180);
    };

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(false);
    });
    backdrop.querySelector('[data-dialog-confirm]')?.addEventListener('click', () => close(true));
    backdrop.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => close(false));
    document.body.appendChild(backdrop);
    window.setTimeout(() => backdrop.classList.add('show'), 20);
  });
}

const cancelMembershipButton = document.querySelector('[data-cancel-membership]');

if (cancelMembershipButton) {
  cancelMembershipButton.addEventListener('click', async () => {
    const message = document.querySelector('[data-settings-message]');
    const confirmed = await showConfirmDialog({
      title: 'Avsluta medlemskap?',
      message: 'Vi vill inte se dig gå, är du säker på att du vill avsluta ditt medlemskap?',
      confirmText: 'Avsluta medlemskap',
      cancelText: 'Jag ångrar mig',
    });

    if (!confirmed) {
      return;
    }

    cancelMembershipButton.disabled = true;
    cancelMembershipButton.textContent = 'Avslutar...';
    if (message) message.textContent = 'Avslutar prenumerationen...';

    try {
      const { response, data } = await postJson('/api/account', {
        action: 'cancel_membership',
      });

      if (!response.ok) {
        if (message) message.textContent = data.error || 'Kunde inte avsluta prenumerationen.';
        cancelMembershipButton.disabled = false;
        cancelMembershipButton.textContent = 'Avsluta prenumeration';
        return;
      }

      accountSession = data.session || accountSession;
      updateMemberStatus(accountSession);
      if (message) {
        const date = formatDate(data.activeUntil);
        message.textContent = date
          ? `Prenumerationen är avslutad. Medlemskapet gäller till ${date}.`
          : (data.status || 'Prenumerationen är avslutad.');
      }
      cancelMembershipButton.textContent = 'Avslutad';
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
      cancelMembershipButton.disabled = false;
      cancelMembershipButton.textContent = 'Avsluta prenumeration';
    }
  });
}

const updatePaymentButton = document.querySelector('[data-update-payment-button]');

if (updatePaymentButton) {
  updatePaymentButton.addEventListener('click', async () => {
    const message = document.querySelector('[data-payment-update-message]');
    updatePaymentButton.disabled = true;
    updatePaymentButton.textContent = 'Öppnar Stripe...';
    if (message) message.textContent = 'Skapar säker betalningslänk...';

    try {
      const { response, data } = await postJson('/api/account', {
        action: 'create_billing_portal',
      });

      if (!response.ok || !data.url) {
        if (message) message.textContent = data.error || 'Kunde inte öppna Stripe just nu.';
        updatePaymentButton.disabled = false;
        updatePaymentButton.textContent = 'Uppdatera betalning';
        return;
      }

      window.location.href = data.url;
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
      updatePaymentButton.disabled = false;
      updatePaymentButton.textContent = 'Uppdatera betalning';
    }
  });
}

const membershipCheckoutButtons = document.querySelectorAll('[data-membership-checkout]');
let membershipStripe = null;
let membershipElements = null;
let membershipSubscriptionId = '';

if (membershipCheckoutButtons.length) {
  const message = document.querySelector('[data-membership-message]');
  const paymentPanel = document.querySelector('[data-membership-payment-panel]');
  const paymentForm = document.querySelector('[data-membership-payment-form]');
  const paymentMessage = document.querySelector('[data-membership-payment-message]');
  const paymentTitle = document.querySelector('[data-membership-payment-title]');
  const payButton = document.querySelector('[data-membership-pay-button]');
  const inviteCodeInput = document.querySelector('[data-membership-invite-code]');
  const inviteCodeShell = inviteCodeInput ? inviteCodeInput.closest('.membership-invite-code') : null;
  let selectedMembershipPlan = '';
  let appliedInviteCode = '';
  let membershipCheckoutRequestId = 0;

  refreshAccount().then(() => {
    if (pageParams.get('ready') === '1' && message) message.textContent = '';
  });

  function membershipBillingDetails() {
    return {
      email: accountSession && accountSession.customer ? accountSession.customer.email : undefined,
      name: accountSession && accountSession.customer ? accountSession.customer.displayName : undefined,
    };
  }

  async function confirmMembershipStripePayment() {
    return membershipStripe.confirmPayment({
      elements: membershipElements,
      confirmParams: {
        return_url: new URL(`/medlemskap-aktivt?checkout=medlemskap&subscription=${encodeURIComponent(membershipSubscriptionId)}`, window.location.href).href,
        payment_method_data: {
          billing_details: membershipBillingDetails(),
        },
      },
      redirect: 'if_required',
    });
  }

  function setMembershipPayLoading(loading) {
    if (!payButton) return;
    payButton.disabled = Boolean(loading);
    payButton.textContent = loading ? 'Bekräftar...' : 'Betala medlemskap';
  }

  async function finishMembershipStripePayment(result) {
    if (result.error) {
      if (paymentMessage) paymentMessage.textContent = result.error.message || 'Betalningen kunde inte genomföras.';
      setMembershipPayLoading(false);
      return;
    }

    if (paymentMessage) paymentMessage.textContent = 'Medlemskapet är betalt. Aktiverar kontot...';
    window.location.href = `/medlemskap-aktivt?checkout=medlemskap&subscription=${encodeURIComponent(membershipSubscriptionId)}`;
  }

  function normalizedInviteCode() {
    return inviteCodeInput ? inviteCodeInput.value.trim().replace(/\s+/g, '').toUpperCase() : '';
  }

  function setInviteCodeState(state, text = '') {
    if (!inviteCodeShell) return;
    inviteCodeShell.classList.toggle('is-valid', state === 'valid');
    inviteCodeShell.classList.toggle('is-invalid', state === 'invalid');
    inviteCodeShell.classList.toggle('is-checking', state === 'checking');
    const note = inviteCodeShell.querySelector('small');
    if (note) {
      note.textContent = text || 'Gäller månadsmedlemskap enligt kodens villkor.';
    }
  }

  function setInviteCodeVisible(visible) {
    if (inviteCodeShell) inviteCodeShell.hidden = !visible;
  }

  async function startMembershipCheckout(plan, options = {}) {
    const triggerButton = options.button || null;
    const shouldScroll = options.scroll !== false;
    const fromInviteCode = Boolean(options.fromInviteCode);

    if (!accountSession || !accountSession.authenticated) {
      window.location.href = pageParams.get('return') === 'checkout' ? '/konto?next=checkout' : '/konto?next=membership';
      return;
    }

    selectedMembershipPlan = plan || 'monthly';
    setInviteCodeVisible(selectedMembershipPlan === 'monthly');
    const inviteCode = selectedMembershipPlan === 'monthly' ? normalizedInviteCode() : '';

    if (fromInviteCode && !inviteCode) {
      setInviteCodeState('');
      return;
    }

    if (fromInviteCode && selectedMembershipPlan === 'monthly' && inviteCode === appliedInviteCode && membershipElements) {
      return;
    }

    const requestId = ++membershipCheckoutRequestId;

    if (triggerButton) {
      triggerButton.dataset.originalText = triggerButton.textContent;
      triggerButton.disabled = true;
      triggerButton.textContent = 'Förbereder...';
    }
    if (payButton) payButton.disabled = true;
    if (message) message.textContent = '';
    if (inviteCode) setInviteCodeState('checking', 'Kontrollerar inbjudningskod...');
    if (paymentMessage) paymentMessage.textContent = inviteCode ? 'Kontrollerar inbjudningskod...' : 'Startar säker medlemsbetalning...';
    if (paymentPanel && !fromInviteCode) {
      paymentPanel.hidden = false;
      if (shouldScroll) paymentPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (paymentTitle) {
      paymentTitle.textContent = selectedMembershipPlan === 'yearly' ? 'Versen årsmedlemskap' : 'Versen månadsmedlemskap';
    }

    try {
      const { response, data } = await postJson('/api/membership-checkout', { plan: selectedMembershipPlan, inviteCode });

      if (requestId !== membershipCheckoutRequestId) return;

      if (!response.ok) {
        appliedInviteCode = '';
        if (inviteCode) setInviteCodeState('invalid', data.error || 'Ogiltig inbjudningskod.');
        if (message) {
          message.textContent = data.loginRequired
            ? 'Skapa konto eller logga in på kontosidan först.'
            : (data.error || 'Kunde inte starta medlemskap.');
        }
        if (paymentMessage) paymentMessage.textContent = data.error || 'Ogiltig inbjudningskod.';
        return;
      }

      if (!data.publishableKey || !data.clientSecret || !window.Stripe) {
        if (paymentMessage) paymentMessage.textContent = 'Stripe är inte färdigkonfigurerat ännu.';
        return;
      }

      const currentElement = document.querySelector('#membership-payment-element');
      if (currentElement) currentElement.innerHTML = '';
      const walletShell = document.querySelector('[data-membership-wallets]');
      const walletMount = document.querySelector('#membership-express-checkout-element');
      if (walletShell) walletShell.hidden = true;
      if (walletMount) walletMount.innerHTML = '';
      if (paymentPanel) {
        const shouldRevealAndScroll = paymentPanel.hidden;
        paymentPanel.hidden = false;
        if (shouldScroll && shouldRevealAndScroll) requestAnimationFrame(() => paymentPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
      membershipSubscriptionId = data.subscriptionId;
      membershipStripe = window.Stripe(data.publishableKey);
      membershipElements = membershipStripe.elements({
        clientSecret: data.clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#0b0c0c',
            colorText: '#0b0c0c',
            colorBackground: '#fffdfa',
            borderRadius: '8px',
            fontFamily: 'Inter, system-ui, sans-serif',
          },
        },
      });
      if (walletShell && walletMount) {
        const expressCheckoutElement = membershipElements.create('expressCheckout', {
          paymentMethods: {
            applePay: 'always',
            googlePay: 'always',
            link: 'never',
          },
          paymentMethodOrder: ['applePay', 'googlePay'],
          buttonType: {
            applePay: 'check-out',
            googlePay: 'checkout',
          },
          buttonTheme: {
            applePay: 'white-outline',
          },
          buttonHeight: 50,
          layout: {
            maxColumns: 1,
            maxRows: 2,
          },
        });
        expressCheckoutElement.on('ready', (event) => {
          const methods = event && event.availablePaymentMethods ? event.availablePaymentMethods : {};
          walletShell.hidden = !Object.keys(methods).some((key) => Boolean(methods[key]));
        });
        expressCheckoutElement.on('confirm', async () => {
          setMembershipPayLoading(true);
          if (paymentMessage) paymentMessage.textContent = '';
          const result = await confirmMembershipStripePayment();
          await finishMembershipStripePayment(result);
        });
        expressCheckoutElement.mount('#membership-express-checkout-element');
      }
      const paymentElement = membershipElements.create('payment', {
        fields: {
          billingDetails: {
            email: 'never',
          },
        },
      });
      paymentElement.mount('#membership-payment-element');
      rememberCheckout('medlemskap', `stripe-subscription:${data.subscriptionId}`);
      appliedInviteCode = data.inviteDiscount ? inviteCode : '';
      if (payButton) payButton.disabled = false;
      if (data.inviteDiscount) setInviteCodeState('valid', `${data.inviteDiscount.label}.`);
      else setInviteCodeState('');
      if (paymentMessage) {
        paymentMessage.textContent = data.inviteDiscount
          ? `Inbjudningskoden ${data.inviteDiscount.code} är tillagd: ${data.inviteDiscount.label}.`
          : '';
      }
    } catch (error) {
      if (requestId !== membershipCheckoutRequestId) return;
      appliedInviteCode = '';
      if (inviteCode) setInviteCodeState('invalid', 'Kunde inte kontrollera koden.');
      if (message) message.textContent = inviteCode ? 'Kunde inte kontrollera inbjudningskoden.' : 'Kunde inte kontakta Stripe.';
      if (paymentMessage) paymentMessage.textContent = inviteCode ? 'Kunde inte kontrollera inbjudningskoden.' : 'Kunde inte kontakta Stripe.';
    } finally {
      if (triggerButton) {
        triggerButton.disabled = false;
        triggerButton.textContent = triggerButton.dataset.originalText || 'Bli medlem nu';
      }
    }
  }

  if (inviteCodeInput) {
    inviteCodeInput.addEventListener('input', () => {
      inviteCodeInput.value = inviteCodeInput.value.replace(/\s+/g, '').toUpperCase();
      appliedInviteCode = '';
      setInviteCodeState('');
    });

    inviteCodeInput.addEventListener('blur', () => {
      if (normalizedInviteCode()) startMembershipCheckout('monthly', { fromInviteCode: true, scroll: true });
    });

    inviteCodeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        inviteCodeInput.blur();
      }
    });
  }

  membershipCheckoutButtons.forEach((membershipCheckoutButton) => membershipCheckoutButton.addEventListener('click', async () => {
    const plan = membershipCheckoutButton.dataset.membershipPlan || 'monthly';
    if (plan === 'yearly') setInviteCodeState('');
    startMembershipCheckout(plan, { button: membershipCheckoutButton, scroll: true });
  }));

  if (paymentForm) {
    paymentForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!membershipStripe || !membershipElements) {
        if (paymentMessage) paymentMessage.textContent = 'Betalningen är inte redo ännu.';
        return;
      }

      setMembershipPayLoading(true);
      if (paymentMessage) paymentMessage.textContent = '';

      const result = await confirmMembershipStripePayment();
      await finishMembershipStripePayment(result);
    });
  }
}

function renderOrderPage(session = accountSession) {
  const shell = document.querySelector('[data-order-confirmation]');

  if (!shell) {
    return;
  }

  const pending = readPendingCheckout();
  const customerOrders = session && session.authenticated && session.customer && Array.isArray(session.customer.orders)
    ? [...session.customer.orders].sort((a, b) => orderTime(b) - orderTime(a))
    : [];
  const latestOrder = customerOrders[0] || null;
  const pendingStartedAt = pendingCheckoutTime(pending);
  const latestIsFresh = latestOrder && (!pendingStartedAt || orderTime(latestOrder) >= pendingStartedAt - 30000);
  const title = document.querySelector('[data-order-title]');
  const copy = document.querySelector('[data-order-copy]');
  const details = document.querySelector('[data-order-details]');

  if (title) title.textContent = 'Se orderstatus';
  if (copy) copy.textContent = 'Följ status på dina ordrar';

  if (latestIsFresh) {
    if (pending && pending.type === 'produkt') {
      clearCart();
    }

    clearPendingCheckout();
    if (details) {
      details.innerHTML = `
        <div class="order-detail-list">
          ${customerOrders.map((order, index) => renderOrderSummaryCard(order, index)).join('')}
        </div>
      `;
    }
    return;
  }

  if (!pending && customerOrders.length) {
    if (details) {
      details.innerHTML = `
        <div class="order-detail-list">
          ${customerOrders.map((order, index) => renderOrderSummaryCard(order, index)).join('')}
        </div>
      `;
    }
    return;
  }

  if (details) {
    details.innerHTML = `
      <div class="order-empty-card">
        <span>${pending ? 'Väntar på bekräftelse' : 'Ingen aktiv checkout'}</span>
        <strong>${pending && pending.type === 'medlemskap' ? 'Medlemskap' : 'Produktorder'}</strong>
        <p>${pending ? 'När betalningen är klar syns ordern här efter en kort stund. Den här rutan uppdateras automatiskt.' : 'Dina orders visas automatiskt när du är inloggad.'}</p>
        ${pending ? `
          <div class="account-actions">
            <button class="product-btn" type="button" data-refresh-order>Uppdatera status</button>
            <a class="product-btn secondary" href="/konto">Mitt konto</a>
          </div>
        ` : '<a class="order-detail-link" href="/konto">Mitt konto</a>'}
      </div>
    `;
  }
}

if (document.querySelector('[data-order-confirmation]')) {
  let orderRefreshes = 0;
  const orderInterval = window.setInterval(() => {
    const pending = readPendingCheckout();

    if (!pending || orderRefreshes >= 12) {
      window.clearInterval(orderInterval);
      return;
    }

    orderRefreshes += 1;
    refreshAccount();
  }, 5000);
}

if (document.querySelector('[data-membership-activation]')) {
  let activationRefreshes = 0;
  const activationInterval = window.setInterval(() => {
    if (isActiveMember() || activationRefreshes >= 18) {
      window.clearInterval(activationInterval);
      return;
    }

    activationRefreshes += 1;
    refreshAccount();
  }, 4000);
}

document.addEventListener('click', (event) => {
  const refreshOrder = event.target.closest('[data-refresh-order]');
  const refreshMembership = event.target.closest('[data-refresh-membership]');
  const unlockStore = event.target.closest('[data-unlock-store]');

  if (refreshOrder) {
    refreshOrder.textContent = 'Kontrollerar...';
    refreshAccount().finally(() => {
      refreshOrder.textContent = 'Uppdatera status';
    });
  }

  if (refreshMembership) {
    refreshMembership.textContent = 'Kontrollerar...';
    refreshAccount().finally(() => {
      refreshMembership.textContent = 'Kontrollera igen';
    });
  }

  if (unlockStore) {
    localStorage.setItem(MEMBERSHIP_REVEAL_KEY, '1');
    const target = membershipReturnTarget();
    const returningToCheckout = target.startsWith('/checkout');
    unlockStore.textContent = returningToCheckout ? 'Öppnar checkout...' : 'Öppnar butiken...';
    clearMembershipReturn();
    window.setTimeout(() => {
      window.location.href = target;
    }, 520);
  }
});

const launchForm = document.querySelector('[data-launch-form]');
const launchCountdown = document.querySelector('[data-launch-countdown]');
const dropCountdowns = Array.from(document.querySelectorAll('[data-drop-countdown]'));

function nextThursdayDrop() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(12, 0, 0, 0);

  const day = now.getDay();
  const thursday = 4;
  let daysUntilThursday = (thursday - day + 7) % 7;

  if (daysUntilThursday === 0 && now >= target) {
    daysUntilThursday = 7;
  }

  target.setDate(now.getDate() + daysUntilThursday);
  return target;
}

function updateDropCountdown() {
  if (!dropCountdowns.length) {
    return;
  }

  const distance = Math.max(0, nextThursdayDrop().getTime() - Date.now());
  const totalMinutes = Math.max(1, Math.ceil(distance / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const dayText = days === 1 ? '1 dag' : `${days} dagar`;
  const hourText = hours === 1 ? '1h' : `${hours}h`;

  dropCountdowns.forEach((dropCountdown) => {
    if (dropCountdown.dataset.dropCountdownFormat === 'clock') {
      dropCountdown.textContent = `${String(days).padStart(2, '0')} : ${String(hours).padStart(2, '0')} : ${String(minutes).padStart(2, '0')}`;
      return;
    }

    if (totalMinutes < 60) {
      const minuteText = totalMinutes === 1 ? '1 minut' : `${totalMinutes} minuter`;
      dropCountdown.textContent = `${minuteText} kvar av dessa deals`;
      return;
    }

    const homeCompact = document.body && document.body.classList.contains('page-home');
    if (days > 0 && hours > 0) {
      dropCountdown.textContent = `${dayText}${homeCompact ? ' ' : ' och '}${hourText} kvar av dessa deals`;
      return;
    }

    dropCountdown.textContent = days > 0
      ? `${dayText} kvar av dessa deals`
      : `${hourText} kvar av dessa deals`;
  });
}

if (dropCountdowns.length) {
  updateDropCountdown();
  window.setInterval(updateDropCountdown, 1000);
}

function updateLaunchCountdown() {
  if (!launchCountdown) {
    return;
  }

  const distance = Math.max(0, LAUNCH_OPEN_AT - Date.now());
  const days = Math.floor(distance / 86400000);
  const hours = Math.floor((distance % 86400000) / 3600000);
  const minutes = Math.floor((distance % 3600000) / 60000);
  const seconds = Math.floor((distance % 60000) / 1000);

  launchCountdown.innerHTML = `
    <div><strong>${String(days).padStart(2, '0')}</strong><span>dagar</span></div>
    <div><strong>${String(hours).padStart(2, '0')}</strong><span>timmar</span></div>
    <div><strong>${String(minutes).padStart(2, '0')}</strong><span>min</span></div>
    <div><strong>${String(seconds).padStart(2, '0')}</strong><span>sek</span></div>
  `;

  if (distance === 0) {
    localStorage.setItem(LAUNCH_GATE_KEY, '1');
    if (isLaunchPage) {
      window.setTimeout(() => {
        unlockLaunchGate(pageParams.get('next') || '/');
      }, 800);
    }
  }
}

if (launchCountdown) {
  updateLaunchCountdown();
  window.setInterval(updateLaunchCountdown, 1000);
}

if (launchForm) {
  const input = launchForm.querySelector('[data-launch-input]');
  const message = document.querySelector('[data-launch-message]');

  launchForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const value = String(input && input.value ? input.value : '').trim();

    if (value === LAUNCH_GATE_CODE) {
      if (message) message.textContent = 'Välkommen in.';
      unlockLaunchGate(pageParams.get('next') || '/');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      if (message) message.textContent = 'Skriv en giltig email.';
      return;
    }

    if (message) message.textContent = 'Sparar din plats...';

    try {
      const { response, data } = await postJson('/api/account', {
        action: 'waitlist',
        email: value,
      });

      if (!response.ok) {
        if (message) message.textContent = data.error || 'Kunde inte spara email just nu.';
        return;
      }

      launchForm.reset();
      if (message) message.textContent = data.status || 'Klart. Du är först i kön.';
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern just nu.';
    }
  });
}

const adminForm = document.querySelector('[data-admin-form]');

if (adminForm) {
  const message = document.querySelector('[data-admin-message]');
  const dashboard = document.querySelector('[data-admin-dashboard]');
  const searchForm = document.querySelector('[data-admin-search-form]');
  const savedSecret = '';
  const secretInput = adminForm.querySelector('input[name="adminSecret"]');

  if (secretInput && savedSecret) {
    secretInput.value = savedSecret;
  }

  function adminHeaders() {
    return {};
  }

  function statusText(value) {
    return value ? 'OK' : 'Behöver kollas';
  }

  function renderAdminDashboard(data) {
    if (!dashboard) {
      return;
    }

    const recentOrders = data.orders || [];
    const products = data.products || [];
    const suggestions = data.suggestions || [];

    dashboard.innerHTML = `
      <div class="admin-kpis">
        <article class="account-card">
          <span>Medlemskap</span>
          <strong>Stripe</strong>
          <p>Nya medlemskap hanteras utanför Shopify</p>
        </article>
        <article class="account-card">
          <span>Shopify orders</span>
          <strong>${escapeHtml(String(recentOrders.length))}</strong>
          <p>${escapeHtml(statusText(data.diagnostics && data.diagnostics.ordersWorking))}</p>
        </article>
        <article class="account-card">
          <span>Kundsystem</span>
          <strong>Supabase</strong>
          <p>Konton och medlemsstatus ligger i Versens system</p>
        </article>
      </div>

      <article class="account-card admin-card-wide">
        <h2>Produktförslag</h2>
        <div class="admin-table">
          ${suggestions.length ? suggestions.map((suggestion) => `
            <div class="admin-row suggestion-admin-row">
              <strong>${escapeHtml(suggestion.product)}</strong>
              <span>${escapeHtml(suggestion.category)} · ${escapeHtml(suggestion.name || suggestion.email || '')}</span>
              <small>${escapeHtml(suggestion.email || '')} · ${suggestion.submittedAt ? escapeHtml(new Date(suggestion.submittedAt).toLocaleString('sv-SE')) : 'Tid saknas'}</small>
              ${suggestion.link ? `<a class="admin-inline-link" href="${escapeHtml(normalizeExternalUrl(suggestion.link))}" target="_blank" rel="noopener noreferrer">${escapeHtml(suggestion.link)}</a>` : ''}
              ${suggestion.message ? `<p>${escapeHtml(suggestion.message)}</p>` : ''}
            </div>
          `).join('') : '<div class="empty-state"><span>Inga förslag ännu</span><p>När medlemmar skickar produktförslag visas de här.</p></div>'}
        </div>
      </article>

      <article class="account-card admin-card-wide">
        <h2>Senaste orders</h2>
        <div class="admin-table">
          ${recentOrders.length ? recentOrders.map((order) => `
            <div class="admin-row">
              <strong>${escapeHtml(order.name)}</strong>
              <span>${escapeHtml(order.email || '')}</span>
              <span>${escapeHtml(order.total || '')}</span>
              <small>${escapeHtml(order.financialStatus || '')} · ${escapeHtml(new Date(order.createdAt).toLocaleString('sv-SE'))}</small>
              <p>${escapeHtml((order.lines || []).map((line) => `${line.quantity} x ${line.name}`).join(', '))}</p>
            </div>
          `).join('') : '<div class="empty-state"><span>Inga orders</span><p>Inga orders hittades för filtret.</p></div>'}
        </div>
      </article>

      <article class="account-card">
        <h2>Aktiva medlemmar</h2>
        <div class="admin-table compact-table">
          ${(data.members || []).length ? data.members.map((member) => `
            <div class="admin-row">
              <strong>${escapeHtml(member.name || member.email)}</strong>
              <span>${escapeHtml(member.email || '')}</span>
              <small>${escapeHtml(member.amountSpent)} · ${escapeHtml(member.numberOfOrders)} orders · ${escapeHtml(String(member.points || 0))} poäng</small>
            </div>
          `).join('') : '<div class="empty-state"><span>Inga taggade medlemmar</span><p>ReCharge kan ändå ha aktiva subscriptions.</p></div>'}
        </div>
      </article>

      <article class="account-card admin-card-wide">
        <h2>Produkter</h2>
        <div class="admin-table compact-table">
          ${products.length ? products.map((product) => `
            <div class="admin-row">
              <strong>${escapeHtml(product.title)}</strong>
              <span>${escapeHtml(product.vendor || 'Okänt varumärke')} · ${escapeHtml(product.price)} ${product.compareAtPrice ? `· ${escapeHtml(product.compareAtPrice)}` : ''}</span>
              <small>${escapeHtml(product.status)} · lager ${escapeHtml(String(product.inventory ?? 'okänt'))}</small>
              <div class="admin-flag-actions">
                <button class="flag-toggle few-left ${product.flags && product.flags.fewLeft ? 'active' : ''}" type="button" data-product-flag="fewLeft" data-product-handle="${escapeHtml(product.handle)}" data-enabled="${product.flags && product.flags.fewLeft ? 'true' : 'false'}">Få antal kvar</button>
                <button class="flag-toggle great-price ${product.flags && product.flags.greatPrice ? 'active' : ''}" type="button" data-product-flag="greatPrice" data-product-handle="${escapeHtml(product.handle)}" data-enabled="${product.flags && product.flags.greatPrice ? 'true' : 'false'}">Grymt pris</button>
              </div>
            </div>
          `).join('') : '<div class="empty-state"><span>Inga produkter</span><p>Kontrollera Shopify-access.</p></div>'}
        </div>
      </article>

      <article class="account-card admin-card-wide">
        <h2>Launchkontroll</h2>
        <div class="ops-list">
          <span>Domän kopplad till Vercel</span>
          <span>Resend-domän verifierad</span>
          <span>Riktiga produktbilder och lager inlagt</span>
          <span>Testorder med fysisk produkt genomförd</span>
          <span>Returpolicy och villkor ersatta med skarp version</span>
        </div>
      </article>
    `;
  }

  async function loadAdminDashboard(email = '') {
    if (message) message.textContent = 'Hämtar kontrollrummet...';
    if (secretInput && secretInput.value) {
      const loginResponse = await fetch('/api/admin-members', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', code: secretInput.value }),
      });
      const loginData = await loginResponse.json().catch(() => ({}));

      if (!loginResponse.ok) {
        if (message) message.textContent = loginData.error || 'Kunde inte skapa admin-session.';
        return;
      }
      secretInput.value = '';
    }
    const query = email ? `?email=${encodeURIComponent(email)}` : '';
    const response = await fetch(`/api/admin-members${query}`, { credentials: 'same-origin', headers: adminHeaders() });
    const data = await response.json();

    if (!response.ok) {
      if (message) message.textContent = data.error || 'Kunde inte hämta admindata.';
      return;
    }

    if (message) message.textContent = 'Kontrollrummet är uppdaterat.';
    renderAdminDashboard(data);
  }

  adminForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await loadAdminDashboard();
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
    }
  });

  if (searchForm) {
    searchForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(searchForm);

      try {
        await loadAdminDashboard(formData.get('email'));
      } catch (error) {
        if (message) message.textContent = 'Kunde inte kontrollera kunden.';
      }
    });
  }

  if (dashboard) {
    dashboard.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-product-flag]');

      if (!button) {
        return;
      }

      const enabled = button.dataset.enabled !== 'true';
      button.disabled = true;
      button.textContent = enabled ? 'Sparar...' : 'Tar bort...';

      try {
        const response = await fetch('/api/admin-members', {
          method: 'POST',
          headers: {
            ...adminHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'update_product_flag',
            handle: button.dataset.productHandle,
            flag: button.dataset.productFlag,
            enabled,
          }),
        });
        const data = await response.json();

        if (!response.ok) {
          if (message) message.textContent = data.error || 'Kunde inte spara markeringen.';
          button.disabled = false;
          button.textContent = button.dataset.productFlag === 'fewLeft' ? 'Få antal kvar' : 'Grymt pris';
          return;
        }

        if (message) message.textContent = data.status || 'Produktmarkering uppdaterad.';
        await loadAdminDashboard();
      } catch (error) {
        if (message) message.textContent = 'Kunde inte kontakta servern.';
        button.disabled = false;
      }
    });
  }
}

const suggestionForm = document.querySelector('[data-suggestion-form]');

if (suggestionForm) {
  const suggestionMessage = document.querySelector('[data-suggestion-message]');
  const suggestionTextarea = suggestionForm.querySelector('textarea[name="message"]');
  const suggestionCounter = suggestionForm.querySelector('.suggest-field-message small');

  if (suggestionTextarea && suggestionCounter) {
    const updateSuggestionCounter = () => {
      suggestionCounter.textContent = `${suggestionTextarea.value.length}/250`;
    };
    suggestionTextarea.addEventListener('input', updateSuggestionCounter);
    updateSuggestionCounter();
  }

  suggestionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isActiveMember()) {
      renderSuggestionAccess(accountSession || { authenticated: false });
      return;
    }

    const formData = new FormData(suggestionForm);
    const button = suggestionForm.querySelector('button');

    if (button) button.disabled = true;
    if (suggestionMessage) suggestionMessage.textContent = 'Skickar förslag...';

    try {
      const { response, data } = await postJson('/api/account', {
        action: 'suggest_product',
        product: formData.get('product'),
        category: formData.get('category'),
        name: formData.get('name'),
        email: formData.get('email'),
        link: formData.get('link'),
        message: formData.get('message'),
      });

      if (suggestionMessage) {
        suggestionMessage.textContent = response.ok ? data.status : (data.error || 'Kunde inte skicka förslaget.');
      }

      if (response.ok) {
        suggestionForm.reset();
      }
    } catch (error) {
      if (suggestionMessage) suggestionMessage.textContent = 'Kunde inte kontakta servern.';
    } finally {
      if (button) button.disabled = false;
    }
  });
}

function renderSiteFooter() {
  if (document.body.dataset.noFooter === 'true' || document.querySelector('.site-footer')) {
    return;
  }

  const footer = document.createElement('footer');
  footer.className = 'site-footer fade';
  footer.innerHTML = `
    <div class="site-footer-inner">
      <div class="site-footer-brand">
        <a class="footer-logo" href="/">VERSEN</a>
        <div class="footer-payment-row" aria-label="Betalning och trygghet">
          <span>Klarna</span>
          <span>Apple Pay</span>
          <span>Swish</span>
          <span>1-3 dagar</span>
        </div>
      </div>
      <div class="footer-column">
        <strong>Kundservice</strong>
        <a href="/faq">FAQ</a>
        <a href="/kontakt">Kontakt</a>
      </div>
      <div class="footer-column">
        <strong>Om Versen</strong>
        <a href="/konto">Mitt konto</a>
        <a href="/villkor">Terms & Conditions</a>
        <a href="/integritet">Integritet</a>
      </div>
      <div class="footer-column footer-org-number">
        <strong>Org-nummer</strong>
        <span>0011017415</span>
      </div>
    </div>
  `;
  document.body.appendChild(footer);
  observer.observe(footer);
}

renderSiteFooter();
renderCart();
updateCartCount();
syncShoppingAccess();
refreshAccount();
