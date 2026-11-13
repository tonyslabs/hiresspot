# Seguridad

*English summary at the bottom.*

## Versiones con soporte
Solo la última versión publicada en [Releases](https://github.com/tonyslabs/hiresspot/releases/latest). Si encuentras un problema en una versión anterior, comprueba primero que siga ocurriendo en la última.

## Cómo reportar una vulnerabilidad
Usa **Security → Report a vulnerability** en este repositorio (reporte privado de GitHub). Por favor, no abras un issue público con detalles de explotación. Respondo en unos días; es un proyecto personal y no hay un plazo garantizado.

## Qué protege el diseño
- **Escritorio (Electron):** sandbox activado, `contextIsolation`, CSP estricta, un protocolo propio (`hires-media://`) restringido a las carpetas que autorizas y verificación del remitente en cada llamada IPC.
- **Credenciales:** se guardan cifradas con el llavero del sistema (`safeStorage` en escritorio, Android Keystore en el móvil). Si no hay llavero, la contraseña **no se guarda**.
- **Spotify:** OAuth con PKCE y sin secreto de cliente; los tokens viven en el proceso principal y la interfaz nunca los ve.
- **Sin telemetría:** la app solo habla con tu servidor Navidrome y, si usas esas funciones, con Spotify y MusicBrainz.

## Qué conviene saber al usarla
- **Navidrome por HTTP:** la app autentica con el esquema de token y sal de Subsonic (no envía la contraseña en claro), pero el tráfico no va cifrado si tu servidor usa `http://`. Si lo expones fuera de tu red, ponlo detrás de HTTPS o usa una VPN (por ejemplo Tailscale). Android permite `http` a propósito para servidores propios.
- **Windows:** los ejecutables no están firmados digitalmente; SmartScreen avisará. Comprueba la integridad con `SHA256SUMS.txt` del release.
- **Android:** instala solo el APK de los [Releases oficiales](https://github.com/tonyslabs/hiresspot/releases). Huella SHA-256 del certificado de firma, para verificarlo con `apksigner verify --print-certs`:
  `a52b7d631d728f96e3b9f3ffec61243f5235f049f023512f5e2ad9b977d27e90`
- **No es bit-perfect:** el audio pasa por el mezclador del sistema (es una limitación de calidad, no de seguridad).

## Alcance
Cubre el código de este repositorio (aplicaciones de escritorio y Android, paquete `core`/`ui` y la landing). No cubre vulnerabilidades de Navidrome, Spotify, MusicBrainz ni de tu sistema operativo.

---

## English summary
Only the latest [release](https://github.com/tonyslabs/hiresspot/releases/latest) is supported. Report vulnerabilities privately via **Security → Report a vulnerability** (please don't open public issues with exploit details); this is a personal project, so no response time is guaranteed. The desktop app runs sandboxed with context isolation and a strict CSP; credentials are stored only in the OS keyring or Android Keystore (never in plain text), Spotify uses PKCE with no client secret, and there is no telemetry. Navidrome over plain `http://` is not encrypted in transit: use HTTPS or a VPN if the server is reachable outside your network. Windows binaries are unsigned (SmartScreen will warn); verify downloads with `SHA256SUMS.txt`. The Android signing certificate SHA-256 is `a52b7d631d728f96e3b9f3ffec61243f5235f049f023512f5e2ad9b977d27e90`.
