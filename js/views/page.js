export async function mount(root) {
  root.innerHTML = '';
  const tpl = document.getElementById('tpl-faq');
  const screen = tpl.content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  screen.querySelector('[data-action="back"]').addEventListener('click', () => history.back());
  return () => {};
}