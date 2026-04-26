const CART_KEY = 'versenCart';

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
    const memberCode = localStorage.getItem('versenMemberCode');

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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: cart.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          })),
          memberCode,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.membershipRequired) {
          if (message) message.textContent = 'Logga in som medlem på kontosidan först.';
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

function updateMemberStatus() {
  const status = document.querySelector('[data-member-status]');

  if (!status) {
    return;
  }

  const isMember = localStorage.getItem('versenMember') === 'true';
  status.textContent = isMember ? 'Aktiv medlem' : 'Ej inloggad';
}

const memberForm = document.querySelector('[data-member-form]');

if (memberForm) {
  const message = document.querySelector('[data-member-message]');

  updateMemberStatus();

  memberForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(memberForm);
    const memberCode = formData.get('memberCode');

    if (message) {
      message.textContent = 'Kontrollerar medlemskap...';
    }

    try {
      const response = await fetch('/api/member-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ memberCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        localStorage.removeItem('versenMember');
        localStorage.removeItem('versenMemberCode');
        updateMemberStatus();
        if (message) message.textContent = data.error || 'Kunde inte logga in.';
        return;
      }

      localStorage.setItem('versenMember', 'true');
      localStorage.setItem('versenMemberCode', memberCode);
      updateMemberStatus();
      if (message) message.textContent = data.status || 'Du är inloggad som medlem.';
    } catch (error) {
      if (message) message.textContent = 'Kunde inte kontakta servern.';
    }
  });
}

renderCart();
updateCartCount();
