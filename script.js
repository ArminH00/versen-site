const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if(entry.isIntersecting){
      entry.target.classList.add('show');
    }
  });
},{threshold:0.12});

document.querySelectorAll('.fade').forEach((el) => observer.observe(el));

const filters = document.querySelectorAll('[data-filter]');
const products = document.querySelectorAll('[data-category]');

filters.forEach((filter) => {
  filter.addEventListener('click', () => {
    const category = filter.dataset.filter;

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
