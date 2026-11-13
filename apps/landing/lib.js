const assetPatterns = {
  'android-apk': [/\.apk$/i],
  'linux-deb': [/\.deb$/i],
  'linux-zip': [/linux.*\.zip$/i],
  'win-setup': [/setup.*\.exe$/i, /\.exe$/i],
  'win-zip': [/win(32|64|dows)?.*\.zip$/i],
  checksums: [/^sha256sums(\.txt)?$/i],
};

export function detectPlatform(uaData, ua = '') {
  const classify = (value) => {
    if (/android/i.test(value)) return 'android';
    if (/iphone|ipad|ipod|mac|ios/i.test(value)) return null;
    if (/windows|win32|win64/i.test(value)) return 'windows';
    if (/linux|x11|cros/i.test(value)) return 'linux';
    return null;
  };
  const platform = typeof uaData === 'string' ? uaData : uaData?.platform;
  if (platform) {
    const detected = classify(platform);
    if (detected || /iphone|ipad|ipod|mac|ios/i.test(platform)) return detected;
  }
  return classify(ua);
}

export function mapAssets(releaseJson) {
  const assets = Array.isArray(releaseJson?.assets) ? releaseJson.assets : [];
  const usable = assets.filter((asset) => asset && typeof asset.name === 'string'
    && typeof asset.browser_download_url === 'string'
    && /^https:\/\//i.test(asset.browser_download_url)
    && Number.isFinite(asset.size) && asset.size >= 0);
  const mapped = {};
  for (const [slot, patterns] of Object.entries(assetPatterns)) {
    for (const pattern of patterns) {
      const asset = usable.find(({ name }) => pattern.test(name));
      if (asset) {
        mapped[slot] = { name: asset.name, url: asset.browser_download_url, size: asset.size };
        break;
      }
    }
  }
  return mapped;
}

export function formatSize(bytes) {
  const value = Number.isFinite(bytes) && bytes >= 0 ? bytes : 0;
  return `${(value / (1024 ** 2)).toFixed(1)} MB`;
}

