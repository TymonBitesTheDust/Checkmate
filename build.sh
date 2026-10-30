#!/usr/bin/env bash
# Builds all four versions of Checkmate from the web app in ./web.
#   dist/Checkmate.html  - the app as one file (open in any browser, or host it)
#   dist/Checkmate.exe   - Windows 10/11 app (WebView2)
#   dist/Checkmate.apk   - Android 7+ app (WebView)
#   dist/Checkmate-extension.zip - Chrome/Edge extension (Manifest V3); unpacked in extension/dist/Checkmate
#
# Needs: Node 18+, Go 1.22+, JDK 17+, Python 3 with Pillow and cairosvg, plus the tools listed below.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
TOOLS=${TOOLS:-$HOME/tools}
APKTOOL=${APKTOOL:-$TOOLS/apktool/apktool.jar}            # https://github.com/iBotPeaches/Apktool/releases (2.12.1)
SIGNER=${SIGNER:-$TOOLS/signer/uber-apk-signer.jar}       # https://github.com/patrickfav/uber-apk-signer/releases (1.3.0)
DX=${DX:-$TOOLS/dex2jar/x/dex-tools-2.1/lib/dx-27.0.3.jar} # dx from https://github.com/pxb1988/dex2jar/releases (2.1)
GOWINRES=${GOWINRES:-$TOOLS/go-winres}                    # go install github.com/tc-hib/go-winres@v0.3.3
# Android signing. The release key is NOT in this repository: keep it somewhere safe and point
# KEYSTORE at it, with its password in KS_PASS. Without it, a throwaway development key is used.
KEYSTORE=${KEYSTORE:-android/signing/checkmate-release.jks}
KS_ALIAS=${KS_ALIAS:-checkmate}
KS_PASS=${KS_PASS:-}

mkdir -p dist

echo "==> Web app"
(cd web && npm install --no-audit --no-fund >/dev/null && node build.mjs)
cp web/dist/Checkmate.html dist/Checkmate.html

echo "==> Icons (one set per style)"
node brand/export-svgs.mjs >/dev/null
python3 brand/make_icons.py brand/out >/dev/null

echo "==> Chrome/Edge extension"
node extension/build.mjs

echo "==> Windows .exe"
mkdir -p desktop/assets && cp web/dist/Checkmate.html desktop/assets/index.html
for s in tickwise archive riot tide frontier neon; do mkdir -p desktop/winres/$s && cp brand/out/win/$s/icon*.png desktop/winres/$s/; done
(cd desktop && "$GOWINRES" make --in winres/winres.json --out rsrc \
  && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui -s -w" -o "$ROOT/dist/Checkmate.exe" .)

echo "==> Android .apk"
A=android
rm -rf $A/build && mkdir -p $A/build/stubs $A/build/classes
javac -nowarn --release 8 -d $A/build/stubs $(find $A/stubs -name '*.java') 2>/dev/null
javac --release 8 -Xlint:-options -cp $A/build/stubs -d $A/build/classes $(find $A/src -name '*.java')
java -cp "$DX" com.android.dx.command.Main --dex --min-sdk-version=24 --output=$A/apk/classes.dex $A/build/classes
cp -r brand/out/android/res/* $A/apk/res/
mkdir -p $A/apk/assets && cp web/dist/Checkmate.html $A/apk/assets/index.html
java -jar "$APKTOOL" b $A/apk -o $A/build/Checkmate-unsigned.apk --frame-path $A/build/fw
if [ -f "$KEYSTORE" ] && [ -n "$KS_PASS" ]; then
  echo "    signing with $KEYSTORE"
else
  echo "    !! No release key (set KEYSTORE and KS_PASS). Signing with a throwaway development key."
  echo "    !! This APK will NOT install over the published Checkmate app. Don't release it."
  KEYSTORE=$A/build/dev.jks KS_ALIAS=dev KS_PASS=dev-only-key
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias "$KS_ALIAS" -keyalg RSA -keysize 3072 -validity 10950 -dname "CN=Checkmate dev, C=AU" >/dev/null 2>&1
fi
java -jar "$SIGNER" --apks $A/build/Checkmate-unsigned.apk --ks "$KEYSTORE" \
  --ksAlias "$KS_ALIAS" --ksPass "$KS_PASS" --ksKeyPass "$KS_PASS" --out $A/build/signed --allowResign >/dev/null
cp $A/build/signed/Checkmate-aligned-signed.apk dist/Checkmate.apk

ls -la dist
