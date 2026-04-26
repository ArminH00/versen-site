const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if(entry.isIntersecting){
      entry.target.classList.add('show');
    }
  });
},{threshold:0.12});

document.querySelectorAll('.fade').forEach((el) => observer.observe(el));

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
    ? `<img src="${product.image.url}" alt="${product.image.altText || product.title}">`
    : 'Bild';

  const compareAtPrice = product.compareAtPrice || product.price || '';
  const memberPrice = product.price || 'Pris kommer';

  return `
    <article class="product-card" data-category="${product.category}" data-product-handle="${product.handle}" data-variant-id="${product.variantId || ''}">
      <div class="product-image">${image}</div>
      <div class="product-info">
        <div class="product-category">${product.category}</div>
        <h3>${product.title}</h3>
        <div class="product-prices">
          <span class="old">${compareAtPrice}</span>
          <span class="new">${memberPrice}</span>
        </div>
        <a class="product-btn" href="produkt.html?handle=${encodeURIComponent(product.handle)}">Visa produkt</a>
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
  detail.dataset.productHandle = product.handle || '';
  setText('[data-product-category]', product.category);
  setText('[data-product-title]', product.title);
  setText('[data-product-description]', product.description || 'Produktinformation hämtas från Shopify.');
  setText('[data-product-compare-price]', product.compareAtPrice || product.price);
  setText('[data-product-price]', product.price || 'Pris kommer');

  const image = document.querySelector('[data-product-image]');
  if (image && product.image && product.image.url) {
    image.innerHTML = `<img src="${product.image.url}" alt="${product.image.altText || product.title}">`;
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

const checkoutButton = document.querySelector('[data-checkout-button]');

if (checkoutButton) {
  checkoutButton.addEventListener('click', async () => {
    const detail = document.querySelector('[data-product-detail]');
    const message = document.querySelector('[data-checkout-message]');
    const variantId = detail && detail.dataset.variantId;
    const memberCode = localStorage.getItem('versenMemberCode');

    if (!variantId) {
      if (message) message.textContent = 'Produkten är inte redo för checkout ännu.';
      return;
    }

    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Skapar checkout...';
    if (message) message.textContent = '';

    try {
      const response = await fetch('/api/cart', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          variantId,
          quantity: 1,
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
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Gå till checkout';
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
