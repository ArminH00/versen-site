const CART_KEY = 'versenCart';
let accountSession = null;
const pageParams = new URLSearchParams(window.location.search);
const accountNext = pageParams.get('next') || '';
const verificationToken = pageParams.get('verify') || '';
const activeNavLink = document.querySelector('.menu a.active');

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

  return `
    <article class="product-card" data-category="${escapeHtml(product.category)}" data-product-handle="${escapeHtml(product.handle)}" data-variant-id="${escapeHtml(product.variantId || '')}" data-product-title="${escapeHtml(product.title)}" data-product-price="${escapeHtml(memberPrice)}" data-product-compare-at-price="${escapeHtml(compareAtPrice)}" data-product-image-url="${escapeHtml(product.image && product.image.url ? product.image.url : '')}" data-product-image-alt="${escapeHtml(product.image && product.image.altText ? product.image.altText : product.title)}">
      <div class="product-image">${image}</div>
      <div class="product-info">
        <div class="product-category">${escapeHtml(product.category)}</div>
        <h3>${escapeHtml(product.title)}</h3>
        <div class="product-prices">
          <span class="old">${escapeHtml(compareAtPrice)}</span>
          <span class="new">${escapeHtml(memberPrice)}</span>
        </div>
        <div class="product-actions">
          <a class="product-btn" href="produkt.html?handle=${encodeURIComponent(product.handle)}">Visa produkt</a>
          <button class="product-btn secondary" type="button" data-catalog-add>Lägg i kundkorg</button>
        </div>
      </div>
    </article>
  `;
}

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
  } catch (error) {
    return;
  }
}

loadProducts();

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
    checkoutButton.disabled = !cart.length;
  }

  updateCartCount();
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
  cartCheckoutButton.addEventListener('click', async () => {
    const cart = readCart();
    const message = document.querySelector('[data-cart-message]');

    if (!cart.length) {
      if (message) message.textContent = 'Kundkorgen är tom.';
      return;
    }

    cartCheckoutButton.disabled = true;
    cartCheckoutButton.textContent = 'Skapar checkout...';
    if (message) message.textContent = '';

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
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.membershipRequired) {
          if (message) message.textContent = data.loginRequired ? 'Logga in på kontosidan först.' : 'Aktivt medlemskap krävs innan checkout.';
        } else if (message) {
          message.textContent = data.error || 'Kunde inte skapa checkout.';
        }
        return;
      }

      window.location.href = data.checkoutUrl;
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta checkout.';
    } finally {
      cartCheckoutButton.disabled = false;
      cartCheckoutButton.textContent = 'Gå till checkout';
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

function updateMemberStatus(session = accountSession) {
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
    if (accountFlow) accountFlow.hidden = false;
    if (loginCard) loginCard.hidden = accountNext === 'membership' || Boolean(verificationToken);
    if (createCard) createCard.hidden = false;
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
  if (accountNext === 'membership') {
    window.location.href = 'medlemskap.html?ready=1';
  }
}

async function refreshAccount() {
  if (!document.querySelector('[data-account-area]') && !document.querySelector('[data-membership-checkout]')) {
    return;
  }

  try {
    const response = await fetch('/api/account', { credentials: 'same-origin' });
    accountSession = await response.json();
    updateMemberStatus(accountSession);
  } catch (error) {
    accountSession = { authenticated: false };
    updateMemberStatus(accountSession);
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
const loginCard = document.querySelector('[data-login-card]');
const createCard = document.querySelector('[data-create-card]');

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

    try {
      const { response, data } = await postJson('/api/membership-checkout', {});

      if (!response.ok) {
        if (message) {
          message.textContent = data.loginRequired
            ? 'Skapa konto eller logga in på kontosidan först.'
            : (data.error || 'Kunde inte starta medlemskap.');
        }
        return;
      }

      window.location.href = data.checkoutUrl;
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta checkout.';
    } finally {
      membershipCheckoutButton.disabled = false;
      membershipCheckoutButton.textContent = 'Starta medlemskap';
    }
  });
}

const adminForm = document.querySelector('[data-admin-form]');

if (adminForm) {
  const message = document.querySelector('[data-admin-message]');
  const membersList = document.querySelector('[data-admin-members]');

  adminForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(adminForm);
    if (message) message.textContent = 'Hämtar medlemmar...';

    try {
      const response = await fetch('/api/admin-members', {
        headers: {
          Authorization: `Bearer ${formData.get('adminSecret')}`,
        },
      });
      const data = await response.json();

      if (!response.ok) {
        if (message) message.textContent = data.error || 'Kunde inte hämta medlemmar.';
        return;
      }

      if (message) message.textContent = `${data.members.length} medlemmar hittades.`;
      if (membersList) {
        membersList.innerHTML = data.members.length
          ? data.members.map((member) => `
            <div class="order-row">
              <strong>${escapeHtml(member.name || member.email)}</strong>
              <span>${escapeHtml(member.amountSpent)}</span>
              <small>${escapeHtml(member.email || '')}</small>
              <p>${escapeHtml(member.numberOfOrders)} ordrar · ${escapeHtml((member.tags || []).join(', '))}</p>
            </div>
          `).join('')
          : '<span>Inga medlemmar hittades</span><p>Kontrollera att kundtaggen matchar Vercel-inställningen.</p>';
      }
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
    }
  });
}

renderCart();
updateCartCount();
refreshAccount();
