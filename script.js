const CART_KEY = 'versenCart';
const DISCOUNT_KEY = 'versenDiscountCode';
const CHECKOUT_KEY = 'versenCheckoutPending';
const ADMIN_SECRET_KEY = 'versenAdminSecret';
const MEMBERSHIP_REVEAL_KEY = 'versenMembershipRevealSeen';
let accountSession = null;
const pageParams = new URLSearchParams(window.location.search);
const accountNext = pageParams.get('next') || '';
const verificationToken = pageParams.get('verify') || '';
const resetToken = pageParams.get('reset') || '';
const activeNavLink = document.querySelector('.menu a.active');

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

if (activeNavLink) {
  activeNavLink.scrollIntoView({ block: 'nearest', inline: 'center' });
}

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

function updateCartCount() {
  const count = cartQuantity();
  document.querySelectorAll('[data-cart-count]').forEach((element) => {
    element.textContent = count ? `(${count})` : '';
  });
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

function prepareCheckoutWindow() {
  const checkoutWindow = window.open('', '_blank');

  if (checkoutWindow) {
    checkoutWindow.document.write('<!doctype html><title>Versen checkout</title><body style="background:#0a0a0a;color:white;font-family:Inter,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0">Öppnar säker checkout...</body>');
  }

  return checkoutWindow;
}

function openCheckout(checkoutUrl, type, checkoutWindow = null) {
  rememberCheckout(type, checkoutUrl);
  const opened = checkoutWindow || window.open('', '_blank');

  if (!opened) {
    window.location.href = checkoutUrl;
    return;
  }

  opened.location.href = checkoutUrl;
  window.location.href = type === 'medlemskap'
    ? 'medlemskap-aktivt.html?checkout=medlemskap'
    : `order.html?checkout=${encodeURIComponent(type || 'produkt')}`;
}

function applyGlobalSessionUi(session = accountSession) {
  const authenticated = Boolean(session && session.authenticated);
  const member = isActiveMember(session);
  const firstName = authenticated
    ? (session.customer.firstName || (session.customer.displayName || '').split(' ')[0] || '')
    : '';

  document.body.classList.toggle('is-authenticated', authenticated);
  document.body.classList.toggle('is-member', member);

  document.querySelectorAll('a[href="medlemskap.html"], a[href^="medlemskap.html?"]').forEach((link) => {
    link.hidden = member;
  });

  document.querySelectorAll('[data-guest-home]').forEach((element) => {
    element.hidden = member;
  });

  document.querySelectorAll('[data-member-home]').forEach((element) => {
    element.hidden = !member;
  });

  setText('[data-member-home-title]', firstName ? `Välkommen tillbaka, ${firstName}` : 'Välkommen tillbaka');
  setText('[data-account-hero-title]', member ? 'Ditt medlemskonto' : 'Din medlemsyta');
  setText(
    '[data-account-hero-copy]',
    member
      ? 'Medlemskapet är aktivt. Här ser du status, rabatter och senaste aktivitet.'
      : 'Verifiera email, skapa lösenord och hantera medlemskap kopplat till Shopify.'
  );

  document.querySelectorAll('.menu a[href="konto.html"]').forEach((link) => {
    link.textContent = authenticated && firstName ? firstName : 'Konto';
  });
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
    button.disabled = !member;
    button.textContent = member ? 'Lägg i kundkorg' : 'Kräver medlemskap';
  });

  const detailAddButton = document.querySelector('[data-add-to-cart-button]');
  if (detailAddButton) {
    detailAddButton.disabled = !member;
    detailAddButton.textContent = member ? 'Lägg i kundkorg' : 'Kräver medlemskap';
  }

  const checkoutButton = document.querySelector('[data-cart-checkout]');
  if (checkoutButton) {
    checkoutButton.disabled = !cart.length || !member;
  }

  if (discountInput) {
    discountInput.disabled = !member || !cart.length;
    if (!discountInput.value) discountInput.value = readDiscountCode();
  }

  if (discountFormButton) {
    discountFormButton.disabled = !member || !cart.length;
  }

  if (cartStatus) {
    cartStatus.textContent = member ? 'Redo för checkout' : 'Medlemskap krävs';
    cartStatus.classList.toggle('is-active', member);
  }

  if (cartHelp) {
    cartHelp.textContent = member
      ? 'Rabattkoder kontrolleras här. Shopify checkout öppnas i en ny flik och orderstatus visas hos Versen.'
      : 'Aktivt betalande medlemskap krävs innan du kan lägga till produkter eller gå till checkout.';
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

  window.requestAnimationFrame(() => {
    if (isActiveMember(session)) {
      window.scrollTo(0, 0);
      return;
    }

    const isMobile = window.matchMedia('(max-width: 767px)').matches;

    if (!isMobile) {
      return;
    }

    if (session && session.authenticated) {
      const statusCard = document.querySelector('[data-status-card]');

      if (statusCard && !statusCard.hidden) {
        statusCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }

      return;
    }

    if (accountNext === 'membership' || verificationToken) {
      const createCard = document.querySelector('[data-create-card]');

      if (createCard && !createCard.hidden) {
        createCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  });
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
    const category = filter.dataset.filter;
    const products = document.querySelectorAll('[data-category]');

    filters.forEach((item) => item.classList.remove('active'));
    filter.classList.add('active');

    products.forEach((product) => {
      const isMatch = category === 'Alla' || product.dataset.category === category;
      product.classList.toggle('is-hidden', !isMatch);
    });
  });
});

