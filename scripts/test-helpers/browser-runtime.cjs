const fs = require('node:fs');
const vm = require('node:vm');

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

class Clock {
  constructor() { this.now = 1000000; this.id = 0; this.jobs = new Map(); }
  set(fn, delay = 0, repeat = 0) {
    const id = ++this.id;
    this.jobs.set(id, { fn, at: this.now + delay, repeat });
    return id;
  }
  async advance(ms) {
    const end = this.now + ms;
    let ticks = 0;
    while (true) {
      const next = [...this.jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (++ticks > 100000) throw new Error('Runaway timer');
      const [id, job] = next;
      this.now = job.at;
      if (job.repeat) job.at += job.repeat;
      else this.jobs.delete(id);
      job.fn();
      await flush();
    }
    this.now = end;
    await flush();
  }
}

class Target {
  constructor() { this.events = new Map(); }
  addEventListener(name, fn) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
  emit(name, event = {}) {
    for (const fn of [...(this.events.get(name) || [])]) fn({ type: name, ...event });
  }
}

class Element extends Target {
  constructor(id) {
    super(); this.id = id; this.dataset = {}; this.value = ''; this.textContent = '';
    this.hidden = true; this.disabled = false; this.clientWidth = 356; this.clientHeight = 620;
    this.style = { setProperty(name, value) { this[name] = value; } };
    const classes = new Set();
    this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
  }
  querySelectorAll() { return []; }
  setAttribute() {}
  replaceChildren() {}
  focus() {}
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function browser(fetchImpl = () => new Response('{}')) {
  const clock = new Clock(), calls = [], elements = new Map(), sources = [], alerts = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const document = new Target();
  Object.assign(document, { hidden: false, getElementById: element, body: element('body'), querySelector: () => null, querySelectorAll: () => [] });
  const window = new Target();
  window.location = { href: '', pathname: '/game', search: '' };
  const values = new Map([
    ['token', 'fixture-token'], ['room', JSON.stringify({ id: 14, scenario_id: 12 })],
    ['roomUser', JSON.stringify({ id: 15, room_id: 14, username: 'Fixture' })]
  ]);
  const makeStorage = entries => ({ getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)), removeItem: key => entries.delete(key) });
  const storage = makeStorage(values), tabStorage = makeStorage(new Map());
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  class Source extends Target {
    constructor(url) { super(); this.url = url; this.closed = false; sources.push(this); }
    close() { this.closed = true; }
    emit(name, event = {}) { super.emit(name, event); this[`on${name}`]?.(event); }
  }
  const math = Object.create(Math); math.random = () => 0;
  const sandbox = {
    document, window, navigator: { onLine: true }, localStorage: storage, sessionStorage: tabStorage,
    Headers, Response, Request, AbortController, AbortSignal, ReadableStream, URL, URLSearchParams, atob, Date: FakeDate, Math: math,
    performance: { now: () => clock.now },
    EventSource: Source, ResizeObserver: class { observe() {} },
    setTimeout: (fn, delay) => clock.set(fn, delay), clearTimeout: id => clock.jobs.delete(id),
    setInterval: (fn, delay) => clock.set(fn, delay, delay), clearInterval: id => clock.jobs.delete(id),
    requestAnimationFrame: fn => clock.set(fn), cancelAnimationFrame: id => clock.jobs.delete(id),
    console: { log() {}, error() {}, warn() {} }, alert: message => alerts.push(message), confirm: () => true,
    fetch: (url, options = {}) => {
      const call = { url, options }; calls.push(call);
      return fetchImpl(call, clock);
    }
  };
  const context = vm.createContext(sandbox);
  const load = path => vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
  const run = source => vm.runInContext(source, context);
  load('frontend/js/game-network.js');
  return { clock, calls, document, window, sandbox, sources, alerts, element, load, run, context, values, api: window.gameNetwork };
}

function hanging(call) {
  return new Promise((resolve, reject) => {
    call.options.signal.addEventListener('abort', () => {
      const error = new Error('Aborted'); error.name = 'AbortError'; reject(error);
    }, { once: true });
  });
}

module.exports = { browser, deferred, hanging, flush, Clock };
