'use strict';

// A spoiler-free illustration, separate from the authenticated game board and its API.
document.querySelectorAll('[data-board-demo]').forEach(demo => {
  const controls = demo.querySelector('.board-demo-controls');
  const buttons = [...demo.querySelectorAll('[data-board-step]')];
  const notes = [...demo.querySelectorAll('.board-demo-note')];
  const threads = demo.querySelector('.board-demo-threads');
  const caption = demo.querySelector('[data-board-caption]');
  const next = demo.querySelector('.board-demo-next');
  const descriptions = [
    'Прикрепите посещённое место и запишите, что удалось узнать. Важная зацепка останется перед глазами.',
    'Создайте свой стикер с наблюдением или версией. Отделите то, что уже известно, от того, что ещё предстоит проверить.',
    'Соедините связанные стикеры нитями. Сопоставьте находки и решите, какой адрес проверить следующим.'
  ];
  let current = 3;

  function drawThreads() {
    const canvas = demo.querySelector('.board-demo-canvas');
    canvas.style.setProperty('--board-pixel-ratio', window.devicePixelRatio || 1);
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    threads.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const anchors = notes.map(note => {
      const rect = note.getBoundingClientRect();
      return { x: rect.left - bounds.left + rect.width / 2, y: rect.top - bounds.top + rect.height * .18 };
    });
    const paths = [...threads.querySelectorAll('path')];
    threads.style.setProperty('--demo-fastener-mask', notes.map(note => {
      const rect = note.getBoundingClientRect();
      const x = rect.left - bounds.left + rect.width / 2;
      const y = rect.top - bounds.top + rect.height * .143;
      return `radial-gradient(ellipse ${rect.width * .08}px ${rect.height * .097}px at ${x}px ${y}px, transparent 97%, #000 100%)`;
    }).join(','));
    paths.forEach((path, index) => {
      const a = anchors[index], b = anchors[index + 1];
      path.setAttribute('d', `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2 + 10} ${(a.y + b.y) / 2 + 20} ${b.x} ${b.y}`);
    });
  }

  function showStep(step) {
    current = step;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.boardStep) === step)));
    notes.forEach(note => {
      const hidden = Number(note.dataset.boardItem) > step;
      note.classList.toggle('is-board-hidden', hidden);
      note.setAttribute('aria-hidden', String(hidden));
    });
    threads.classList.toggle('is-board-hidden', step < 3);
    if (caption) caption.textContent = descriptions[step - 1];
    if (next) next.textContent = step === 3 ? 'Посмотреть сначала' : step === 1 ? 'Дальше: записать версию' : 'Дальше: связать находки';
    drawThreads();
  }

  buttons.forEach(button => button.addEventListener('click', () => showStep(Number(button.dataset.boardStep))));
  if (next) next.addEventListener('click', () => showStep(current === 3 ? 1 : current + 1));
  controls.hidden = false;
  if (next) next.hidden = false;
  // Show the whole example first so visitors immediately understand what the board does.
  showStep(3);
  if ('ResizeObserver' in window) new ResizeObserver(drawThreads).observe(demo.querySelector('.board-demo-canvas'));
  else window.addEventListener('resize', drawThreads);
});
