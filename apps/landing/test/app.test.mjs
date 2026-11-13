import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as lib from '../lib.js';

const source = (await readFile(new URL('../app.js', import.meta.url), 'utf8')).replace(/^import [^\n]+\n/, '');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const releasesUrl = 'https://github.com/tonyslabs/hiresspot/releases';
const flush = () => new Promise(setImmediate);
const camel = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

class Events {
  constructor() { this.listeners = {}; }
  addEventListener(type, listener) {
    (this.listeners[type] ||= new Set()).add(listener);
  }
  removeEventListener(type, listener) { this.listeners[type]?.delete(listener); }
  dispatch(type, details = {}) {
    const event = {
      type, target: this, bubbles: ['click', 'keydown', 'focusin', 'focusout'].includes(type),
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...details,
    };
    for (let node = this; node; node = event.bubbles ? node.parentElement : null) {
      event.currentTarget = node;
      for (const listener of [...(node.listeners[type] || [])]) listener(event);
    }
    return event;
  }
}

// DOM mínimo para probar los efectos del módulo sin navegador ni dependencias.
class Element extends Events {
  constructor(tag, attributes = {}, text = '') {
    super();
    this.tag = tag;
    this.attributes = { ...attributes };
    this.dataset = {};
    for (const [name, value] of Object.entries(attributes)) {
      if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = value;
    }
    this.children = [];
    this.text = text;
  }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  getAttribute(name) { return name.startsWith('data-') ? this.dataset[camel(name.slice(5))] : this.attributes[name]; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = String(value);
  }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name.startsWith('data-')) delete this.dataset[camel(name.slice(5))];
  }
  get hidden() { return this.getAttribute('hidden') !== undefined; }
  set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get tabIndex() { return Number(this.getAttribute('tabindex') ?? (this.tag === 'button' ? 0 : -1)); }
  set tabIndex(value) { this.setAttribute('tabindex', value); }
  get classList() {
    return {
      contains: (name) => (this.attributes.class || '').split(/\s+/).includes(name),
      toggle: (name, force) => {
        const names = new Set((this.attributes.class || '').split(/\s+/).filter(Boolean));
        const active = force ?? !names.has(name);
        if (active) names.add(name); else names.delete(name);
        this.attributes.class = [...names].join(' ');
        return active;
      },
    };
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    if (selector === ':hover') return Boolean(this.hovered);
    return selector.split(',').some((part) => {
      part = part.trim();
      const tag = part.match(/^\w+/)?.[0];
      const classes = [...part.replace(/\[[^\]]+\]/g, '').matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
      const attributes = [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
      return Boolean(tag || classes.length || attributes.length) && (!tag || this.tag === tag)
        && classes.every((name) => this.classList.contains(name))
        && attributes.every(([, name, value]) => this.getAttribute(name) !== undefined
          && (value === undefined || this.getAttribute(name) === value));
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() { this.dispatch('click'); }
  focus() {
    const document = this.ownerDocument;
    const previous = document.activeElement;
    if (previous === this) return;
    document.activeElement = this;
    previous?.dispatch('focusout', { relatedTarget: this });
    this.dispatch('focusin', { relatedTarget: previous });
  }
}

function documentFromHtml() {
  const root = new Element('document');
  const stack = [root];
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<\/?([\w-]+)\b([^>]*?)>|([^<]+)/g)) {
    const [raw, tag, attributeText, text] = token;
    if (raw.startsWith('<!--')) continue;
    if (text) { stack.at(-1).text += text; continue; }
    if (raw.startsWith('</')) { stack.pop(); continue; }
    const attributes = Object.fromEntries([...attributeText.matchAll(/([^\s=\/]+)(?:="([^"]*)")?/g)]
      .map(([, name, value]) => [name, value || '']));
    const element = new Element(tag, attributes);
    element.ownerDocument = root;
    element.parentElement = stack.at(-1);
    stack.at(-1).children.push(element);
    if (tag === 'html') root.documentElement = element;
    if (!raw.endsWith('/>') && !['meta', 'link', 'img', 'br', 'hr', 'input'].includes(tag)) stack.push(element);
  }
  root.activeElement = root.querySelector('body');
  return root;
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function boot(options = {}) {
  const document = documentFromHtml();
  document.hidden = Boolean(options.hidden);
  options.prepareDocument?.(document);
  const calls = [];
  const timers = [];
  let now = 0;
  const motion = new Events();
  motion.matches = Boolean(options.reducedMotion);
  const window = new Events();
  window.location = { search: options.search || '' };
  window.matchMedia = (query) => {
    assert.equal(query, '(prefers-reduced-motion: reduce)');
    return motion;
  };
  const context = {
    ...lib,
    document,
    window,
    navigator: { language: 'es-NI', userAgent: 'X11; Linux x86_64', platform: 'Linux x86_64', ...options.navigator },
    localStorage: options.localStorage || storage(),
    sessionStorage: options.sessionStorage || storage(),
    AbortController,
    setTimeout(callback, ms) { const timer = { callback, ms, due: now + ms }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    fetch: (...args) => {
      calls.push(args);
      return options.fetch ? options.fetch(...args) : Promise.reject(new Error('Unexpected fetch'));
    },
  };
  vm.runInNewContext(source, context, { filename: 'app.js' });
  return {
    document, window, motion, calls, timers,
    pendingTimers: () => timers.filter((timer) => !timer.cleared && !timer.fired),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((timer) => !timer.cleared && !timer.fired && timer.due <= end)
          .sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        now = next.due;
        next.fired = true;
        next.callback();
      }
      now = end;
    },
    localStorage: context.localStorage,
    sessionStorage: context.sessionStorage,
    downloads: document.querySelector('[data-downloads]'),
    slots: document.querySelectorAll('a[data-asset]'),
    slot: (name) => document.querySelector(`a[data-asset="${name}"]`),
  };
}

const exampleRelease = (assets) => ({
  tag_name: '2.0.0', html_url: `${releasesUrl}/tag/v2.0.0`, assets,
});
const deb = {
  name: 'hiresspot_2.0.0_amd64.deb', size: 94400000,
  browser_download_url: `${releasesUrl}/download/v2.0.0/hiresspot_2.0.0_amd64.deb`,
};
const response = (release) => ({ ok: true, json: async () => release });

test('demo ready: versión, tamaños, plataforma, idioma y accesibilidad sobre el HTML real', () => {
  const app = boot({ search: '?demo=1&os=windows&lang=es' });
  assert.equal(app.calls.length, 0);
  assert.equal(app.downloads.dataset.state, 'ready');
  assert.ok(app.slots.every((slot) => slot.dataset.state === 'ready'));
  assert.equal(app.slot('android-apk').querySelector('[data-size]').textContent, '6,1 MB');
  assert.equal(app.slot('win-setup').querySelector('[data-size]').textContent, '98 MB');
  assert.equal(app.slot('linux-deb').querySelector('[data-size]').textContent, '90 MB');
  assert.equal(app.slot('linux-zip').querySelector('[data-size]').textContent, '119 MB');
  assert.equal(app.slot('win-zip').querySelector('[data-size]').textContent, '151 MB');
  assert.equal(app.slot('win-setup').getAttribute('aria-label'), 'Descargar el instalador para Windows, v2.0.0, 98 MB');
  assert.equal(app.slot('checksums').href, `${releasesUrl}/latest`);
  assert.deepEqual(app.document.querySelectorAll('[data-primary]').map((node) => node.dataset.platform), ['windows']);
  assert.ok(app.document.querySelectorAll('[data-app-version], [data-release-version], [data-version]')
    .every((node) => node.textContent === 'v2.0.0'));
  app.document.querySelector('[data-lang-switch="en"]').click();
  assert.equal(app.document.documentElement.lang, 'en');
  assert.equal(app.document.title, lib.t('en', 'meta.title'));
  assert.equal(app.slot('android-apk').querySelector('[data-size]').textContent, '6.1 MB');
  assert.equal(app.slot('android-apk').getAttribute('aria-label'), 'Download the APK for Android, v2.0.0, 6.1 MB');
  assert.equal(app.localStorage.getItem('hiresspot.lang'), 'en');
  assert.equal(app.document.querySelector('[data-lang-switch="en"]').getAttribute('aria-pressed'), 'true');
  assert.equal(app.document.querySelector('[data-lang-switch="es"]').getAttribute('aria-pressed'), 'false');
  assert.equal(app.downloads.querySelector('[aria-live]').getAttribute('aria-label'), 'Latest: v2.0.0');
  assert.equal(app.document.querySelector('[data-i18n-attr="content:meta.description"]').getAttribute('content'), lib.t('en', 'meta.description'));
});

for (const state of ['loading', 'soon', 'error']) {
  test(`demo ${state}: estado uniforme, sin API y sin plataforma forzada`, () => {
    const app = boot({ search: `?demo=${state}&os=none&lang=en` });
    assert.equal(app.calls.length, 0);
    assert.equal(app.downloads.dataset.state, state);
    assert.ok(app.slots.every((slot) => slot.dataset.state === state));
    assert.ok(app.slots.every((slot) => slot.href === (state === 'error' ? releasesUrl : `${releasesUrl}/latest`)));
    assert.equal(app.document.querySelectorAll('[data-primary]').length, 0);
    const status = app.downloads.querySelector('[aria-live]');
    assert.equal(status.getAttribute('aria-label'), lib.t('en', `dl.status.${state}`));
    assert.equal(status.querySelector(`[data-when="${state}"]`).getAttribute('aria-hidden'), 'false');
  });
}

test('API: release parcial, caché de sesión y normalización de versión', async () => {
  const app = boot({ fetch: async () => response(exampleRelease([deb])) });
  assert.equal(app.downloads.dataset.state, 'loading');
  await flush();
  assert.equal(app.downloads.dataset.state, 'ready');
  assert.equal(app.slot('linux-deb').dataset.state, 'ready');
  assert.equal(app.slot('linux-deb').href, deb.browser_download_url);
  assert.equal(app.slot('android-apk').dataset.state, 'soon');
  assert.equal(app.slot('android-apk').href, `${releasesUrl}/tag/v2.0.0`);
  assert.equal(app.slot('checksums').dataset.state, 'soon');
  assert.equal(app.calls[0][0], 'https://api.github.com/repos/tonyslabs/hiresspot/releases/latest');
  assert.equal(app.calls[0][1].method, 'GET');
  assert.equal(app.calls[0][1].headers.Accept, 'application/vnd.github+json');
  assert.equal(app.timers[0].ms, 8000);
  assert.equal(app.timers[0].cleared, true);
  const cached = boot({ sessionStorage: app.sessionStorage });
  assert.equal(cached.calls.length, 0);
  assert.equal(cached.downloads.dataset.state, 'ready');
  assert.equal(cached.slot('linux-deb').querySelector('[data-version]').textContent, 'v2.0.0');
});

test('API: caché vencida o corrupta se descarta y release sin archivos termina en soon', async () => {
  for (const value of ['invalid JSON', JSON.stringify({ timestamp: Date.now() - 600001, release: exampleRelease([deb]) }),
    JSON.stringify({ timestamp: Date.now(), release: {} })]) {
    const app = boot({ sessionStorage: storage({ 'hiresspot.release': value }), fetch: async () => response(exampleRelease([])) });
    await flush();
    assert.equal(app.calls.length, 1);
    assert.equal(app.downloads.dataset.state, 'soon');
    assert.ok(app.slots.every((slot) => slot.dataset.state === 'soon'));
  }
});

test('API: 404, límite, red y JSON inválido usan soon y la página de releases', async () => {
  const failures = [
    ...[404, 403, 429, 500].map((status) => async () => ({ ok: false, status })),
    async () => { throw new Error('Offline'); },
    async () => ({ ok: true, json: async () => { throw new SyntaxError('JSON'); } }),
    async () => response({ message: 'Not a release' }),
  ];
  for (const fetch of failures) {
    const app = boot({ fetch });
    await flush();
    assert.equal(app.downloads.dataset.state, 'soon');
    assert.ok(app.slots.every((slot) => slot.dataset.state === 'soon' && slot.href === releasesUrl));
    assert.equal(app.timers[0].cleared, true);
  }
});

test('API: AbortController cancela a los 8 s y no deja ranuras cargando', async () => {
  const app = boot({ fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }) });
  assert.equal(app.downloads.dataset.state, 'loading');
  app.timers[0].callback();
  await flush();
  assert.equal(app.calls[0][1].signal.aborted, true);
  assert.equal(app.downloads.dataset.state, 'soon');
  assert.ok(app.slots.every((slot) => slot.dataset.state === 'soon'));
  assert.equal(app.timers[0].cleared, true);
});

