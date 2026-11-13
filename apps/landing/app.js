import { detectPlatform, mapAssets, formatSize, parseParams, t, shotTarget, canRotateShots } from './lib.js';

const RELEASES_URL = 'https://github.com/tonyslabs/hiresspot/releases';
const LATEST_URL = `${RELEASES_URL}/latest`;
const API_URL = 'https://api.github.com/repos/tonyslabs/hiresspot/releases/latest';
const CACHE_KEY = 'hiresspot.release';
const CACHE_TTL = 10 * 60 * 1000;
const params = parseParams(window.location.search);
const downloads = document.querySelector('[data-downloads]');
const slots = [...document.querySelectorAll('a[data-asset]')];
const status = downloads.querySelector('[aria-live]');
let lang = initialLanguage();
let state = 'loading';
let release = null;
let assets = {};
let fallbackUrl = RELEASES_URL;

function initialLanguage() {
  if (params.lang) return params.lang;
  try {
    const saved = localStorage.getItem('hiresspot.lang');
    if (saved === 'es' || saved === 'en') return saved;
  } catch {}
  return /^es/i.test(navigator.language) ? 'es' : 'en';
}

function saveLanguage() {
  try { localStorage.setItem('hiresspot.lang', lang); } catch {}
}

function applyLanguage(nextLang) {
  lang = nextLang;
  document.documentElement.lang = lang;
  document.title = t(lang, 'meta.title');
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(lang, node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((node) => {
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const separator = pair.indexOf(':');
      if (separator < 0) continue;
      const attribute = pair.slice(0, separator).trim();
      const key = pair.slice(separator + 1).trim();
      if (attribute && key) node.setAttribute(attribute, t(lang, key));
    }
  });
  document.querySelectorAll('[data-lang-switch]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.langSwitch === lang));
  });
  renderDownloads();
}

function readableSize(bytes) {
  return bytes >= 10 * 1024 ** 2
    ? `${Math.round(bytes / 1024 ** 2)} MB`
    : formatSize(bytes).replace('.', lang === 'es' ? ',' : '.');
}

function releaseVersion() {
  return release ? `v${release.tag_name.trim().replace(/^v/i, '')}` : '';
}

function renderDownloads() {
  const version = releaseVersion();
  for (const slot of slots) {
    const asset = assets[slot.dataset.asset];
    const ready = state === 'ready' && Boolean(asset);
    slot.dataset.state = state === 'ready' ? (ready ? 'ready' : 'soon') : state;
    slot.href = ready ? asset.url : fallbackUrl;
    const size = ready ? readableSize(asset.size) : '';
    slot.querySelectorAll('[data-version]').forEach((node) => { node.textContent = version; });
    slot.querySelectorAll('[data-size]').forEach((node) => { node.textContent = size; });
    const ariaPair = (slot.dataset.i18nAttr || '').split(';')
      .map((pair) => pair.trim()).find((pair) => pair.startsWith('aria-label:'));
    const label = ariaPair ? t(lang, ariaPair.slice('aria-label:'.length).trim()) : slot.textContent.trim();
    slot.setAttribute('aria-label', ready ? `${label}, ${version}, ${size}` : label);
  }
  if (version) {
    document.querySelectorAll('[data-release-version], [data-app-version]').forEach((node) => {
      node.textContent = version;
    });
  }
  downloads.dataset.state = state;
  status.setAttribute('aria-atomic', 'true');
  status.setAttribute('aria-label', `${t(lang, `dl.status.${state}`)}${state === 'ready' ? ` ${version}` : ''}`);
  status.querySelectorAll('[data-when]').forEach((node) => {
    node.setAttribute('aria-hidden', String(node.dataset.when !== state));
  });
  const message = status.querySelector(`[data-when="${state}"]`);
  const messageText = state === 'ready' ? message.querySelector('[data-i18n]') : message;
  messageText.textContent = t(lang, `dl.status.${state}`);
}

function setState(nextState, url) {
  release = null;
  assets = {};
  state = nextState;
  fallbackUrl = url;
  renderDownloads();
}

function validRelease(value) {
  return Boolean(value && typeof value.tag_name === 'string'
    && value.tag_name.trim() && Array.isArray(value.assets));
}

function showRelease(value) {
  release = value;
  assets = mapAssets(value);
  fallbackUrl = typeof value.html_url === 'string' && /^https:\/\//i.test(value.html_url)
    ? value.html_url : RELEASES_URL;
  state = Object.keys(assets).length ? 'ready' : 'soon';
  renderDownloads();
}

function cachedRelease() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
    const age = Date.now() - cached?.timestamp;
    if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL && validRelease(cached.release)) {
      return cached.release;
    }
  } catch {}
  return null;
}