document.querySelectorAll('.sort-pill').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.sort-pill').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});

function productCard(product) {
  const image = product.image && product.image.url
    ? `<img src="${escapeHtml(product.image.url)}" alt="${escapeHtml(product.image.altText || product.title)}">`
    : 'Bild';

  const compareAtPrice = product.compareAtPrice || product.price || '';
  const memberPrice = product.price || 'Pris kommer';
  const productUrl = `produkt.html?handle=${encodeURIComponent(product.handle)}`;

  return `
    <article class="product-card" role="link" tabindex="0" data-product-url="${escapeHtml(productUrl)}" data-category="${escapeHtml(product.category)}" data-product-handle="${escapeHtml(product.handle)}" data-variant-id="${escapeHtml(product.variantId || '')}" data-product-title="${escapeHtml(product.title)}" data-product-price="${escapeHtml(memberPrice)}" data-product-compare-at-price="${escapeHtml(compareAtPrice)}" data-product-image-url="${escapeHtml(product.image && product.image.url ? product.image.url : '')}" data-product-image-alt="${escapeHtml(product.image && product.image.altText ? product.image.altText : product.title)}">
      <div class="product-image">${image}</div>
      <div class="product-info">
        <div class="product-category">${escapeHtml(product.category)}</div>
        <h3>${escapeHtml(product.title)}</h3>
        <div class="product-prices">
          <span class="old">${escapeHtml(compareAtPrice)}</span>
          <span class="new">${escapeHtml(memberPrice)}</span>
        </div>
        <div class="product-actions">
          <a class="product-btn" href="${escapeHtml(productUrl)}">Visa produkt</a>
          <button class="product-btn secondary" type="button" data-catalog-add>Lägg i kundkorg</button>
        </div>
      </div>
    </article>
  `;
}

function prepareProductCardLinks(root = document) {
  root.querySelectorAll('.product-card').forEach((card) => {
    const link = card.querySelector('a[href*="produkt.html"]');

    if (!link) {
      return;
    }

    card.dataset.productUrl = card.dataset.productUrl || link.getAttribute('href');
    card.setAttribute('role', 'link');

    if (!card.hasAttribute('tabindex')) {
      card.tabIndex = 0;
    }
  });
}