test('idioma y plataforma: prioridades y almacenamiento bloqueado', async () => {
  const saved = boot({ search: '?demo=1', localStorage: storage({ 'hiresspot.lang': 'en' }) });
  assert.equal(saved.document.documentElement.lang, 'en');
  const forced = boot({ search: '?demo=1&lang=es', localStorage: storage({ 'hiresspot.lang': 'en' }) });
  assert.equal(forced.document.documentElement.lang, 'es');
  assert.equal(forced.localStorage.getItem('hiresspot.lang'), 'es');
  const blocked = {
    getItem() { throw new Error('Storage blocked'); },
    setItem() { throw new Error('Storage blocked'); },
  };
  const app = boot({
    localStorage: blocked, sessionStorage: blocked,
    navigator: { language: 'fr-FR', userAgentData: { platform: 'Android' } },
    fetch: async () => response(exampleRelease([deb])),
  });
  await flush();
  assert.equal(app.document.documentElement.lang, 'en');
  assert.equal(app.downloads.dataset.state, 'ready');
  assert.deepEqual(app.document.querySelectorAll('[data-primary]').map((node) => node.dataset.platform), ['android']);
  app.document.querySelector('[data-lang-switch="es"]').click();
  assert.equal(app.document.documentElement.lang, 'es');
});