async function loadRelease() {
  setState('loading', LATEST_URL);
  if (params.demo === '1') {
    showRelease({
      tag_name: 'v2.0.0',
      html_url: LATEST_URL,
      assets: [
        ['HiResSpot-2.0.0.apk', 6400000],
        ['hiresspot_2.0.0_amd64.deb', 94400000],
        ['HiResSpot-linux-x64-2.0.0.zip', 124800000],
        ['HiResSpot-Setup.exe', 102800000],
        ['HiResSpot-win32-x64-2.0.0.zip', 158300000],
        ['SHA256SUMS.txt', 520],
      ].map(([name, size]) => ({ name, size, browser_download_url: LATEST_URL })),
    });
    return;
  }
  if (params.demo) {
    setState(params.demo, params.demo === 'error' ? RELEASES_URL : LATEST_URL);
    return;
  }
  const cached = cachedRelease();
  if (cached) {
    showRelease(cached);
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(API_URL, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      setState('soon', RELEASES_URL);
      return;
    }
    const value = await response.json();
    if (!validRelease(value)) throw new Error('Invalid release');
    showRelease(value);
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), release: value }));
    } catch {}
  } catch {
    setState('soon', RELEASES_URL);
  } finally {
    clearTimeout(timeout);
  }
}

function initGallery(gallery) {
  const images = [...gallery.querySelectorAll('[data-shot]')];
  const dots = [...gallery.querySelectorAll('[data-shot-target]')];
  const tablist = gallery.querySelector('[role="tablist"]');
  if (!tablist) return;

  // An error may have fired before this module was ready to listen.
  let available = images.filter((image) => !(image.complete && image.naturalWidth === 0))
    .map((image) => image.dataset.shot);
  const initial = images.find((image) => image.classList.contains('is-active'))?.dataset.shot;
  let current = [params.shot, initial, ...available].find((id) => available.includes(id)) ?? null;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let hovered = gallery.matches(':hover');
  let focused = gallery.contains(document.activeElement);
  let suspended = false;
  let timer = null;

  function render() {
    for (const image of images) {
      const active = image.dataset.shot === current;
      image.hidden = !available.includes(image.dataset.shot);
      image.classList.toggle('is-active', active);
      image.setAttribute('aria-hidden', String(!active));
    }
    for (const dot of dots) {
      const active = dot.dataset.shotTarget === current;
      dot.hidden = !available.includes(dot.dataset.shotTarget);
      dot.disabled = dot.hidden;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-selected', String(active));
      dot.tabIndex = active ? 0 : -1;
    }
    tablist.hidden = available.length < 2;
  }

  function canRotate() {
    return canRotateShots({ count: available.length, forced: Boolean(params.shot),
      reducedMotion: motion.matches, hovered, focused, hidden: document.hidden || suspended });
  }

  function restartTimer() {
    clearTimeout(timer);
    timer = null;
    if (!canRotate()) return;
    timer = setTimeout(() => {
      timer = null;
      if (canRotate()) select(shotTarget(available, current, 'ArrowRight'));
    }, 6000);
  }

  function select(id, focus = false) {
    if (!available.includes(id)) return;
    current = id;
    render();
    if (focus) dots.find((dot) => dot.dataset.shotTarget === current)?.focus();
    restartTimer();
  }

  tablist.addEventListener('click', (event) => {
    const dot = event.target.closest('[data-shot-target]');
    if (dot && dots.includes(dot)) select(dot.dataset.shotTarget);
  });
  tablist.addEventListener('keydown', (event) => {
    const id = shotTarget(available, current, event.key);
    if (id === null) return;
    event.preventDefault();
    select(id, true);
  });
  gallery.addEventListener('mouseenter', () => { hovered = true; restartTimer(); });
  gallery.addEventListener('mouseleave', () => { hovered = false; restartTimer(); });
  gallery.addEventListener('focusin', () => { focused = true; restartTimer(); });
  gallery.addEventListener('focusout', (event) => {
    focused = gallery.contains(event.relatedTarget);
    restartTimer();
  });
  document.addEventListener('visibilitychange', restartTimer);
  motion.addEventListener('change', restartTimer);
  // Register once for this static page; returning from bfcache reuses the listeners.
  window.addEventListener('pagehide', () => { suspended = true; restartTimer(); });
  window.addEventListener('pageshow', () => {
    suspended = false;
    hovered = gallery.matches(':hover');
    focused = gallery.contains(document.activeElement);
    restartTimer();
  });
  for (const image of images) {
    image.addEventListener('error', () => {
      const id = image.dataset.shot;
      if (!available.includes(id)) return;
      const next = shotTarget(available, current, 'ArrowRight');
      available = available.filter((candidate) => candidate !== id);
      if (current === id) current = available.includes(next) ? next : available[0] ?? null;
      render();
      restartTimer();
    });
  }
  render();
  restartTimer();
}

const platform = params.os || detectPlatform(navigator.userAgentData,
  `${navigator.userAgent || ''} ${navigator.platform || ''}`);
document.querySelectorAll('article[data-platform]').forEach((node) => {
  if (node.dataset.platform === platform) node.dataset.primary = 'true';
  else node.removeAttribute('data-primary');
});
document.querySelectorAll('[data-lang-switch]').forEach((button) => {
  button.addEventListener('click', () => {
    applyLanguage(button.dataset.langSwitch);
    saveLanguage();
  });
});
applyLanguage(lang);
if (params.lang) saveLanguage();
void loadRelease();
document.querySelectorAll('[data-gallery]').forEach(initGallery);
