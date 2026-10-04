#!/bin/sh
# Contourne le cache navigateur de GitHub Pages (max-age=600) : à chaque déploiement, les URLs
# des modules JS reçoivent ?v=<build>, et le build est écrit dans index.html et version.json
# pour que l'app détecte qu'une version plus récente est en ligne. Ne touche pas aux sources
# en dev local (index.html y garde le marqueur __BUILD__, et la détection reste inactive).
set -e
BUILD="${1:?usage: stamp-build.sh <build>}"
sed -E -i "s#(from |import )\"(\./[a-z0-9_-]+\.js)\"#\1\"\2?v=$BUILD\"#g" js/*.js
sed -i "s#src=\"js/main.js\"#src=\"js/main.js?v=$BUILD\"#; s#__BUILD__#$BUILD#" index.html
printf '{"build":"%s"}\n' "$BUILD" > version.json