document.addEventListener('click', (event) => {
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

    grid.innerHTML = visibleProducts.map(productCard).join('');
    prepareProductCardLinks(grid);
    syncShoppingAccess();
  } catch (error) {
    return;
  }
}

prepareProductCardLinks();
loadProducts();

async function loadMemberHomeProducts() {
  const grid = document.querySelector('[data-member-products]');

  if (!grid) {
    return;
  }

  try {
    const response = await fetch('/api/products');

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const products = (data.products || [])
      .filter((product) => product.handle !== 'medlemskap')
      .slice(0, 3);

    if (!products.length) {
      return;
    }

    grid.innerHTML = products.map(productCard).join('');
    prepareProductCardLinks(grid);
    syncShoppingAccess();
  } catch (error) {
    return;
  }
}

loadMemberHomeProducts();

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (element && value) {
    element.textContent = value;
  }
}

function setProductDetail(product) {
  const detail = document.querySelector('[data-product-detail]');

  if (!detail || !product) {
    return;
  }

  detail.dataset.variantId = product.variantId || '';
  detail.dataset.cartHandle = product.handle || '';
  detail.dataset.cartTitle = product.title || '';
  detail.dataset.cartCategory = product.category || '';
  detail.dataset.cartPrice = product.price || '';
  detail.dataset.cartCompareAtPrice = product.compareAtPrice || product.price || '';
  detail.dataset.cartImageUrl = product.image && product.image.url ? product.image.url : '';
  detail.dataset.cartImageAlt = product.image && product.image.altText ? product.image.altText : product.title || '';

  setText('[data-product-category]', product.category);
  setText('[data-product-title]', product.title);
  setText('[data-product-description]', product.description || 'Produktinformation hämtas från Shopify.');
  setText('[data-product-compare-price]', product.compareAtPrice || product.price);
  setText('[data-product-price]', product.price || 'Pris kommer');

  const image = document.querySelector('[data-product-image]');
  if (image && product.image && product.image.url) {
    image.innerHTML = `<img src="${escapeHtml(product.image.url)}" alt="${escapeHtml(product.image.altText || product.title)}">`;
  }

  syncShoppingAccess();
}

