#!/usr/bin/env bash
# Construye el APK de release firmado con la keystore LOCAL (~/.android/hiresspot-*) y lo adjunta al release
# de un tag (el borrador que crea el workflow "Release"). La keystore nunca sale de este equipo.
#
# Uso:  npm run release:android -w @hiresspot/android -- vX.Y.Z [--dry-run]
#   --dry-run  construye y verifica el APK pero no sube nada.
set -euo pipefail

TAG=${1:?"Uso: publish-apk.sh vX.Y.Z [--dry-run]"}
DRY=${2:-}
cd "$(dirname "$0")/../../.."   # raíz del repo

VERSION=$(node -p "require('./apps/desktop/package.json').version")
[[ "$TAG" == "v$VERSION" ]] || { echo "✖ El tag $TAG no coincide con la versión $VERSION de apps/desktop/package.json" >&2; exit 1; }

PROPS="$HOME/.android/hiresspot-signing.properties"
KEYSTORE="$HOME/.android/hiresspot-release.jks"
[[ -f "$PROPS" && -f "$KEYSTORE" ]] || { echo "✖ Falta la keystore de firma ($KEYSTORE). Vive solo en la TUF: sin ella no se puede firmar." >&2; exit 1; }

npm run apk:release -w @hiresspot/android

APK_SRC=apps/android/android/app/build/outputs/apk/release/app-release.apk
BT=$(ls -d "${ANDROID_HOME:?ANDROID_HOME no definido}"/build-tools/* | sort -V | tail -1)

# 1) la versión del APK debe coincidir con el tag
BADGE=$("$BT/aapt2" dump badging "$APK_SRC")   # salida completa: con `| head` + pipefail aapt2 muere por SIGPIPE
grep -q "versionName='$VERSION'" <<<"$BADGE" || { echo "✖ El APK no es la versión $VERSION: $(grep -m1 '^package:' <<<"$BADGE")" >&2; exit 1; }

# 2) debe estar firmado con LA keystore de release (no la de debug ni sin firmar)
CERT=$("$BT/apksigner" verify --print-certs "$APK_SRC" | grep "SHA-256" | awk '{print $NF}' | tr 'A-Z' 'a-z')
EXPECT=$(keytool -list -keystore "$KEYSTORE" -storepass "$(grep '^storePassword=' "$PROPS" | cut -d= -f2-)" 2>/dev/null \
  | grep -i "SHA-256" | awk '{print $NF}' | tr -d ':' | tr 'A-Z' 'a-z')
[[ -n "$CERT" && "$CERT" == "$EXPECT" ]] || { echo "✖ El APK no está firmado con la keystore de release" >&2; exit 1; }

OUT_DIR=apps/android/release
APK="$OUT_DIR/HiResSpot-$VERSION.apk"
mkdir -p "$OUT_DIR"
cp "$APK_SRC" "$APK"
SUM=$(sha256sum "$APK" | cut -d' ' -f1)
echo "✔ $APK ($(du -h "$APK" | cut -f1)) · SHA-256 $SUM · firma ${CERT:0:16}…"

if [[ "$DRY" == "--dry-run" ]]; then
  echo "(dry-run) No se subió nada. Para adjuntarlo: npm run release:android -w @hiresspot/android -- $TAG"
  exit 0
fi

# 3) subir el APK y añadir su línea a SHA256SUMS.txt del release (también funciona con borradores)
REPO_JSON=$(gh api repos/:owner/:repo/releases --jq ".[] | select(.tag_name==\"$TAG\") | {id, assets: [.assets[] | {name, id}]}") \
  || { echo "✖ No pude consultar los releases con gh" >&2; exit 1; }
[[ -n "$REPO_JSON" ]] || { echo "✖ No encuentro el release de $TAG. El workflow lo crea en borrador al subir el tag." >&2; exit 1; }
SUMS_ID=$(jq -r '.assets[] | select(.name=="SHA256SUMS.txt") | .id' <<<"$REPO_JSON")

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if [[ -n "$SUMS_ID" ]]; then
  # Hay sumas publicadas: hay que poder leerlas; si no, NO se toca el archivo (sobrescribirlo borraría las demás líneas)
  gh api -H "Accept: application/octet-stream" "repos/:owner/:repo/releases/assets/$SUMS_ID" > "$TMP/old" \
    && [[ -s "$TMP/old" ]] || { echo "✖ No pude leer SHA256SUMS.txt del release; no lo modifico. Añade a mano: $SUM  HiResSpot-$VERSION.apk" >&2; exit 1; }
  grep -v "HiResSpot-.*\.apk" "$TMP/old" > "$TMP/SHA256SUMS.txt" || true
else
  : > "$TMP/SHA256SUMS.txt"
fi
echo "$SUM  HiResSpot-$VERSION.apk" >> "$TMP/SHA256SUMS.txt"

gh release upload "$TAG" "$APK" --clobber
gh release upload "$TAG" "$TMP/SHA256SUMS.txt" --clobber
echo "✔ APK y sumas adjuntos a $TAG"
