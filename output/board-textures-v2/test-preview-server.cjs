const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createServer } = require('node:http');
const { createPreview } = require('./preview-server.cjs');

test('preview links use the game API schema and survive reload, removal and recreation', async () => {
  const app = createPreview({ stateFile: null, initialState: {
    notes: [{ id: 10, title: 'A', x: 100, y: 200 }, { id: 11, title: 'B', x: 500, y: 200 }],
    links: [{ id: 7, first_id: 11, second_id: 10 }, { id: 8, first_id: 10, second_id: 11 }]
  } });
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/game/board`;
  const read = async () => (await fetch(url)).json();
  const connect = async body => fetch(`${url}/links`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  try {
    assert.deepEqual((await read()).links, [{ id: 7, note_a: 10, note_b: 11 }]);
    assert.equal((await connect({ first_id: 10, second_id: 11 })).status, 409);
    await fetch(`${url}/links/7`, { method: 'DELETE' });
    assert.deepEqual((await read()).links, []);
    const created = await connect({ first_id: 11, second_id: 10 });
    assert.equal(created.status, 201);
    const { link } = await created.json();
    assert.equal(link.note_a, 10);
    assert.equal(link.note_b, 11);
    assert.deepEqual((await read()).links, [link]);
    assert.equal((await connect({ first_id: 10, second_id: 10 })).status, 400);
    assert.equal((await connect({ first_id: 10, second_id: 99 })).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
