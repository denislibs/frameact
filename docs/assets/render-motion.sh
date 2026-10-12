#!/usr/bin/env bash
# Renders an animated HTML page to MP4 (2x, 30 fps) and GIF (1x, 20 fps).
# usage: ./render-motion.sh <page.html> <duration-seconds> <out-basename>
# needs: Google Chrome, node >= 22, ffmpeg
set -euo pipefail
cd "$(dirname "$0")"
page="$1"; dur="$2"; out="$3"
frames="${TMPDIR:-/tmp}/frameact-frames-$$"
node render-motion.mjs "$page" "$frames" 30 "$dur" 2
ffmpeg -y -loglevel error -framerate 30 -i "$frames/f%04d.png" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart "$out.mp4"
ffmpeg -y -loglevel error -framerate 30 -i "$frames/f%04d.png" \
  -vf "fps=20,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  -loop 0 "$out.gif"
rm -rf "$frames"
ls -la "$out.mp4" "$out.gif"
