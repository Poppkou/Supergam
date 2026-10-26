#!/bin/sh
# Пересборка vendor-файлов: npm install && sh build.sh
set -e
A=../../app/src/main/assets
npx esbuild entry.js --bundle --minify --format=iife --outfile=$A/vendor/three.js
mkdir -p $A/fonts
for w in 500 600 700; do for s in cyrillic latin; do cp node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-$s-$w-normal.woff2 $A/fonts/; done; done
for w in 400 500 700; do for s in cyrillic latin; do cp node_modules/@fontsource/roboto-condensed/files/roboto-condensed-$s-$w-normal.woff2 $A/fonts/; done; done