test('traducción de varios atributos y fallback de navigator.platform', () => {
  const app = boot({
    search: '?demo=soon&lang=en',
    navigator: { userAgent: '', platform: 'Win32' },
    prepareDocument(document) {
      document.children.push(new Element('a', {
        'data-i18n-attr': 'title:nav.repo; aria-label:nav.label',
      }));
    },
  });
  const translated = app.document.querySelector('[data-i18n-attr="title:nav.repo; aria-label:nav.label"]');
  assert.equal(translated.getAttribute('title'), 'Source');
  assert.equal(translated.getAttribute('aria-label'), 'Links');
  assert.deepEqual(app.document.querySelectorAll('[data-primary]').map((node) => node.dataset.platform), ['windows']);
});

const galleryApp = (options = {}) => boot({ search: '?demo=1', ...options });
const shot = (app, name) => app.document.querySelector(`[data-shot="${name}"]`);
const dot = (app, name) => app.document.querySelector(`[data-shot-target="${name}"]`);
const stage = (app) => app.document.querySelector('[data-gallery]');
const tablist = (app) => stage(app).querySelector('[role="tablist"]');

function assertShot(app, name) {
  for (const image of stage(app).querySelectorAll('[data-shot]')) {
    assert.equal(image.classList.contains('is-active'), image.dataset.shot === name);
    assert.equal(image.getAttribute('aria-hidden'), String(image.dataset.shot !== name));
  }
  for (const button of tablist(app).querySelectorAll('[data-shot-target]')) {
    const selected = button.dataset.shotTarget === name;
    assert.equal(button.classList.contains('is-active'), selected);
    assert.equal(button.getAttribute('aria-selected'), String(selected));
    assert.equal(button.tabIndex, selected ? 0 : -1);
  }
}

