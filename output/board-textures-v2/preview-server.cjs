const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('../../node_modules/express');

// Local preview uses the production markup, stylesheet and board controller.
// Sample data uses a local snapshot and never touches the authenticated game database.
const root = path.resolve(__dirname, '../..');
function createPreview({ stateFile = path.join(__dirname, 'preview-state.json'), initialState } = {}) {
const app = express();
app.use(express.json());
let notes = [
  { id: 1, address_id: -1, title: 'Редакция', comment: 'Проверить публикации', color: 'purple', x: 430, y: 280 },
  { id: 2, address_id: -2, title: 'Илона', comment: 'Сверить показания', color: 'green', x: 1040, y: 180 },
  { id: 3, address_id: -3, title: 'Вероника Гронская', comment: 'Сопоставить факты', color: 'pink', x: 930, y: 650 },
  { id: 4, address_id: -4, title: 'Бар «Алмаз»', comment: 'Уточнить время', color: 'blue', x: 1650, y: 500 },
  { id: 5, address_id: -5, title: 'Расписание', comment: 'Проверить даты', color: 'yellow', x: 560, y: 960 }
];
let links = [
  { id: 1, note_a: 1, note_b: 3 }, { id: 2, note_a: 2, note_b: 3 },
  { id: 3, note_a: 3, note_b: 4 }, { id: 4, note_a: 3, note_b: 5 }
];
const saved = initialState || (stateFile && fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, '')) : null);
if (saved) { notes = saved.notes; links = saved.links; }
// Recover links saved by the old preview response, retaining one link per pair.
const pairs = new Set();
links = links.flatMap(link => {
  const first = Number(link.note_a ?? link.first_id), second = Number(link.note_b ?? link.second_id);
  if (!notes.some(note => note.id === first) || !notes.some(note => note.id === second) || first === second) return [];
  const note_a = Math.min(first, second), note_b = Math.max(first, second), key = `${note_a}:${note_b}`;
  if (pairs.has(key)) return [];
  pairs.add(key);
  return [{ id: link.id, note_a, note_b }];
});
let nextNote = Math.max(0, ...notes.map(note => note.id)) + 1;
let nextLink = Math.max(0, ...links.map(link => link.id)) + 1;
const saveState = () => {
  if (stateFile) fs.writeFileSync(stateFile, JSON.stringify({ notes, links }, null, 2));
};
app.get('/api/game/board', (_, res) => res.json({ notes, links }));
app.post(['/api/game/board/notes', '/api/game/board/notes/free'], (req, res) => {
  const note = { x: 1050, y: 540, ...req.body, id: nextNote++, address_id: -nextNote, address_label: '' };
  notes.push(note); saveState(); res.json({ note });
});
app.patch('/api/game/board/notes/:id/position', (req, res) => {
  const note = notes.find(n => n.id === Number(req.params.id));
  if (!note) return res.status(404).json({ error: 'Стикер не найден' });
  Object.assign(note, { x: req.body.x, y: req.body.y }); saveState(); res.json({ note });
});
app.patch('/api/game/board/notes/:id', (req, res) => {
  const note = notes.find(n => n.id === Number(req.params.id));
  if (!note) return res.status(404).json({ error: 'Стикер не найден' });
  Object.assign(note, req.body); saveState(); res.json({ note });
});
app.delete('/api/game/board/notes/:id', (req, res) => {
  const id = Number(req.params.id);
  notes = notes.filter(n => n.id !== id);
  links = links.filter(l => l.note_a !== id && l.note_b !== id);
  saveState();
  res.json({ ok: true });
});
app.post('/api/game/board/links', (req, res) => {
  const first = Number(req.body.first_id), second = Number(req.body.second_id);
  if (!Number.isSafeInteger(first) || first <= 0 || !Number.isSafeInteger(second) || second <= 0 || first === second) {
    return res.status(400).json({ error: 'Выберите два разных стикера' });
  }
  if (!notes.some(note => note.id === first) || !notes.some(note => note.id === second)) {
    return res.status(404).json({ error: 'Стикер не найден на этой доске' });
  }
  const note_a = Math.min(first, second), note_b = Math.max(first, second);
  const existing = links.find(link => link.note_a === note_a && link.note_b === note_b);
  if (existing) return res.status(409).json({ error: 'Эти стикеры уже соединены', link: existing });
  const link = { id: nextLink++, note_a, note_b };
  links.push(link); saveState(); res.status(201).json({ link });
});
app.delete('/api/game/board/links/:id', (req, res) => {
  links = links.filter(l => l.id !== Number(req.params.id)); saveState(); res.json({ ok: true });
});

app.get('/board-preview', (_, res) => {
  const source = fs.readFileSync(path.join(root, 'frontend/game.html'), 'utf8');
  const boardStart = source.indexOf('<div class="tab-pane fade investigation-pane" id="board"');
  const boardEnd = source.indexOf('</section>', boardStart) + '</section>'.length;
  const board = source.slice(boardStart, boardEnd).replace('tab-pane fade investigation-pane', 'tab-pane investigation-pane active show') + '</div>';
  const overlayStart = source.indexOf('<div id="boardNoteOverlay"');
  const overlayEnd = source.indexOf('<!-- Interactive Choice Modal -->', overlayStart);
  const overlay = source.slice(overlayStart, overlayEnd);
  res.type('html').send(`<!doctype html><html lang="ru"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Детектум — доска с магнитами</title>
    <link rel="stylesheet" href="/css/style.css?v=9">
    <link rel="stylesheet" href="/css/investigation-board.css?v=19">
    <style>*,*::before,*::after{box-sizing:border-box}body{margin:0}button,input,textarea{font:inherit}
    [hidden]{display:none!important}.board-toolbar #boardNavHost,.board-toolbar #boardTimerHost,.board-toolbar #boardAccount{display:none}
    body.board-desktop-header .board-toolbar{grid-template-columns:minmax(0,1fr) auto}.board-tools{grid-column:2}
    .preview-brand{font-size:12px;letter-spacing:.18em;color:#c3b49f;font-weight:700;display:block;margin-bottom:7px}
    .board-title-block::before{content:'ДЕТЕКТУМ';font:700 12px/1.5 Georgia,serif;letter-spacing:.2em;color:#c3b49f}
    @media(max-width:767px){.board-tools{grid-column:1/-1}.board-exit{visibility:hidden}.board-title-block::before{display:none}}
    </style></head><body class="board-open"><button id="board-tab" hidden></button><button id="game-tab" hidden></button>
    ${board}${overlay}
    <script>const gameStorage={getItem:key=>key==='roomUser'?'local-preview':null};
    window.gameNetwork={fetch:(url,options)=>fetch(url,options)};
    document.body.classList.toggle('board-desktop-header',innerWidth>=768);
    window.addEventListener('resize',()=>document.body.classList.toggle('board-desktop-header',innerWidth>=768));
    </script><script src="/js/investigation-board.js?v=12"></script>
    <script>document.addEventListener('DOMContentLoaded',()=>window.investigationBoard.show());</script>
    </body></html>`);
});
app.get('/game', (_, res) => res.redirect('/board-preview'));
app.get('/corporate', (_, res) => res.sendFile(path.join(root, 'frontend/corporate.html')));
app.use(express.static(path.join(root, 'frontend')));
return app;
}

if (require.main === module) {
  http.createServer(createPreview()).listen(4173, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4173/board-preview'));
}
module.exports = { createPreview };
