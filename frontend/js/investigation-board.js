(() => {
  const palette = [
    ['yellow', 'Жёлтый', '#f9e77d'], ['pink', 'Розовый', '#f5a9b6'],
    ['blue', 'Голубой', '#a9d6f6'], ['green', 'Зелёный', '#c7e7a3'],
    ['purple', 'Сиреневый', '#ceb8ea']
  ];
  // Older saved colors use the closest available paper without changing saved notes.
  const paperColor = color => ({ orange: 'yellow', mint: 'green' }[color] ||
    (palette.some(([value]) => value === color) ? color : 'yellow'));
  const noteTilt = id => ((Number(id) * 7) % 7 - 3) * .45;
  const state = { notes: [], links: [], zoom: 1, width: 2400, height: 1600,
    pendingLink: null, connecting: false, editing: null, trip: null, free: false, centred: false, fitView: false, statusTimer: null, revision: 0 };
  let loadPromise = null;
  let positionDrain = null;
  let viewportSize = null;
  let resizeFitFrame = null;
  const pendingPositions = new Map();
  const defaultHint = 'Нажмите на два стикера, чтобы создать или убрать нить. Перетаскивайте стикеры и приближайте доску.';
  const threadSegments = new Map();
  const $ = id => document.getElementById(id);
  const noteById = id => state.notes.find(note => Number(note.id) === Number(id));
  const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  async function request(path, options = {}) {
    let response;
    try {
      response = await window.gameNetwork.fetch(`/api/game/board${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${gameStorage.getItem('token')}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
      });
    } catch (error) {
      if (options.method && options.method !== 'GET' && error.name !== 'AbortError') {
        error.message += ' Проверьте доску перед повторной попыткой: изменение могло сохраниться.';
      }
      throw error;
    }
    // Invalid JSON must not silently erase the board or report a save as successful.
    const data = response.ok ? await response.json() : await response.json().catch(() => ({}));
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
    // Include scrollbar space so zooming them away cannot expose an untextured strip.
    const viewportWidth = viewport.offsetWidth || viewport.clientWidth;
    const viewportHeight = viewport.offsetHeight || viewport.clientHeight;
    state.width = Math.max(2400, Math.ceil(viewportWidth / state.zoom) + 1,
      ...state.notes.map(note => Number(note.x) + 450));
    state.height = Math.max(1600, Math.ceil(viewportHeight / state.zoom) + 1,
      ...state.notes.map(note => Number(note.y) + 420));
    $('boardCanvas').style.width = `${state.width * state.zoom}px`;
    $('boardCanvas').style.height = `${state.height * state.zoom}px`;
    // Render at screen size: iPad Safari can ignore CSS zoom for explicitly styled text.
    // No scaled compositing layer is needed, so small text and cork remain sharp.
    $('boardCanvas').style.setProperty('--board-zoom', state.zoom);
    $('boardCanvas').style.setProperty('--board-title-size', `${Math.min(20, Math.max(18, 10 / state.zoom)) * state.zoom}px`);
    $('boardCanvas').style.setProperty('--board-comment-size', `${Math.min(15, Math.max(14, 9 / state.zoom)) * state.zoom}px`);
    $('boardScaleShell').style.width = `${state.width * state.zoom}px`;
    $('boardScaleShell').style.height = `${state.height * state.zoom}px`;
    $('boardZoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
    // Keep the same board point in view when tablet rotation or the toolbar changes its size.
    // Ignore the hidden tab: a zero-sized viewport must not replace its previous geometry.
    if (viewportWidth && viewportHeight) {
      const resized = viewportSize && (viewportSize.width !== viewportWidth || viewportSize.height !== viewportHeight);
      if (viewportSize) {
        viewport.scrollLeft += (viewportSize.width - viewportWidth) / 2;
        viewport.scrollTop += (viewportSize.height - viewportHeight) / 2;
      }
      viewportSize = { width: viewportWidth, height: viewportHeight };
      // An overview still shows every note after rotation; a manually zoomed view keeps its center.
      if (resized && state.fitView && resizeFitFrame === null) {
        resizeFitFrame = requestAnimationFrame(() => {
          resizeFitFrame = null;
          if (state.fitView && viewport.clientWidth && viewport.clientHeight) fitNotes();
        });
      }
    }
  }

  const scaledLength = value => `calc(${Number(value)}px * var(--board-zoom, 1))`;

  function renderNotes() {
    if (!state.notes.length) {
      $('boardNotes').innerHTML = '<div class="board-empty">Доска пока пуста.<br>Создайте стикер или прикрепите место из игры.</div>';
      return;
    }
    $('boardNotes').innerHTML = state.notes.map(note => {
      const tilt = noteTilt(note.id);
      return `<article class="investigation-note ${state.pendingLink === Number(note.id) ? 'is-connecting' : ''}"
        data-id="${Number(note.id)}" data-color="${paperColor(note.color)}" tabindex="0" role="button"
        aria-label="Выбрать стикер: ${escape(note.title)}" aria-pressed="${state.pendingLink === Number(note.id)}"
        style="left:${scaledLength(note.x)};top:${scaledLength(note.y)};--note-tilt:${tilt}deg">
          <button type="button" class="board-note-edit" title="Редактировать стикер" aria-label="Редактировать стикер: ${escape(note.title)}">⋯</button>
          <span class="board-note-body">
            <strong class="board-note-title">${escape(note.title)}</strong>
            ${note.address_label ? `<small class="board-note-address">${escape(note.address_label)}</small>` : ''}
            <span class="board-note-comment">${escape(note.comment || 'Без заметки')}</span>
          </span>
        </article>`;
    }).join('');
  }

  function renderFasteners() {
    $('boardFasteners').innerHTML = state.notes.map(note =>
      `<span id="boardFastener${Number(note.id)}" class="board-note-fastener" data-note-id="${Number(note.id)}"
        data-color="${paperColor(note.color)}" style="left:${scaledLength(note.x)};top:${scaledLength(note.y)};--note-tilt:${noteTilt(note.id)}deg"></span>`
    ).join('');
  }

  function segment(x1, y1, x2, y2, linkId, index) {
    // A small overlap joins the textured pieces without a visible gap.
    const length = Math.hypot(x2 - x1, y2 - y1) + 1.2;
    const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    return `<button type="button" class="board-thread-segment" data-link-id="${Number(linkId)}"
      ${index ? 'tabindex="-1" aria-hidden="true"' : 'aria-label="Удалить нить"'} title="Нажмите, чтобы удалить нить"
      style="left:${scaledLength(x1)};top:${scaledLength(y1 - 12)};width:${scaledLength(length)};transform:rotate(${angle}deg)"></button>`;
  }

  function threadPoints(a, b) {
    // The artwork's shaft is at (150, 46) on a 300px note. Keep the thread beneath the pin cap.
    const anchor = note => {
      const angle = noteTilt(note.id) * Math.PI / 180;
      return { x: Number(note.x) + 150 + 104 * Math.sin(angle),
        y: Number(note.y) + 150 - 104 * Math.cos(angle) };
    };
    const start = anchor(a), end = anchor(b);
    const sag = Math.min(22, Math.hypot(end.x - start.x, end.y - start.y) * .028);
    const control = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 + 2 * sag };
    // Approximate one quadratic curve, sharing every join between neighboring pieces.
    return Array.from({ length: 9 }, (_, index) => {
      const t = index / 8, u = 1 - t;
      return { x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
        y: u * u * start.y + 2 * u * t * control.y + t * t * end.y };
    });
  }

  function renderThreads() {
    $('boardThreads').innerHTML = state.links.map(link => {
      const a = noteById(link.note_a);
      const b = noteById(link.note_b);
      if (!a || !b) return '';
      const points = threadPoints(a, b);
      return points.slice(0, -1).map((start, index) => {
        const end = points[index + 1];
        return segment(start.x, start.y, end.x, end.y, link.id, index);
      }).join('');
    }).join('');
    threadSegments.clear();
    for (const element of $('boardThreads').querySelectorAll('.board-thread-segment')) {
      const id = Number(element.dataset.linkId);
      if (!threadSegments.has(id)) threadSegments.set(id, []);
      threadSegments.get(id).push(element);
    }
  }

  function moveThreads(noteId) {
    const note = noteById(noteId), fastener = $(`boardFastener${noteId}`);
    if (note && fastener) {
      fastener.style.left = scaledLength(note.x);
      fastener.style.top = scaledLength(note.y);
    }
    for (const link of state.links) {
      if (Number(link.note_a) !== noteId && Number(link.note_b) !== noteId) continue;
      const elements = threadSegments.get(Number(link.id));
      const a = noteById(link.note_a), b = noteById(link.note_b);
      if (!elements || !a || !b) continue;
      const points = threadPoints(a, b);
      elements.forEach((element, index) => {
        const start = points[index], end = points[index + 1];
        element.style.left = scaledLength(start.x);
        element.style.top = scaledLength(start.y - 12);
        element.style.width = scaledLength(Math.hypot(end.x - start.x, end.y - start.y) + 1.2);
        element.style.transform = `rotate(${Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI}deg)`;
      });
    }
  }

  function render() {
    updateDimensions();
    renderNotes();
    renderThreads();
    renderFasteners();
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (positionDrain) await positionDrain;
      const revision = state.revision;
      const data = await request('');
      if (!Array.isArray(data.notes) || !Array.isArray(data.links)) throw new Error('Не удалось прочитать доску. Попробуйте открыть её снова.');
      if (revision !== state.revision) return;
      state.notes = data.notes;
      state.links = data.links;
      render();
    })().finally(() => { loadPromise = null; });
    return loadPromise;
  }

  // One save at a time; repeated drags replace the queued position for that note.
  function savePosition(note) {
    pendingPositions.set(Number(note.id), { note, x: note.x, y: note.y });
    return drainPositions();
  }

  function drainPositions() {
    if (positionDrain) return positionDrain;
    positionDrain = (async () => {
      while (pendingPositions.size) {
        const [id, target] = pendingPositions.entries().next().value;
        try {
          await request(`/notes/${id}/position`, { method: 'PATCH', body: JSON.stringify({ x: target.x, y: target.y }) });
        } catch (error) {
          if (pendingPositions.get(id) === target && noteById(id)) {
            // A timed-out save may have reached the server. Do not roll back newer drags.
            status(`Положение не подтверждено: ${error.message}`, true);
          }
        }
        if (pendingPositions.get(id) === target) pendingPositions.delete(id);
      }
    })().finally(() => {
      positionDrain = null;
      if (pendingPositions.size) return drainPositions();
    });
    return positionDrain;
  }

  function centerOn(note) {
    const viewport = $('boardViewport');
    const x = note ? Number(note.x) + 150 : state.notes.length
      ? (Math.min(...state.notes.map(n => Number(n.x))) + Math.max(...state.notes.map(n => Number(n.x))) + 300) / 2 : state.width / 2;
    const y = note ? Number(note.y) + 150 : state.notes.length
      ? (Math.min(...state.notes.map(n => Number(n.y))) + Math.max(...state.notes.map(n => Number(n.y))) + 300) / 2 : state.height / 2;
    viewport.scrollLeft = x * state.zoom - viewport.clientWidth / 2;
    viewport.scrollTop = y * state.zoom - viewport.clientHeight / 2;
  }

  function fitNotes() {
    const viewport = $('boardViewport');
    let zoom = 1;
    if (state.notes.length) {
      const width = Math.max(...state.notes.map(n => Number(n.x))) - Math.min(...state.notes.map(n => Number(n.x))) + 380;
      const height = Math.max(...state.notes.map(n => Number(n.y))) - Math.min(...state.notes.map(n => Number(n.y))) + 380;
      zoom = Math.min(1, viewport.clientWidth / width, viewport.clientHeight / height);
    }
    changeZoom(zoom);
    centerOn();
    state.fitView = true;
  }

  async function show(focusId) {
    try {
      await load();
      requestAnimationFrame(() => {
        if (focusId) { state.fitView = false; centerOn(noteById(focusId)); }
        else if (!state.centred) fitNotes();
        state.centred = true;
      });
    } catch (error) {
      status(error.message);
    }
  }

  function setColor(color) {
    color = paperColor(color);
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
    if (button.disabled) return;
    const color = document.querySelector('input[name="boardColor"]:checked')?.value || 'yellow';
    const fields = { comment: $('boardNoteComment').value, color,
      ...(state.free ? { title: $('boardNoteTitleInput').value } : {}) };
    button.disabled = true;
    state.revision++;
    try {
      let note;
      if (state.editing) {
        ({ note } = await request(`/notes/${state.editing.id}`, { method: 'PATCH', body: JSON.stringify(fields) }));
        state.revision++;
        state.notes = state.notes.map(item => Number(item.id) === Number(note.id) ? { ...note, x: item.x, y: item.y } : item);
        closeDialog();
        render();
        status('Стикер обновлён');
      } else {
        ({ note } = await request(state.free ? '/notes/free' : '/notes', { method: 'POST',
          body: JSON.stringify({ ...(state.trip ? { address_id: state.trip.address_id } : {}), ...fields }) }));
        state.revision++;
        state.notes.push(note);
        render();
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
    const button = $('boardNoteDelete');
    if (button.disabled) return;
    if (!note || !confirm(`Удалить стикер «${note.title}» и все его нити?`)) return;
    button.disabled = true;
    state.revision++;
    try {
      await request(`/notes/${note.id}`, { method: 'DELETE' });
      state.revision++;
      pendingPositions.delete(Number(note.id));
      state.notes = state.notes.filter(item => Number(item.id) !== Number(note.id));
      state.links = state.links.filter(link => Number(link.note_a) !== Number(note.id) && Number(link.note_b) !== Number(note.id));
      closeDialog();
      render();
      status('Стикер удалён');
    } catch (error) { alert(error.message); }
    finally { button.disabled = false; }
  }

  async function connect(secondId) {
    const firstId = state.pendingLink;
    if (!firstId || state.connecting) return;
    if (firstId === secondId) {
      clearSelection();
      return;
    }
    state.connecting = true;
    state.revision++;
    try {
      const existing = state.links.find(link =>
        Number(link.note_a) === firstId && Number(link.note_b) === secondId ||
        Number(link.note_b) === firstId && Number(link.note_a) === secondId);
      if (existing) await deleteLink(existing);
      else {
        const { link } = await request('/links', { method: 'POST',
          body: JSON.stringify({ first_id: firstId, second_id: secondId }) });
        state.revision++;
        if (!state.links.some(item => Number(item.id) === Number(link.id))) state.links.push(link);
        status('Стикеры соединены ниткой');
      }
      renderThreads();
    } catch (error) { status(error.message); }
    state.pendingLink = null;
    state.connecting = false;
    $('boardHint').textContent = defaultHint;
    renderNotes();
  }

  function clearSelection() {
    if (state.connecting) return;
    state.pendingLink = null;
    $('boardHint').textContent = defaultHint;
    status('');
    renderNotes();
  }

  function selectNote(id) {
    if (state.connecting) return;
    if (state.pendingLink === id) { clearSelection(); return; }
    if (state.pendingLink) { connect(id); return; }
    state.pendingLink = id;
    $('boardHint').textContent = 'Нажмите на второй стикер: нить появится или удалится. Повторное нажатие или Esc снимает выделение.';
    status('Выберите второй стикер, чтобы создать или убрать нить', true);
    renderNotes();
  }

  async function deleteLink(link) {
    state.revision++;
    await request(`/links/${link.id}`, { method: 'DELETE' });
    state.revision++;
    state.links = state.links.filter(item => Number(item.id) !== Number(link.id));
    status('Нить удалена');
  }

  async function onThreadClick(event) {
    const segment = event.target.closest('.board-thread-segment');
    if (!segment) return;
    const link = state.links.find(item => Number(item.id) === Number(segment.dataset.linkId));
    if (!link || state.connecting) return;
    state.connecting = true;
    try {
      await deleteLink(link);
      renderThreads();
    } catch (error) { status(error.message); }
    finally { state.connecting = false; }
  }

  function changeZoom(next, pointer) {
    state.fitView = false;
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
    clearSelection();
    $('game-tab').click();
  }

  function setupGestures() {
    const viewport = $('boardViewport');
    const pointers = new Map();
    let gesture = null;
    let noteFrame = null;
    function paintNote() {
      if (!gesture?.note || !gesture.moved) return;
      const { note, element, noteX, noteY } = gesture;
      element.style.transform = `translate3d(${(note.x - noteX) * state.zoom}px, ${(note.y - noteY) * state.zoom}px, 0) rotate(var(--note-tilt))`;
      // Grow the cork only when needed, rather than forcing board layout on every move.
      if (Number(note.x) + 450 > state.width || Number(note.y) + 420 > state.height) updateDimensions();
      moveThreads(Number(note.id));
    }
    function flushNoteFrame(paint = true) {
      if (noteFrame !== null) cancelAnimationFrame(noteFrame);
      noteFrame = null;
      if (paint) paintNote();
    }
    const point = event => ({ x: event.clientX, y: event.clientY });
    const local = p => {
      const bounds = viewport.getBoundingClientRect();
      return { x: p.x - bounds.left - viewport.clientLeft, y: p.y - bounds.top - viewport.clientTop };
    };
    const pair = () => {
      const [a, b] = [...pointers.values()];
      return { center: local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    };
    function restoreNote() {
      if (!gesture?.note) return;
      flushNoteFrame(false);
      gesture.note.x = gesture.noteX;
      gesture.note.y = gesture.noteY;
      render();
    }
    function beginPinch() {
      state.fitView = false;
      // A second finger cancels the tentative sticker drag, including its save.
      restoreNote();
      const { center, distance } = pair();
      gesture = { type: 'pinch', distance, zoom: state.zoom,
        worldX: (viewport.scrollLeft + center.x) / state.zoom,
        worldY: (viewport.scrollTop + center.y) / state.zoom };
      viewport.classList.add('is-panning');
    }
    viewport.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      if (!pointers.size && event.target.closest('.board-note-edit, .board-thread-segment')) return;
      event.preventDefault();
      pointers.set(event.pointerId, point(event));
      viewport.setPointerCapture(event.pointerId);
      if (pointers.size >= 2) { beginPinch(); return; }
      const fastener = event.target.closest('.board-note-fastener');
      const element = fastener
        ? document.querySelector(`#boardNotes .investigation-note[data-id="${Number(fastener.dataset.noteId)}"]`)
        : event.target.closest('.investigation-note');
      const note = element && noteById(element.dataset.id);
      gesture = { type: note ? 'note' : 'pan', start: point(event), moved: false,
        left: viewport.scrollLeft, top: viewport.scrollTop, element, note,
        noteX: Number(note?.x), noteY: Number(note?.y), zoom: state.zoom };
    });
    viewport.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      event.preventDefault();
      pointers.set(event.pointerId, point(event));
      if (gesture.type === 'pinch') {
        const { center, distance } = pair();
        state.zoom = Math.max(.4, Math.min(2.5, Math.round(gesture.zoom * distance / gesture.distance * 100) / 100));
        updateDimensions();
        viewport.scrollLeft = gesture.worldX * state.zoom - center.x;
        viewport.scrollTop = gesture.worldY * state.zoom - center.y;
        return;
      }
      const dx = event.clientX - gesture.start.x, dy = event.clientY - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
      if (!gesture.moved && gesture.note) {
        state.revision++;
        gesture.element.classList.add('is-dragging');
      }
      gesture.moved = true;
      state.fitView = false;
      if (gesture.note) {
        const note = gesture.note;
        note.x = Math.min(20000, Math.max(0, Math.round(gesture.noteX + dx / gesture.zoom)));
        note.y = Math.min(20000, Math.max(0, Math.round(gesture.noteY + dy / gesture.zoom)));
        if (noteFrame === null) noteFrame = requestAnimationFrame(() => {
          noteFrame = null;
          paintNote();
        });
      } else {
        viewport.classList.add('is-panning');
        viewport.scrollLeft = gesture.left - dx;
        viewport.scrollTop = gesture.top - dy;
      }
    });
    async function finish(event) {
      if (!pointers.has(event.pointerId)) return;
      const cancelled = event.type !== 'pointerup';
      pointers.delete(event.pointerId);
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (gesture?.type === 'pinch') {
        if (pointers.size >= 2) beginPinch();
        else if (pointers.size === 1) {
          // Continue panning with the remaining finger, but never interpret it as a tap.
          gesture = { type: 'pan', start: [...pointers.values()][0], moved: true,
            left: viewport.scrollLeft, top: viewport.scrollTop };
        } else gesture = null;
      } else {
        const completed = gesture;
        if (cancelled) restoreNote();
        else if (completed?.note && completed.moved) {
          flushNoteFrame();
          completed.element.style.left = scaledLength(completed.note.x);
          completed.element.style.top = scaledLength(completed.note.y);
          completed.element.style.transform = '';
          updateDimensions();
        }
        gesture = null;
        completed?.element?.classList.remove('is-dragging');
        if (completed && !cancelled) {
          if (!completed.moved) {
            if (completed.note) selectNote(Number(completed.note.id));
            else clearSelection();
          } else if (completed.note) {
            const note = completed.note;
            await savePosition(note);
          }
        }
      }
      if (!pointers.size) viewport.classList.remove('is-panning');
    }
    viewport.addEventListener('pointerup', finish);
    viewport.addEventListener('pointercancel', finish);
    viewport.addEventListener('lostpointercapture', finish);
    new ResizeObserver(() => { if (viewport.clientWidth && viewport.clientHeight) updateDimensions(); }).observe(viewport);
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
        clearSelection();
      } else if ($('board').classList.contains('active')) leaveBoard();
    });
    $('boardNotes').addEventListener('click', event => {
      const button = event.target.closest('.board-note-edit');
      if (button) { clearSelection(); openDialog({ note: noteById(button.closest('.investigation-note').dataset.id) }); }
    });
    $('boardNotes').addEventListener('keydown', event => {
      if (event.target.classList.contains('investigation-note') && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        const id = Number(event.target.dataset.id);
        selectNote(id);
      }
    });
    $('boardThreads').addEventListener('click', onThreadClick);
    $('boardZoomIn').addEventListener('click', () => changeZoom(state.zoom + .15));
    $('boardZoomOut').addEventListener('click', () => changeZoom(state.zoom - .15));
    $('boardZoomReset').addEventListener('click', fitNotes);
    $('boardCreate').addEventListener('click', () => { clearSelection(); openDialog({ free: true }); });
    $('boardExit').addEventListener('click', leaveBoard);
    $('boardViewport').addEventListener('wheel', event => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? $('boardViewport').clientHeight : 1;
      changeZoom(state.zoom * Math.exp(-event.deltaY * unit * .0012), event);
    }, { passive: false });
    window.addEventListener('resize', updateDimensions);
    setupGestures();
    render();
  }

  window.investigationBoard = { show, openFromTrip, hide: clearSelection };
  document.addEventListener('DOMContentLoaded', init);
})();