test('galería: rota cada 6000 ms, vuelve al inicio y mantiene clases, ARIA y tabindex', () => {
  const app = galleryApp();
  assertShot(app, 'nowplaying');
  assert.equal(tablist(app).hidden, false);
  assert.equal(app.pendingTimers().length, 1);
  app.advance(5999);
  assertShot(app, 'nowplaying');
  app.advance(1);
  assertShot(app, 'compare');
  app.advance(6000);
  assertShot(app, 'nowplaying');
  assert.equal(app.pendingTimers().length, 1);
  assert.equal(app.document.activeElement.tag, 'body');
});

test('galería: el clic cambia de captura y reinicia los 6000 ms incluso sobre el activo', () => {
  const app = galleryApp();
  app.advance(5000);
  dot(app, 'compare').click();
  assertShot(app, 'compare');
  app.advance(5999);
  assertShot(app, 'compare');
  app.advance(1);
  assertShot(app, 'nowplaying');
  app.advance(5000);
  dot(app, 'nowplaying').click();
  app.advance(1000);
  assertShot(app, 'nowplaying');
  app.advance(5000);
  assertShot(app, 'compare');
});

test('galería: el puntero cancela el timer y al salir empieza un período completo', () => {
  const app = galleryApp();
  app.advance(5000);
  stage(app).dispatch('mouseenter');
  assert.equal(app.pendingTimers().length, 0);
  app.advance(30000);
  assertShot(app, 'nowplaying');
  stage(app).dispatch('mouseleave');
  app.advance(5999);
  assertShot(app, 'nowplaying');
  app.advance(1);
  assertShot(app, 'compare');
});

