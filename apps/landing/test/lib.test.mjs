import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectPlatform, mapAssets, formatSize, formatDate, parseParams, t, translations } from '../lib.js';
import * as lib from '../lib.js';

const userAgents = {
  android: 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
};

for (const [name, ua] of Object.entries(userAgents)) {
  test(`detectPlatform: UA real de ${name}`, () => {
    assert.equal(detectPlatform(undefined, ua), ['android', 'linux', 'windows'].includes(name) ? name : null);
  });
}

test('detectPlatform: Client Hints tiene prioridad y UA sirve de respaldo', () => {
  assert.equal(detectPlatform({ platform: 'Android' }, userAgents.linux), 'android');
  assert.equal(detectPlatform({ platform: 'Windows' }, userAgents.android), 'windows');
  assert.equal(detectPlatform({ platform: 'Linux' }, userAgents.windows), 'linux');
  assert.equal(detectPlatform({ platform: 'macOS' }, userAgents.linux), null);
  assert.equal(detectPlatform({ platform: '' }, userAgents.android), 'android');
  assert.equal(detectPlatform({ platform: 'Unknown' }, userAgents.windows), 'windows');
  assert.equal(detectPlatform(null, 'CrOS x86_64'), 'linux');
  assert.equal(detectPlatform(null, 'Win32'), 'windows');
  assert.equal(detectPlatform(null, 'Win64'), 'windows');
  assert.equal(detectPlatform(null, 'X11'), 'linux');
  assert.equal(detectPlatform(null, 'FreeBSD'), null);
  assert.equal(detectPlatform(), null);
});

const exampleRelease = {
  tag_name: 'v2.0.0',
  html_url: 'https://github.com/tonyslabs/hiresspot/releases/tag/v2.0.0',
  assets: [
    ['hiresspot_2.0.0_amd64.deb', 94400000],
    ['HiResSpot-linux-x64-2.0.0.zip', 124800000],
    ['HiResSpot-Setup.exe', 102800000],
    ['HiResSpot-win32-x64-2.0.0.zip', 158300000],
    ['HiResSpot-2.0.0.apk', 6400000],
    ['SHA256SUMS.txt', 520],
  ].map(([name, size]) => ({
    name, size, browser_download_url: `https://github.com/tonyslabs/hiresspot/releases/download/v2.0.0/${name}`,
  })),
};

test('mapAssets: release completo y entrada sin mutaciones', () => {
  const original = structuredClone(exampleRelease);
  const mapped = mapAssets(exampleRelease);
  assert.deepEqual(Object.keys(mapped).sort(), ['android-apk', 'linux-deb', 'linux-zip', 'win-setup', 'win-zip', 'checksums'].sort());
  const slots = ['linux-deb', 'linux-zip', 'win-setup', 'win-zip', 'android-apk', 'checksums'];
  slots.forEach((slot, index) => {
    const asset = exampleRelease.assets[index];
    assert.deepEqual(mapped[slot], { name: asset.name, url: asset.browser_download_url, size: asset.size });
  });
  assert.deepEqual(exampleRelease, original);
});

test('mapAssets: faltantes, nombres alternativos, mayúsculas y prioridad de Setup', () => {
  const asset = (name) => ({ name, size: 1024, browser_download_url: `https://example.com/${name}` });
  const assets = [asset('HiResSpot.exe'), asset('HIRESSPOT-SETUP.EXE'), asset('SHA256SUMS'), asset('HiResSpot-Windows-x64.ZIP')];
  const mapped = mapAssets({ assets });
  assert.equal(mapped['win-setup'].name, 'HIRESSPOT-SETUP.EXE');
  assert.equal(mapped['win-zip'].name, 'HiResSpot-Windows-x64.ZIP');
  assert.equal(mapped.checksums.name, 'SHA256SUMS');
  assert.equal(mapped['android-apk'], undefined);
  assert.equal(mapAssets({ assets: [assets[0]] })['win-setup'].name, 'HiResSpot.exe');
  assert.deepEqual(mapAssets({ assets: [asset('source.tar.gz'), null, {}, { name: 'bad.apk', browser_download_url: 'javascript:alert(1)', size: 1 }] }), {});
  assert.deepEqual(mapAssets(null), {});
  assert.deepEqual(mapAssets({ assets: {} }), {});
});

test('formatSize: base 1024, MB y un decimal', () => {
  assert.equal(formatSize(6400000), '6.1 MB');
  assert.equal(formatSize(94400000), '90.0 MB');
  assert.equal(formatSize(1024 ** 2), '1.0 MB');
  assert.equal(formatSize(1.25 * 1024 ** 2), '1.3 MB');
  assert.equal(formatSize(0), '0.0 MB');
  assert.equal(formatSize(-1), '0.0 MB');
  assert.equal(formatSize(NaN), '0.0 MB');
  assert.equal(formatSize(Infinity), '0.0 MB');
});

