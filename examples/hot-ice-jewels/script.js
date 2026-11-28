const menuButton = document.querySelector('.menu-button');
const mobileMenu = document.querySelector('.mobile-menu');
const announcement = document.querySelector('.announcement');
const closeAnnouncement = document.querySelector('.announcement-close');
const quickAddButtons = document.querySelectorAll('.quick-add');
const bagCount = document.querySelector('.bag-button span');

menuButton?.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  mobileMenu?.classList.toggle('open', !isOpen);
});

closeAnnouncement?.addEventListener('click', () => {
  announcement.remove();
});

quickAddButtons.forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    bagCount.textContent = String(Number(bagCount.textContent) + 1);
    button.textContent = 'Added';
    window.setTimeout(() => {
      button.textContent = 'Quick add';
    }, 1200);
  });
});