test('galería: foco interno y puntero son pausas independientes', () => {
  const app = galleryApp();
  stage(app).dispatch('mouseenter');
  dot(app, 'nowplaying').focus();
  stage(app).dispatch('mouseleave');
  assert.equal(app.pendingTimers().length, 0);
  dot(app, 'compare').focus();
  assert.equal(app.pendingTimers().length, 0);
  app.advance(30000);
  assertShot(app, 'nowplaying');
  stage(app).dispatch('mouseenter');
  app.document.querySelector('[data-lang-switch="en"]').focus();
  assert.equal(app.pendingTimers().length, 0);
  stage(app).dispatch('mouseleave');
  app.advance(6000);
  assertShot(app, 'compare');
});

test('galería: visibilitychange cancela y reanuda sin ignorar las otras pausas', () => {
  const app = galleryApp();
  app.document.hidden = true;
  app.document.dispatch('visibilitychange');
  assert.equal(app.pendingTimers().length, 0);
  app.advance(30000);
  assertShot(app, 'nowplaying');
  stage(app).dispatch('mouseenter');
  app.document.hidden = false;
  app.document.dispatch('visibilitychange');
  assert.equal(app.pendingTimers().length, 0);
  stage(app).dispatch('mouseleave');
  app.advance(6000);
  assertShot(app, 'compare');
});

test('galería: respeta pestaña oculta, hover y foco que ya existían al inicializar', () => {
  for (const options of [
    { hidden: true },
    { prepareDocument(document) { document.querySelector('[data-gallery]').hovered = true; } },
    { prepareDocument(document) { document.querySelector('[data-shot-target="compare"]').focus(); } },
  ]) {
    const app = galleryApp(options);
    assert.equal(app.pendingTimers().length, 0);
    app.advance(30000);
    assertShot(app, 'nowplaying');
  }
});

test('galería: reduced-motion permite navegación manual sin crear timers', () => {
  const app = galleryApp({ reducedMotion: true });
  assert.equal(app.pendingTimers().length, 0);
  dot(app, 'compare').click();
  assertShot(app, 'compare');
  stage(app).dispatch('mouseenter');
  stage(app).dispatch('mouseleave');
  app.advance(30000);
  assertShot(app, 'compare');
  assert.equal(app.pendingTimers().length, 0);
});

test('galería: cambiar reduced-motion durante la sesión cancela y reanuda la rotación', () => {
  const app = galleryApp();
  app.motion.matches = true;
  app.motion.dispatch('change');
  assert.equal(app.pendingTimers().length, 0);
  app.advance(30000);
  assertShot(app, 'nowplaying');
  app.motion.matches = false;
  app.motion.dispatch('change');
  app.advance(6000);
  assertShot(app, 'compare');
});

for (const initial of ['compare', 'nowplaying']) {
  test(`galería: ?shot=${initial} fija la inicial, permite navegación y nunca autoavanza`, () => {
    const app = galleryApp({ search: `?demo=1&shot=${initial}&lang=en` });
    assertShot(app, initial);
    assert.equal(app.pendingTimers().length, 0);
    const other = initial === 'compare' ? 'nowplaying' : 'compare';
    dot(app, other).click();
    stage(app).dispatch('mouseenter');
    stage(app).dispatch('mouseleave');
    app.advance(30000);
    assertShot(app, other);
    assert.equal(app.pendingTimers().length, 0);
  });
}

test('galería: ?shot desconocido conserva el comportamiento normal', () => {
  const app = galleryApp({ search: '?demo=1&shot=albums' });
  app.advance(6000);
  assertShot(app, 'compare');
});

test('galería: flechas, Inicio y Fin seleccionan y enfocan el punto con roving tabindex', () => {
  const app = galleryApp();
  dot(app, 'nowplaying').focus();
  for (const [key, expected] of [
    ['ArrowRight', 'compare'], ['ArrowRight', 'nowplaying'],
    ['ArrowLeft', 'compare'], ['Home', 'nowplaying'], ['End', 'compare'],
  ]) {
    const event = app.document.activeElement.dispatch('keydown', { key });
    assert.equal(event.defaultPrevented, true);
    assertShot(app, expected);
    assert.equal(app.document.activeElement, dot(app, expected));
    assert.equal(app.pendingTimers().length, 0);
  }
  const ignored = app.document.activeElement.dispatch('keydown', { key: 'Tab' });
  assert.equal(ignored.defaultPrevented, false);
  app.document.querySelector('[data-lang-switch="en"]').focus();
  app.advance(5999);
  assertShot(app, 'compare');
  app.advance(1);
  assertShot(app, 'nowplaying');
});