async function loadProductDetail() {
  const detail = document.querySelector('[data-product-detail]');

  if (!detail) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const handle = params.get('handle') || 'nocco-flak';

  try {
    const response = await fetch(`/api/products?handle=${encodeURIComponent(handle)}`);

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    setProductDetail(data.product);
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

if (addToCartButton) {
  addToCartButton.addEventListener('click', () => {
    const product = currentProductFromDetail();
    const message = document.querySelector('[data-checkout-message]');
    const quantity = quantityInput ? Number(quantityInput.value) : 1;

    if (!isActiveMember()) {
      if (message) message.textContent = accountSession && accountSession.authenticated
        ? 'Aktivt betalande medlemskap krävs för att lägga till produkter.'
        : 'Logga in och starta medlemskap innan du lägger till produkter.';
      return;
    }

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

function cartItemTemplate(item) {
  const image = item.image && item.image.url
    ? `<img src="${escapeHtml(item.image.url)}" alt="${escapeHtml(item.image.altText || item.title)}">`
    : 'Bild';

  return `
    <article class="cart-item" data-cart-item="${escapeHtml(item.variantId)}">
      <a class="cart-item-image" href="produkt.html?handle=${encodeURIComponent(item.handle)}">${image}</a>
      <div class="cart-item-info">
        <div class="product-category">${escapeHtml(item.category || 'Produkt')}</div>
        <h3>${escapeHtml(item.title)}</h3>
        <div class="product-prices">
          <span class="old">${escapeHtml(item.compareAtPrice || '')}</span>
          <span class="new">${escapeHtml(item.price || 'Pris kommer')}</span>
        </div>
        <div class="cart-actions">
          <div class="quantity-control small" aria-label="Ändra antal">
            <button type="button" data-cart-minus="${escapeHtml(item.variantId)}">-</button>
            <input type="number" min="1" value="${Number(item.quantity) || 1}" inputmode="numeric" data-cart-quantity="${escapeHtml(item.variantId)}">
            <button type="button" data-cart-plus="${escapeHtml(item.variantId)}">+</button>
          </div>
          <button class="remove-btn" type="button" data-cart-remove="${escapeHtml(item.variantId)}">Ta bort</button>
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

  if (!cart.length) {
    list.innerHTML = `
      <div class="empty-cart">
        <h2>Kundkorgen är tom</h2>
        <p>Lägg till produkter från katalogen innan du går vidare till checkout.</p>
        <a class="product-btn" href="produkter.html">Visa produkter</a>
      </div>
    `;
  } else {
    list.innerHTML = cart.map(cartItemTemplate).join('');
  }

  setText('[data-cart-total-items]', `${totalItems} st`);
  setText('[data-cart-total]', formatSek(total));

  const checkoutButton = document.querySelector('[data-cart-checkout]');
  if (checkoutButton) {
    checkoutButton.disabled = !cart.length || !isActiveMember();
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

    if (!isActiveMember()) {
      catalogAddButton.textContent = 'Medlemskap krävs';
      window.setTimeout(syncShoppingAccess, 1200);
      return;
    }

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
  cartCheckoutButton.addEventListener('click', async () => {
    const cart = readCart();
    const message = document.querySelector('[data-cart-message]');

    if (!cart.length) {
      if (message) message.textContent = 'Kundkorgen är tom.';
      return;
    }

    if (!isActiveMember()) {
      if (message) message.textContent = accountSession && accountSession.authenticated
        ? 'Aktivt betalande medlemskap krävs innan checkout.'
        : 'Logga in och starta medlemskap innan checkout.';
      syncShoppingAccess();
      return;
    }

    cartCheckoutButton.disabled = true;
    cartCheckoutButton.textContent = 'Skapar checkout...';
    if (message) message.textContent = '';
    const checkoutWindow = prepareCheckoutWindow();

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
          discountCode: readDiscountCode(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.membershipRequired) {
          if (message) message.textContent = data.loginRequired ? 'Logga in på kontosidan först.' : 'Aktivt medlemskap krävs innan checkout.';
        } else if (message) {
          message.textContent = data.error || 'Kunde inte skapa checkout.';
        }
        if (checkoutWindow) checkoutWindow.close();
        return;
      }

      openCheckout(data.checkoutUrl, 'produkt', checkoutWindow);
    } catch (error) {
      if (checkoutWindow) checkoutWindow.close();
      if (message) message.textContent = 'Kunde inte kontakta checkout.';
    } finally {
      cartCheckoutButton.disabled = false;
      cartCheckoutButton.textContent = 'Öppna checkout';
    }
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
      if (message) message.textContent = 'Aktivt medlemskap krävs för att använda rabattkod.';
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
      if (message) message.textContent = 'Kunde inte kontakta Shopify.';
    }
  });
}

function renderOrders(orders) {
  const list = document.querySelector('[data-orders-list]');

  if (!list) {
    return;
  }

  if (!orders || !orders.length) {
    list.innerHTML = '<span>Inga ordrar ännu</span><p>Dina Shopify-köp visas här efter första checkout.</p>';
    return;
  }

  list.innerHTML = orders.map((order) => `
    <div class="order-row">
      <strong>${escapeHtml(order.name)}</strong>
      <span>${escapeHtml(order.total || '')}</span>
      <small>${escapeHtml(new Date(order.processedAt).toLocaleDateString('sv-SE'))}</small>
      <p>${escapeHtml((order.items || []).join(', '))}</p>
      ${order.statusUrl ? `<a href="${escapeHtml(order.statusUrl)}" target="_blank" rel="noreferrer">Visa order</a>` : ''}
    </div>
  `).join('');
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
  applyGlobalSessionUi(session);
  syncShoppingAccess();

  const status = document.querySelector('[data-member-status]');

  if (!status) {
    return;
  }

  const accountFlow = document.querySelector('[data-account-flow]');
  const authCard = document.querySelector('[data-auth-card]');
  const statusCard = document.querySelector('[data-status-card]');
  const ordersCard = document.querySelector('[data-orders-card]');
  const email = document.querySelector('[data-account-email]');
  const logoutButton = document.querySelector('[data-logout-button]');
  const membershipLink = document.querySelector('[data-membership-link]');
  const greeting = document.querySelector('[data-account-greeting]');
  const summary = document.querySelector('[data-account-summary]');
  const memberNote = document.querySelector('[data-member-note]');
  const dashboardMembership = document.querySelector('[data-dashboard-membership]');
  const dashboardDiscount = document.querySelector('[data-dashboard-discount]');
  const dashboardOrders = document.querySelector('[data-dashboard-orders]');

  if (!session || !session.authenticated) {
    status.textContent = 'Ej inloggad';
    status.classList.remove('is-active');
    if (authCard) authCard.hidden = true;
    if (statusCard) statusCard.hidden = true;
    if (ordersCard) ordersCard.hidden = true;
    if (accountFlow) accountFlow.hidden = Boolean(resetToken);
    if (loginCard) loginCard.hidden = accountNext === 'membership' || Boolean(verificationToken) || Boolean(resetToken);
    if (createCard) createCard.hidden = Boolean(resetToken);
    if (resetCard) resetCard.hidden = !resetToken;
    if (email) email.textContent = 'Logga in för att se kontot.';
    if (logoutButton) logoutButton.hidden = true;
    if (membershipLink) membershipLink.hidden = true;
    renderOrders([]);
    return;
  }

  const firstName = session.customer.firstName || (session.customer.displayName || '').split(' ')[0] || 'där';
  const orderCount = Number(session.customer.numberOfOrders || 0);
  const hasMemberDiscount = Boolean(session.customer.member);

  if (accountFlow) accountFlow.hidden = true;
  if (authCard) authCard.hidden = false;
  if (statusCard) statusCard.hidden = false;
  if (ordersCard) ordersCard.hidden = false;
  if (loginCard) loginCard.hidden = true;
  if (createCard) createCard.hidden = true;
  if (resetCard) resetCard.hidden = true;

  status.textContent = session.customer.membershipStatus;
  status.classList.toggle('is-active', hasMemberDiscount);
  if (greeting) greeting.textContent = `Hej ${firstName}`;
  if (summary) summary.textContent = `${session.customer.email} är kopplat till ditt Versen-konto.`;
  if (email) email.textContent = session.customer.email;
  if (memberNote) {
    memberNote.textContent = hasMemberDiscount
      ? 'Medlemsrabatten är aktiv och används automatiskt i checkout.'
      : 'Starta medlemskap för att låsa upp rabatterade priser i checkout.';
  }
  if (dashboardMembership) dashboardMembership.textContent = hasMemberDiscount ? 'Aktivt' : 'Ej aktivt';
  if (dashboardDiscount) dashboardDiscount.textContent = hasMemberDiscount ? 'Upplåsta' : 'Låsta';
  if (dashboardOrders) dashboardOrders.textContent = String(orderCount);
  if (logoutButton) logoutButton.hidden = false;
  if (membershipLink) membershipLink.hidden = hasMemberDiscount;
  renderOrders(session.customer.orders);
}

function completeAccountIntent() {
  if (isActiveMember()) {
    window.location.href = 'index.html';
  } else if (accountNext === 'membership') {
    window.location.href = 'medlemskap.html?ready=1';
  } else {
    window.location.href = 'index.html';
  }
}

async function refreshAccount() {
  try {
    const response = await fetch('/api/account', { credentials: 'same-origin' });
    accountSession = await response.json();
    updateMemberStatus(accountSession);
    renderOrderPage(accountSession);
    renderMembershipActivation(accountSession);
  } catch (error) {
    accountSession = { authenticated: false };
    updateMemberStatus(accountSession);
    renderOrderPage(accountSession);
    renderMembershipActivation(accountSession);
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
    if (badge) badge.textContent = seenReveal ? 'Medlemskap aktivt' : 'Välkommen in';
    if (title) title.textContent = seenReveal ? 'Du är redan medlem' : `Medlemskap aktiverat${firstName ? `, ${firstName}` : ''}`;
    if (copy) {
      copy.textContent = seenReveal
        ? 'Butiken är upplåst. Dina medlemspriser är redo när du vill handla.'
        : 'Dina medlemspriser är upplåsta. Tryck på knappen och öppna butiken med full access.';
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
        <button class="cta activation-unlock" type="button" data-unlock-store>${seenReveal ? 'Gå till produkter' : 'Lås upp butik'}</button>
        <a class="product-btn secondary" href="konto.html">Se mitt konto</a>
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
      ? 'När betalningen är klar i Shopify aktiveras medlemskapet här automatiskt.'
      : 'Vi hittar ingen aktiv medlemscheckout. Starta medlemskapet igen om du inte kom vidare.';
  }
  if (status) {
    status.innerHTML = `
      <span>Status</span>
      <strong>${pending ? 'Kontrollerar Shopify' : 'Ingen aktiv checkout'}</strong>
      <p>${pending ? 'Den här sidan uppdateras av sig själv. Stanna här efter att checkouten är klar.' : 'Gå tillbaka till medlemskap och starta checkout när du är redo.'}</p>
    `;
  }
  if (actions) {
    actions.innerHTML = `
      <button class="product-btn" type="button" data-refresh-membership>Kontrollera igen</button>
      <a class="product-btn secondary" href="medlemskap.html">Till medlemskap</a>
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

if (accountNext === 'membership' && createCard) {
  createCard.classList.add('is-priority');
  if (loginCard) loginCard.hidden = true;
}

if (verificationToken && registerForm) {
  const message = document.querySelector('[data-register-message]');
  registerForm.hidden = false;
  if (verificationForm) verificationForm.hidden = true;
  if (loginCard) loginCard.hidden = true;
  if (createCard) createCard.classList.add('is-priority');
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

      if (message) message.textContent = data.status || 'Verifieringsmail skickat. Kontrollera inkorgen.';
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
      if (message) message.textContent = 'Kontot är skapat och du är inloggad.';
      completeAccountIntent();
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

const logoutButton = document.querySelector('[data-logout-button]');

if (logoutButton) {
  logoutButton.addEventListener('click', async () => {
    await postJson('/api/account', { action: 'logout' });
    accountSession = { authenticated: false };
    updateMemberStatus(accountSession);
  });
}

const membershipCheckoutButton = document.querySelector('[data-membership-checkout]');

if (membershipCheckoutButton) {
  const message = document.querySelector('[data-membership-message]');

  refreshAccount().then(() => {
    if (pageParams.get('ready') === '1' && message) {
      message.textContent = 'Kontot är klart. Starta medlemskapet när du är redo.';
    }
  });

  membershipCheckoutButton.addEventListener('click', async () => {
    if (!accountSession || !accountSession.authenticated) {
      window.location.href = 'konto.html?next=membership';
      return;
    }

    membershipCheckoutButton.disabled = true;
    membershipCheckoutButton.textContent = 'Öppnar checkout...';
    if (message) message.textContent = '';
    const checkoutWindow = prepareCheckoutWindow();

    try {
      const { response, data } = await postJson('/api/membership-checkout', {});

      if (!response.ok) {
        if (message) {
          message.textContent = data.loginRequired
            ? 'Skapa konto eller logga in på kontosidan först.'
            : (data.error || 'Kunde inte starta medlemskap.');
        }
        if (checkoutWindow) checkoutWindow.close();
        return;
      }

      openCheckout(data.checkoutUrl, 'medlemskap', checkoutWindow);
    } catch (error) {
      if (checkoutWindow) checkoutWindow.close();
      if (message) message.textContent = 'Kunde inte kontakta checkout.';
    } finally {
      membershipCheckoutButton.disabled = false;
      membershipCheckoutButton.textContent = 'Starta medlemskap';
    }
  });
}

function renderOrderPage(session = accountSession) {
  const shell = document.querySelector('[data-order-confirmation]');

  if (!shell) {
    return;
  }

  const pending = readPendingCheckout();
  const latestOrder = session && session.authenticated && session.customer && session.customer.orders
    ? session.customer.orders[0]
    : null;
  const pendingStartedAt = pendingCheckoutTime(pending);
  const latestIsFresh = latestOrder && (!pendingStartedAt || orderTime(latestOrder) >= pendingStartedAt - 30000);
  const title = document.querySelector('[data-order-title]');
  const copy = document.querySelector('[data-order-copy]');
  const details = document.querySelector('[data-order-details]');

  if (latestIsFresh) {
    clearPendingCheckout();
    if (title) title.textContent = 'Ordern är mottagen';
    if (copy) copy.textContent = 'Vi hittade din senaste order på kontot. Du kan fortsätta handla eller öppna orderstatus från Shopify vid behov.';
    if (details) {
      details.innerHTML = `
        <div class="order-success-card">
          <span>Senaste order</span>
          <strong>${escapeHtml(latestOrder.name || 'Order')}</strong>
          <p>${escapeHtml(latestOrder.total || '')} · ${escapeHtml((latestOrder.items || []).join(', ') || 'Produkter synkas från Shopify')}</p>
          ${latestOrder.statusUrl ? `<a class="product-btn secondary" href="${escapeHtml(latestOrder.statusUrl)}" target="_blank" rel="noreferrer">Visa orderstatus</a>` : ''}
        </div>
      `;
    }
    return;
  }

  if (title) title.textContent = pending ? 'Checkout är öppnad' : 'Orderstatus';
  if (copy) {
    copy.textContent = pending
      ? 'Slutför betalningen i Shopify-fliken. Vi väntar på nästa order från Shopify, så vi visar inte en äldre order av misstag.'
      : 'Logga in eller gå till konto för att se senaste ordern.';
  }
  if (details) {
    details.innerHTML = `
      <div class="order-success-card">
        <span>${pending ? 'Väntar på Shopify' : 'Ingen aktiv checkout'}</span>
        <strong>${pending && pending.type === 'medlemskap' ? 'Medlemskap' : 'Produktorder'}</strong>
        <p>${pending ? 'När betalningen är klar syns ordern här efter en kort stund. Den här rutan uppdateras automatiskt.' : 'Dina orders visas automatiskt när du är inloggad.'}</p>
        <div class="account-actions">
          <button class="product-btn" type="button" data-refresh-order>Uppdatera status</button>
          <a class="product-btn secondary" href="konto.html">Mitt konto</a>
        </div>
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
    unlockStore.textContent = 'Öppnar butiken...';
    window.setTimeout(() => {
      window.location.href = 'produkter.html?unlocked=1';
    }, 520);
  }
});

const adminForm = document.querySelector('[data-admin-form]');

if (adminForm) {
  const message = document.querySelector('[data-admin-message]');
  const dashboard = document.querySelector('[data-admin-dashboard]');
  const searchForm = document.querySelector('[data-admin-search-form]');
  const savedSecret = localStorage.getItem(ADMIN_SECRET_KEY) || '';
  const secretInput = adminForm.querySelector('input[name="adminSecret"]');

  if (secretInput && savedSecret) {
    secretInput.value = savedSecret;
  }

  function adminHeaders() {
    const secret = secretInput ? secretInput.value : '';

    return {
      Authorization: `Bearer ${secret}`,
    };
  }

  function statusText(value) {
    return value ? 'OK' : 'Behöver kollas';
  }

  function renderAdminDashboard(data) {
    if (!dashboard) {
      return;
    }

    const activeRecharge = data.recharge && data.recharge.activeCount ? data.recharge.activeCount : 0;
    const recentOrders = data.orders || [];
    const products = data.products || [];
    const check = data.customerCheck;

    dashboard.innerHTML = `
      <div class="admin-kpis">
        <article class="account-card">
          <span>ReCharge</span>
          <strong>${escapeHtml(activeRecharge)} aktiva</strong>
          <p>${escapeHtml(statusText(data.diagnostics && data.diagnostics.rechargeWorking))}</p>
        </article>
        <article class="account-card">
          <span>Shopify orders</span>
          <strong>${escapeHtml(String(recentOrders.length))}</strong>
          <p>${escapeHtml(statusText(data.diagnostics && data.diagnostics.ordersWorking))}</p>
        </article>
        <article class="account-card">
          <span>Medlemsplan</span>
          <strong>${data.membershipProduct && data.membershipProduct.sellingPlanFound ? 'Aktiv' : 'Saknas'}</strong>
          <p>${escapeHtml((data.membershipProduct && data.membershipProduct.sellingPlans || []).join(', ') || 'Ingen plan hittad')}</p>
        </article>
      </div>

      ${check ? `
        <article class="account-card admin-card-wide">
          <h2>Kundkontroll</h2>
          <div class="admin-status-grid">
            <div><span>Email</span><strong>${escapeHtml(check.email)}</strong></div>
            <div><span>ReCharge-kund</span><strong>${check.customerFound ? 'Ja' : 'Nej'}</strong></div>
            <div><span>Aktiv subscription</span><strong>${check.activeSubscriptionFound ? 'Ja' : 'Nej'}</strong></div>
          </div>
        </article>
      ` : ''}

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
              <small>${escapeHtml(member.amountSpent)} · ${escapeHtml(member.numberOfOrders)} orders</small>
            </div>
          `).join('') : '<div class="empty-state"><span>Inga taggade medlemmar</span><p>ReCharge kan ändå ha aktiva subscriptions.</p></div>'}
        </div>
      </article>

      <article class="account-card">
        <h2>Produkter</h2>
        <div class="admin-table compact-table">
          ${products.length ? products.map((product) => `
            <div class="admin-row">
              <strong>${escapeHtml(product.title)}</strong>
              <span>${escapeHtml(product.price)} ${product.compareAtPrice ? `· ${escapeHtml(product.compareAtPrice)}` : ''}</span>
              <small>${escapeHtml(product.status)} · lager ${escapeHtml(String(product.inventory ?? 'okänt'))}</small>
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
    const query = email ? `?email=${encodeURIComponent(email)}` : '';
    const response = await fetch(`/api/admin-members${query}`, { headers: adminHeaders() });
    const data = await response.json();

    if (!response.ok) {
      if (message) message.textContent = data.error || 'Kunde inte hämta admindata.';
      return;
    }

    if (secretInput) {
      localStorage.setItem(ADMIN_SECRET_KEY, secretInput.value);
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
}

function renderSiteFooter() {
  if (document.body.dataset.noFooter === 'true' || document.querySelector('.site-footer')) {
    return;
  }

  const footer = document.createElement('footer');
  footer.className = 'site-footer fade';
  footer.innerHTML = `
    <div class="site-footer-inner">
      <div>
        <a class="footer-logo" href="index.html">VERSEN</a>
        <p>Medlemsbaserad handel med priser låsta för aktiva medlemmar.</p>
      </div>
      <nav aria-label="Sidfot">
        <a href="faq.html">FAQ</a>
        <a href="villkor.html">Regler och villkor</a>
        <a href="integritet.html">Integritet</a>
        <a href="returer.html">Returer</a>
        <a href="kontakt.html">Kontakt</a>
      </nav>
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