test('formatDate: fecha localizada estable en UTC y fechas inválidas', () => {
  assert.equal(formatDate('2026-11-12T00:30:00Z', 'es'), '12 nov 2026');
  assert.equal(formatDate('2026-11-12T00:30:00Z', 'en'), 'Nov 12, 2026');
  assert.equal(formatDate('invalid', 'en'), '');
  assert.equal(formatDate(null, 'es'), '');
  assert.equal(formatDate(''), '');
});

test('parseParams: demo, OS e idioma válidos, combinados y desconocidos', () => {
  for (const demo of ['1', 'loading', 'soon', 'error']) {
    assert.deepEqual(parseParams(`?demo=${demo}&os=windows&lang=en`), { demo, os: 'windows', lang: 'en', shot: null });
  }
  for (const os of ['android', 'linux', 'windows', 'none']) {
    assert.deepEqual(parseParams(`?os=${os}&lang=es`), { demo: null, os, lang: 'es', shot: null });
  }
  assert.deepEqual(parseParams('?demo=true&os=macos&lang=fr'), { demo: null, os: null, lang: null, shot: null });
  assert.deepEqual(parseParams('?demo=&os=&lang='), { demo: null, os: null, lang: null, shot: null });
  assert.deepEqual(parseParams(), { demo: null, os: null, lang: null, shot: null });
});

test('parseParams: shot admite solo las capturas forzadas y combina los otros parámetros', () => {
  for (const shot of ['compare', 'nowplaying']) {
    assert.deepEqual(parseParams(`?demo=1&os=linux&lang=en&shot=${shot}`), {
      demo: '1', os: 'linux', lang: 'en', shot,
    });
  }
  for (const value of ['albums', '', 'COMPARE']) assert.equal(parseParams(`?shot=${value}`).shot, null);
});

test('shotTarget: navegación circular, extremos, vacíos y teclas ajenas sin mutar entradas', () => {
  assert.equal(typeof lib.shotTarget, 'function');
  const ids = Object.freeze(['nowplaying', 'compare', 'albums']);
  for (const [current, key, expected] of [
    ['nowplaying', 'ArrowRight', 'compare'], ['albums', 'ArrowRight', 'nowplaying'],
    ['nowplaying', 'ArrowLeft', 'albums'], ['albums', 'ArrowLeft', 'compare'],
    ['compare', 'Home', 'nowplaying'], ['nowplaying', 'End', 'albums'],
    ['compare', 'Tab', null], ['missing', 'Home', 'nowplaying'],
  ]) assert.equal(lib.shotTarget(ids, current, key), expected);
  assert.equal(lib.shotTarget([], null, 'ArrowRight'), null);
  assert.equal(lib.shotTarget(['compare'], 'compare', 'ArrowLeft'), 'compare');
});

test('canRotateShots: requiere al menos dos capturas y ninguna condición de pausa', () => {
  assert.equal(typeof lib.canRotateShots, 'function');
  const ready = Object.freeze({ count: 2, forced: false, reducedMotion: false,
    hovered: false, focused: false, hidden: false });
  assert.equal(lib.canRotateShots(ready), true);
  for (const count of [0, 1]) assert.equal(lib.canRotateShots({ ...ready, count }), false);
  for (const flag of ['forced', 'reducedMotion', 'hovered', 'focused', 'hidden']) {
    assert.equal(lib.canRotateShots({ ...ready, [flag]: true }), false);
  }
});

test('diccionarios es/en: mismas claves y el texto por defecto del HTML coincide con el español', async () => {
  assert.deepEqual(Object.keys(translations.es).sort(), Object.keys(translations.en).sort());
  for (const [key, value] of Object.entries(translations.es)) assert.ok(value && translations.en[key], `clave vacía: ${key}`);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const decode = (text) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
  const used = new Set();
  // Texto de elementos con data-i18n="clave": el HTML estático (lo que ve quien no tiene JS) debe decir lo mismo que el diccionario
  for (const [, key, text] of html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
    used.add(key);
    assert.equal(decode(text).trim(), t('es', key), `texto del HTML desincronizado: ${key}`);
  }
  // Atributos traducidos (data-i18n-attr="atributo:clave;...") deben apuntar a claves que existen
  for (const [, spec] of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of spec.split(';')) {
      const key = pair.split(':')[1]?.trim();
      assert.ok(key && translations.es[key], `atributo con clave inexistente: ${pair}`);
      used.add(key);
    }
  }
  assert.ok(used.size > 20, 'el HTML debería usar buena parte del diccionario');
  assert.equal(t('fr', 'nav.repo'), 'Código');
  assert.equal(t('es', 'unknown.key'), 'unknown.key');
});