export function formatDate(iso, lang = 'es') {
  if (typeof iso !== 'string' || !iso.trim()) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-ES', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

export function parseParams(search = '') {
  const params = new URLSearchParams(search);
  const valid = (key, values) => values.includes(params.get(key)) ? params.get(key) : null;
  return {
    demo: valid('demo', ['1', 'loading', 'soon', 'error']),
    os: valid('os', ['android', 'linux', 'windows', 'none']),
    lang: valid('lang', ['es', 'en']),
    shot: valid('shot', ['nowplaying', 'compare']),
  };
}

export function shotTarget(shots, current, key) {
  if (!shots.length) return null;
  if (key === 'Home') return shots[0];
  if (key === 'End') return shots.at(-1);
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const index = shots.indexOf(current);
  if (index < 0) return shots[0];
  return shots[(index + (key === 'ArrowRight' ? 1 : -1) + shots.length) % shots.length];
}

export function canRotateShots({ count, forced, reducedMotion, hovered, focused, hidden }) {
  return count > 1 && !forced && !reducedMotion && !hovered && !focused && !hidden;
}

export const translations = Object.freeze({
  es: Object.freeze({
    'nav.repo': 'Código',
    'hero.eyebrow': 'Código abierto',
    'hero.title.a': 'Tu Navidrome,',
    'hero.title.b': 'en alta resolución.',
    'hero.lede': 'Cliente hi-fi para Navidrome. Muestra la calidad real de cada pista y pone tu biblioteca de Spotify al lado, solo para comparar.',
    'feat.navidrome': 'Navidrome',
    'feat.hires': 'Sello Hi-Res',
    'feat.compare': 'Comparador',
    'feat.lyrics': 'Letras',
    'feat.eq': 'EQ',
    'feat.background': 'Segundo plano',
    'dl.title': 'Descargas',
    'dl.linux.sub': 'Debian · Ubuntu · x64',
    'dl.badge': 'Tu sistema',
    'dl.linux.deb': '.deb',
    'dl.state.soon': 'Pronto',
    'dl.state.error': 'Ver en GitHub',
    'dl.zip': 'ZIP',
    'dl.windows.sub': 'Windows 10/11 · x64',
    'dl.win.setup': 'Instalador',
    'dl.android.sub': 'Android 7+',
    'dl.android.apk': 'APK',
    'dl.status.loading': 'Buscando versión…',
    'dl.status.ready': 'Última versión:',
    'dl.status.soon': '2.0.0 en camino. Los archivos saldrán en GitHub Releases.',
    'dl.status.error': 'GitHub no responde. Descarga desde la página de versiones.',
    'dl.note.windows': 'Windows: sin firma digital, SmartScreen avisará.',
    'dl.note.mac': 'Sin macOS por ahora.',
    'stage.now': 'Reproduciendo',
    'stage.shelf': 'Hi-Res',
    'foot.sibling': 'Drstify baja el audio. HiResSpot lo reproduce.',
    'foot.repo': 'Repo',
    'foot.releases': 'Releases',
    'foot.author': 'por',
    'shots.label': 'Capturas de la app',
    'shots.nowplaying': 'Reproduciendo: sello Hi-Res 24/48 y cola de pistas',
    'shots.compare': 'Comparador: Navidrome frente a Spotify',
    'shots.albums': 'Biblioteca de álbumes con portadas',
    'meta.description': 'Reproductor hi-fi de código abierto para Linux, Windows y Android. Cliente Navidrome con sello Hi-Res, letras y tu biblioteca de Spotify para comparar.',
    'meta.title': 'HiResSpot — Reproductor hi-fi para Navidrome',
    'nav.label': 'Enlaces',
    'lang.label': 'Idioma',
    'feat.label': 'Funciones',
    'dl.linux.deb.aria': 'Descargar el paquete .deb para Linux',
    'dl.linux.zip.aria': 'Descargar el ZIP portable para Linux',
    'dl.win.setup.aria': 'Descargar el instalador para Windows',
    'dl.win.zip.aria': 'Descargar el ZIP portable para Windows',
    'dl.android.apk.aria': 'Descargar el APK para Android',
  }),
  en: Object.freeze({
    'nav.repo': 'Source',
    'hero.eyebrow': 'Open source',
    'hero.title.a': 'Your Navidrome,',
    'hero.title.b': 'in high resolution.',
    'hero.lede': 'A hi-fi client for Navidrome. Shows each track\'s real quality and puts your Spotify library beside it, read-only, to compare.',
    'feat.navidrome': 'Navidrome',
    'feat.hires': 'Hi-Res seal',
    'feat.compare': 'Compare',
    'feat.lyrics': 'Lyrics',
    'feat.eq': 'EQ',
    'feat.background': 'Background',
    'dl.title': 'Downloads',
    'dl.linux.sub': 'Debian · Ubuntu · x64',
    'dl.badge': 'Your system',
    'dl.linux.deb': '.deb',
    'dl.state.soon': 'Soon',
    'dl.state.error': 'View on GitHub',
    'dl.zip': 'ZIP',
    'dl.windows.sub': 'Windows 10/11 · x64',
    'dl.win.setup': 'Installer',
    'dl.android.sub': 'Android 7+',
    'dl.android.apk': 'APK',
    'dl.status.loading': 'Checking releases…',
    'dl.status.ready': 'Latest:',
    'dl.status.soon': '2.0.0 is on its way. Files will land on GitHub Releases.',
    'dl.status.error': 'GitHub isn\'t responding. Grab it from the releases page.',
    'dl.note.windows': 'Windows: unsigned, SmartScreen will warn you.',
    'dl.note.mac': 'No macOS build yet.',
    'stage.now': 'Now playing',
    'stage.shelf': 'Hi-Res',
    'foot.sibling': 'Drstify grabs the audio. HiResSpot plays it.',
    'foot.repo': 'Repo',
    'foot.releases': 'Releases',
    'foot.author': 'by',
    'shots.label': 'App screenshots',
    'shots.nowplaying': 'Now playing: Hi-Res 24/48 seal and track queue',
    'shots.compare': 'Compare: Navidrome against Spotify',
    'shots.albums': 'Album library with covers',
    'meta.description': 'Open-source hi-fi player for Linux, Windows and Android. A Navidrome client with a Hi-Res seal, lyrics and your Spotify library to compare.',
    'meta.title': 'HiResSpot — Hi-fi player for Navidrome',
    'nav.label': 'Links',
    'lang.label': 'Language',
    'feat.label': 'Features',
    'dl.linux.deb.aria': 'Download the .deb package for Linux',
    'dl.linux.zip.aria': 'Download the portable ZIP for Linux',
    'dl.win.setup.aria': 'Download the installer for Windows',
    'dl.win.zip.aria': 'Download the portable ZIP for Windows',
    'dl.android.apk.aria': 'Download the APK for Android',
  }),
});

export function t(lang, key) {
  return translations[lang === 'en' ? 'en' : 'es'][key] ?? key;
}