test('galería: una imagen rota sale de la rotación y sus puntos se ocultan con menos de dos', () => {
  for (const failed of ['compare', 'nowplaying']) {
    const app = galleryApp();
    shot(app, failed).dispatch('error');
    const remaining = failed === 'compare' ? 'nowplaying' : 'compare';
    assertShot(app, remaining);
    assert.equal(shot(app, failed).hidden, true);
    assert.equal(dot(app, failed).hidden, true);
    assert.equal(tablist(app).hidden, true);
    assert.equal(app.pendingTimers().length, 0);
    dot(app, failed).click();
    shot(app, failed).dispatch('error');
    stage(app).dispatch('mouseenter');
    stage(app).dispatch('mouseleave');
    app.advance(30000);
    assertShot(app, remaining);
    shot(app, remaining).dispatch('error');
    assertShot(app, null);
    tablist(app).dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(app.pendingTimers().length, 0);
  }
});

test('galería: detecta imágenes rotas antes de ejecutar el módulo, incluso la forzada', () => {
  const app = galleryApp({
    search: '?demo=1&shot=compare',
    prepareDocument(document) {
      const image = document.querySelector('[data-shot="compare"]');
      image.complete = true;
      image.naturalWidth = 0;
    },
  });
  assertShot(app, 'nowplaying');
  assert.equal(tablist(app).hidden, true);
  assert.equal(app.pendingTimers().length, 0);
});

test('galería: error con tres capturas deja dos navegables y omite la rota al rotar', () => {
  const app = galleryApp({ prepareDocument(document) {
    const image = new Element('img', { class: 'shot', 'data-shot': 'albums' });
    const button = new Element('button', { class: 'shots__dot', role: 'tab', 'data-shot-target': 'albums' });
    for (const [node, parent] of [[image, document.querySelector('.shots__frame')],
      [button, document.querySelector('.shots__dots')]]) {
      node.ownerDocument = document;
      node.parentElement = parent;
      parent.children.push(node);
    }
  } });
  shot(app, 'compare').dispatch('error');
  assert.equal(tablist(app).hidden, false);
  app.advance(6000);
  assertShot(app, 'albums');
  app.advance(6000);
  assertShot(app, 'nowplaying');
  dot(app, 'nowplaying').focus();
  dot(app, 'nowplaying').dispatch('keydown', { key: 'ArrowRight' });
  assertShot(app, 'albums');
  assert.equal(app.document.activeElement, dot(app, 'albums'));
});

test('galería: el idioma traduce alt y aria-label sin alterar la selección ni el timer', () => {
  const app = galleryApp();
  dot(app, 'compare').click();
  app.document.querySelector('[data-lang-switch="en"]').click();
  assertShot(app, 'compare');
  assert.equal(shot(app, 'compare').getAttribute('alt'), 'Compare: Navidrome against Spotify');
  assert.equal(dot(app, 'nowplaying').getAttribute('aria-label'), 'Now playing: Hi-Res 24/48 seal and track queue');
  assert.equal(tablist(app).getAttribute('aria-label'), 'App screenshots');
  assert.equal(app.pendingTimers().length, 1);
});

test('galería: pagehide detiene el timer y pageshow lo restaura al volver del caché', () => {
  const app = galleryApp();
  app.window.dispatch('pagehide', { persisted: true });
  assert.equal(app.pendingTimers().length, 0);
  app.advance(30000);
  assertShot(app, 'nowplaying');
  app.window.dispatch('pageshow', { persisted: true });
  app.advance(6000);
  assertShot(app, 'compare');
});

test('galería: navegar y pausar repetidamente conserva un timer y listeners estables', () => {
  const app = galleryApp();
  const targets = [stage(app), tablist(app), app.document, app.window, app.motion,
    ...stage(app).querySelectorAll('[data-shot], [data-shot-target]')];
  const counts = () => targets.map((target) => Object.values(target.listeners)
    .reduce((sum, listeners) => sum + listeners.size, 0));
  const initial = counts();
  assert.ok(initial.some((count) => count > 0));
  for (let i = 0; i < 20; i++) {
    dot(app, 'compare').click();
    stage(app).dispatch('mouseenter');
    assert.equal(app.pendingTimers().length, 0);
    stage(app).dispatch('mouseleave');
    assert.equal(app.pendingTimers().length, 1);
    app.advance(6000);
  }
  assert.deepEqual(counts(), initial);
  assertShot(app, 'nowplaying');
});
