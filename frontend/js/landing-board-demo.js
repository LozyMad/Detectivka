'use strict';

// A spoiler-free illustration, separate from the authenticated game board and its API.
document.querySelectorAll('[data-board-demo]').forEach(demo => {
  const controls = demo.querySelector('.board-demo-controls');
  const buttons = [...demo.querySelectorAll('[data-board-step]')];
  const notes = [...demo.querySelectorAll('.board-demo-note')];
  const canvas = demo.querySelector('.board-demo-canvas');
  const threads = demo.querySelector('.board-demo-threads');
  const caption = demo.querySelector('[data-board-caption]');
  const next = demo.querySelector('.board-demo-next');
  const descriptions = [
    'Прикрепите посещённое место и запишите, что удалось узнать. Важная зацепка останется перед глазами.',
    'Создайте свой стикер с наблюдением или версией. Отделите то, что уже известно, от того, что ещё предстоит проверить.',
    'Соедините связанные стикеры нитями. Сопоставьте находки и решите, какой адрес проверить следующим.'
  ];
  let current = 3;
  const fastenerLayer = document.createElement('div');
  fastenerLayer.className = 'board-demo-fasteners';
  fastenerLayer.setAttribute('aria-hidden', 'true');
  canvas.append(fastenerLayer);
  const fasteners = notes.map(note => {
    // The marker inherits the paper's rotation, keeping the thread on the pin.
    const anchor = document.createElement('span');
    anchor.className = 'board-demo-anchor';
    anchor.setAttribute('aria-hidden', 'true');
    note.append(anchor);
    const fastener = document.createElement('span');
    fastener.className = 'board-demo-fastener';
    fastener.dataset.boardItem = note.dataset.boardItem;
    fastenerLayer.append(fastener);
    return fastener;
  });

  function drawThreads() {
    canvas.style.setProperty('--board-pixel-ratio', window.devicePixelRatio || 1);
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    threads.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const anchors = notes.map((note, index) => {
      const style = getComputedStyle(note);
      const fastener = fasteners[index];
      Object.assign(fastener.style, {
        left: `${note.offsetLeft}px`, top: `${note.offsetTop}px`,
        width: style.width, height: style.height, transform: style.transform
      });
      fastener.style.setProperty('--demo-note', style.getPropertyValue('--demo-note'));
      const rect = note.querySelector('.board-demo-anchor').getBoundingClientRect();
      return { x: rect.left - bounds.left, y: rect.top - bounds.top };
    });
    const paths = [...threads.querySelectorAll('path')];
    const stacked = notes[1].offsetTop - notes[0].offsetTop > notes[0].offsetHeight / 2;
    paths.forEach((path, index) => {
      const a = anchors[index], b = anchors[index + 1];
      if (stacked) {
        // Route through the paper's transparent side margin, clear of its text.
        const pair = notes.slice(index, index + 2).map(note => note.getBoundingClientRect());
        const side = index === 0
          ? Math.min(...pair.map(rect => rect.left + rect.width * .035)) - bounds.left
          : Math.max(...pair.map(rect => rect.right - rect.width * .035)) - bounds.left;
        const bend = Math.min(24, Math.abs(b.y - a.y) / 4);
        path.setAttribute('d', `M ${a.x} ${a.y} C ${side} ${a.y} ${side} ${a.y} ${side} ${a.y + bend} L ${side} ${b.y - bend} C ${side} ${b.y} ${side} ${b.y} ${b.x} ${b.y}`);
      } else {
        path.setAttribute('d', `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 + 18} ${b.x} ${b.y}`);
      }
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
    fasteners.forEach(fastener => fastener.classList.toggle('is-board-hidden', Number(fastener.dataset.boardItem) > step));
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
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(drawThreads);
    [canvas, ...notes].forEach(element => observer.observe(element));
  } else window.addEventListener('resize', drawThreads);
});
