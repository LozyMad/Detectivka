(() => {
  const palette = [
    ['yellow', 'Жёлтый', '#f9e77d'], ['pink', 'Розовый', '#f5a9b6'],
    ['blue', 'Голубой', '#a9d6f6'], ['green', 'Зелёный', '#c7e7a3'],
    ['orange', 'Оранжевый', '#ffbd79'], ['purple', 'Сиреневый', '#ceb8ea'],
    ['mint', 'Мятный', '#a8e6df']
  ];
  const state = { notes: [], links: [], zoom: 1, width: 2400, height: 1600,
    pendingLink: null, editing: null, trip: null, free: false, centred: false, statusTimer: null };
  const $ = id => document.getElementById(id);
  const noteById = id => state.notes.find(note => Number(note.id) === Number(id));
  const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  async function request(path, options = {}) {
    const response = await fetch(`/api/game/board${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${gameStorage.getItem('token')}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Не удалось сохранить доску');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function status(message, permanent = false) {
    clearTimeout(state.statusTimer);
    $('boardStatus').textContent = message;
    if (message && !permanent) state.statusTimer = setTimeout(() => { $('boardStatus').textContent = ''; }, 5000);
  }

  function updateDimensions() {
    const viewport = $('boardViewport');
    state.width = Math.max(2400, Math.ceil(viewport.clientWidth / state.zoom) + 1,
      ...state.notes.map(note => Number(note.x) + 450));
    state.height = Math.max(1600, Math.ceil(viewport.clientHeight / state.zoom) + 1,
      ...state.notes.map(note => Number(note.y) + 420));
    $('boardCanvas').style.width = `${state.width}px`;
    $('boardCanvas').style.height = `${state.height}px`;
    $('boardCanvas').style.transform = `scale(${state.zoom})`;
    $('boardScaleShell').style.width = `${state.width * state.zoom}px`;
    $('boardScaleShell').style.height = `${state.height * state.zoom}px`;
    $('boardZoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function renderNotes() {
    if (!state.notes.length) {
      $('boardNotes').innerHTML = '<div class="board-empty">Доска пока пуста.<br>Создайте стикер или прикрепите место из игры.</div>';
      return;
    }
    $('boardNotes').innerHTML = state.notes.map(note => {
      const tilt = ((Number(note.id) * 7) % 7 - 3) * .45;
      return `<article class="investigation-note ${state.pendingLink === Number(note.id) ? 'is-connecting' : ''}"
        data-id="${Number(note.id)}" data-color="${escape(note.color)}" tabindex="0" role="button"
        aria-label="Открыть стикер: ${escape(note.title)}"
        style="left:${Number(note.x)}px;top:${Number(note.y)}px;--note-tilt:${tilt}deg">
          <button type="button" class="board-note-link" title="Соединить с другим стикером" aria-label="Протянуть нить от ${escape(note.title)}">Нить</button>
          <span class="board-note-body">
            <strong class="board-note-title">${escape(note.title)}</strong>
            ${note.address_label ? `<small class="board-note-address">${escape(note.address_label)}</small>` : ''}
            <span class="board-note-comment">${escape(note.comment || 'Без заметки')}</span>
          </span>
        </article>`;
    }).join('');
  }

  function segment(x1, y1, x2, y2, linkId) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    return `<button type="button" class="board-thread-segment" data-link-id="${Number(linkId)}"
      aria-label="Удалить нить" title="Нажмите, чтобы удалить нить"
      style="left:${x1}px;top:${y1 - 12}px;width:${length}px;transform:rotate(${angle}deg)"></button>`;
  }

  function renderThreads() {
    $('boardThreads').innerHTML = state.links.map(link => {
      const a = noteById(link.note_a);
      const b = noteById(link.note_b);
      if (!a || !b) return '';
      const ax = Number(a.x) + 150, ay = Number(a.y) + 34;
      const bx = Number(b.x) + 150, by = Number(b.y) + 34;
      const sag = Math.min(22, Math.hypot(bx - ax, by - ay) * .028);
      const mx = (ax + bx) / 2, my = (ay + by) / 2 + sag;
      return segment(ax, ay, mx, my, link.id) + segment(mx, my, bx, by, link.id);
    }).join('');
  }

  function renderPins() {
    $('boardPins').innerHTML = state.notes.map(note => `<span class="board-pin"
      style="left:${Number(note.x) + 133}px;top:${Number(note.y) + 12}px"></span>`).join('');
  }

  function render() {
    updateDimensions();
    renderNotes();
    renderThreads();
    renderPins();
  }

  async function load() {
    const data = await request('');
    state.notes = data.notes || [];
    state.links = data.links || [];
    render();
  }

  function centerOn(note) {
    const viewport = $('boardViewport');
    const x = note ? Number(note.x) + 150 : state.width / 2;
    const y = note ? Number(note.y) + 150 : state.height / 2;
    viewport.scrollLeft = x * state.zoom - viewport.clientWidth / 2;
    viewport.scrollTop = y * state.zoom - viewport.clientHeight / 2;
  }

  async function show(focusId) {
    try {
      await load();
      requestAnimationFrame(() => {
        if (focusId) centerOn(noteById(focusId));
        else if (!state.centred) centerOn();
        state.centred = true;
      });
    } catch (error) {
      status(error.message);
    }
  }

  function setColor(color) {
    $('boardNoteForm').dataset.color = color;
    const option = document.querySelector(`input[name="boardColor"][value="${color}"]`);
    if (option) option.checked = true;
  }

  function openDialog({ note = null, trip = null, free = false }) {
    state.editing = note;
    state.trip = trip;
    state.free = free || !!note && Number(note.address_id) < 0;
    const title = note?.title || (trip?.locationNames || []).filter(Boolean).join(' / ') ||
      (trip ? `Место: район ${trip.district}, дом ${trip.houseNumber}` : '');
    const address = note?.address_label || (trip ? `Район ${trip.district}, дом ${trip.houseNumber}${trip.apartment ? `, кв./офис ${trip.apartment}` : ''}` : '');
    $('boardNoteHeading').textContent = note ? 'Стикер на доске' : state.free ? 'Новый стикер' : 'Новое место на доске';
    $('boardNoteTitle').textContent = title;
    $('boardNoteTitle').hidden = state.free;
    $('boardNoteTitleInputWrap').hidden = !state.free;
    $('boardNoteTitleInput').required = state.free;
    $('boardNoteTitleInput').value = state.free ? title : '';
    $('boardNoteAddress').textContent = address;
    $('boardNoteAddress').hidden = state.free;
    $('boardNoteComment').value = note?.comment || '';
    $('boardNoteSave').textContent = note ? 'Сохранить изменения' : state.free ? 'Создать стикер' : 'Прикрепить на доску';
    $('boardNoteDelete').hidden = !note;
    setColor(note?.color || 'yellow');
    $('boardNoteOverlay').hidden = false;
    (state.free ? $('boardNoteTitleInput') : $('boardNoteComment')).focus();
  }

  function closeDialog() {
    $('boardNoteOverlay').hidden = true;
    state.editing = null;
    state.trip = null;
    state.free = false;
  }

  async function openFromTrip(trip) {
    try {
      await load();
      const existing = state.notes.find(note => Number(note.address_id) === Number(trip.address_id));
      if (existing) {
        alert('Это место уже находится на доске. Открою существующий стикер.');
        $('board-tab').click();
        requestAnimationFrame(() => centerOn(existing));
        return;
      }
    } catch (error) {
      alert(error.message);
      return;
    }
    openDialog({ trip });
  }

  async function saveDialog(event) {
    event.preventDefault();
    const button = $('boardNoteSave');
    const color = document.querySelector('input[name="boardColor"]:checked')?.value || 'yellow';
    const fields = { comment: $('boardNoteComment').value, color,
      ...(state.free ? { title: $('boardNoteTitleInput').value } : {}) };
    button.disabled = true;
    try {
      let note;
      if (state.editing) {
        ({ note } = await request(`/notes/${state.editing.id}`, { method: 'PATCH', body: JSON.stringify(fields) }));
        state.notes = state.notes.map(item => Number(item.id) === Number(note.id) ? note : item);
        closeDialog();
        render();
        status('Стикер обновлён');
      } else {
        ({ note } = await request(state.free ? '/notes/free' : '/notes', { method: 'POST',
          body: JSON.stringify({ ...(state.trip ? { address_id: state.trip.address_id } : {}), ...fields }) }));
        state.notes.push(note);
        closeDialog();
        $('board-tab').click();
        requestAnimationFrame(() => centerOn(note));
        status('Стикер прикреплён на доску');
      }
    } catch (error) {
      if (error.status === 409 && error.data?.note) {
        closeDialog();
        alert('Это место уже находится на доске. Открою существующий стикер.');
        $('board-tab').click();
        requestAnimationFrame(() => centerOn(error.data.note));
      } else {
        alert(error.message);
      }
    } finally {
      button.disabled = false;
    }
  }

  async function deleteCurrentNote() {
    const note = state.editing;
    if (!note || !confirm(`Удалить стикер «${note.title}» и все его нити?`)) return;
    try {
      await request(`/notes/${note.id}`, { method: 'DELETE' });
      state.notes = state.notes.filter(item => Number(item.id) !== Number(note.id));
      state.links = state.links.filter(link => Number(link.note_a) !== Number(note.id) && Number(link.note_b) !== Number(note.id));
      closeDialog();
      render();
      status('Стикер удалён');
    } catch (error) { alert(error.message); }
  }

  async function connect(secondId) {
    const firstId = state.pendingLink;
    if (!firstId) return;
    if (firstId === secondId) {
      state.pendingLink = null;
      status('Соединение отменено');
      renderNotes();
      return;
    }
    try {
      const { link } = await request('/links', { method: 'POST',
        body: JSON.stringify({ first_id: firstId, second_id: secondId }) });
      state.links.push(link);
      renderThreads();
      status('Стикеры соединены ниткой');
    } catch (error) { status(error.message); }
    state.pendingLink = null;
    $('boardHint').textContent = 'Перетащите стикеры. Нажмите на кнопку у стикера, чтобы соединить его ниткой с другим.';
    renderNotes();
  }

  function onNoteDown(event) {
    const element = event.target.closest('.investigation-note');
    if (!element || event.target.closest('.board-note-link') || event.button !== 0) return;
    const note = noteById(element.dataset.id);
    if (!note) return;
    const start = { x: event.clientX, y: event.clientY, noteX: Number(note.x), noteY: Number(note.y), moved: false };
    element.setPointerCapture(event.pointerId);
    const move = e => {
      const dx = (e.clientX - start.x) / state.zoom;
      const dy = (e.clientY - start.y) / state.zoom;
      if (!start.moved && Math.hypot(dx, dy) < 5) return;
      start.moved = true;
      element.classList.add('is-dragging');
      note.x = Math.max(0, Math.round(start.noteX + dx));
      note.y = Math.max(0, Math.round(start.noteY + dy));
      element.style.left = `${note.x}px`;
      element.style.top = `${note.y}px`;
      updateDimensions();
      renderThreads();
      renderPins();
    };
    const up = async () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
      element.classList.remove('is-dragging');
      if (!start.moved) {
        if (state.pendingLink) await connect(Number(note.id));
        else openDialog({ note });
        return;
      }
      try {
        await request(`/notes/${note.id}/position`, { method: 'PATCH',
          body: JSON.stringify({ x: note.x, y: note.y }) });
      } catch (error) {
        note.x = start.noteX; note.y = start.noteY;
        render();
        status(`Положение не сохранено: ${error.message}`);
      }
    };
    const cancel = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
      note.x = start.noteX; note.y = start.noteY;
      render();
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel);
  }

  function onNoteClick(event) {
    const handle = event.target.closest('.board-note-link');
    if (!handle) return;
    event.preventDefault();
    const note = handle.closest('.investigation-note');
    const id = Number(note?.dataset.id);
    if (!id) return;
    if (state.pendingLink && state.pendingLink !== id) { connect(id); return; }
    state.pendingLink = state.pendingLink === id ? null : id;
    $('boardHint').textContent = state.pendingLink
      ? 'Теперь нажмите на второй стикер. Esc отменяет соединение.'
      : 'Перетащите стикеры. Нажмите на кнопку у стикера, чтобы соединить его ниткой с другим.';
    status(state.pendingLink ? 'Выберите второй стикер для красной нити' : 'Соединение отменено', !!state.pendingLink);
    renderNotes();
  }

  async function onThreadClick(event) {
    const segment = event.target.closest('.board-thread-segment');
    if (!segment) return;
    const link = state.links.find(item => Number(item.id) === Number(segment.dataset.linkId));
    if (!link || !confirm('Удалить эту нить? Стикеры останутся на доске.')) return;
    try {
      await request(`/links/${link.id}`, { method: 'DELETE' });
      state.links = state.links.filter(item => Number(item.id) !== Number(link.id));
      renderThreads();
      status('Нить удалена');
    } catch (error) { status(error.message); }
  }

  function changeZoom(next, pointer) {
    const viewport = $('boardViewport');
    const old = state.zoom;
    state.zoom = Math.max(.4, Math.min(2.5, Math.round(next * 100) / 100));
    if (state.zoom === old) return;
    const bounds = viewport.getBoundingClientRect();
    const px = pointer ? pointer.clientX - bounds.left - viewport.clientLeft : viewport.clientWidth / 2;
    const py = pointer ? pointer.clientY - bounds.top - viewport.clientTop : viewport.clientHeight / 2;
    const cx = (viewport.scrollLeft + px) / old;
    const cy = (viewport.scrollTop + py) / old;
    updateDimensions();
    viewport.scrollLeft = cx * state.zoom - px;
    viewport.scrollTop = cy * state.zoom - py;
  }

  function leaveBoard() {
    state.pendingLink = null;
    $('boardHint').textContent = 'Перетащите стикеры. Нажмите на кнопку у стикера, чтобы соединить его ниткой с другим.';
    $('game-tab').click();
  }

  function setupPan() {
    const viewport = $('boardViewport');
    viewport.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('.investigation-note, .board-thread-segment')) return;
      const start = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-panning');
      const move = e => {
        viewport.scrollLeft = start.left - (e.clientX - start.x);
        viewport.scrollTop = start.top - (e.clientY - start.y);
      };
      const done = () => {
        viewport.classList.remove('is-panning');
        viewport.removeEventListener('pointermove', move);
        viewport.removeEventListener('pointerup', done);
        viewport.removeEventListener('pointercancel', done);
      };
      viewport.addEventListener('pointermove', move);
      viewport.addEventListener('pointerup', done);
      viewport.addEventListener('pointercancel', done);
    });
  }

  function init() {
    if (!gameStorage.getItem('roomUser')) {
      $('board-tab').hidden = true;
      return;
    }
    $('boardColorOptions').innerHTML = palette.map(([value, label, swatch]) =>
      `<label class="board-color-option" title="${label}"><input type="radio" name="boardColor" value="${value}" aria-label="${label}"><span style="--swatch:${swatch}"></span></label>`).join('');
    $('boardColorOptions').addEventListener('change', event => {
      if (event.target.name === 'boardColor') setColor(event.target.value);
    });
    $('boardNoteForm').addEventListener('submit', saveDialog);
    $('boardNoteCancel').addEventListener('click', closeDialog);
    $('boardNoteClose').addEventListener('click', closeDialog);
    $('boardNoteDelete').addEventListener('click', deleteCurrentNote);
    $('boardNoteOverlay').addEventListener('click', event => {
      if (event.target === $('boardNoteOverlay')) closeDialog();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!$('boardNoteOverlay').hidden) closeDialog();
      else if (state.pendingLink) {
        state.pendingLink = null;
        $('boardHint').textContent = 'Перетащите стикеры. Нажмите на кнопку у стикера, чтобы соединить его ниткой с другим.';
        status('Соединение отменено');
        renderNotes();
      } else if ($('board').classList.contains('active')) leaveBoard();
    });
    $('boardNotes').addEventListener('pointerdown', onNoteDown);
    $('boardNotes').addEventListener('click', onNoteClick);
    $('boardNotes').addEventListener('keydown', event => {
      if (event.target.classList.contains('investigation-note') && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        const id = Number(event.target.dataset.id);
        if (state.pendingLink) connect(id);
        else openDialog({ note: noteById(id) });
      }
    });
    $('boardThreads').addEventListener('click', onThreadClick);
    $('boardZoomIn').addEventListener('click', () => changeZoom(state.zoom + .15));
    $('boardZoomOut').addEventListener('click', () => changeZoom(state.zoom - .15));
    $('boardZoomReset').addEventListener('click', () => { changeZoom(1); centerOn(); });
    $('boardCreate').addEventListener('click', () => openDialog({ free: true }));
    $('boardExit').addEventListener('click', leaveBoard);
    $('boardViewport').addEventListener('wheel', event => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? $('boardViewport').clientHeight : 1;
      changeZoom(state.zoom * Math.exp(-event.deltaY * unit * .0012), event);
    }, { passive: false });
    window.addEventListener('resize', updateDimensions);
    setupPan();
    render();
  }

  window.investigationBoard = { show, openFromTrip };
  document.addEventListener('DOMContentLoaded', init);
})();
