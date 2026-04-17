#!/usr/bin/env bash
# Compress and resize images for the AD Photography website.
# Resizes to 2560px longest edge at q95 JPEG (high quality source for Astro).
# Astro handles the final AVIF/WebP conversion at build time.
#
# Usage:
#   ./scripts/compress-image.sh <input> <output>
#   ./scripts/compress-image.sh <input> <output> [max_size] [quality]
#
# Examples:
#   ./scripts/compress-image.sh ~/Downloads/photo.jpg src/assets/images/homepage/hero.jpg
#   ./scripts/compress-image.sh ~/Downloads/photo.jpg src/assets/images/homepage/hero.jpg 1920 90
#
# Defaults:
#   max_size: 2560 (longest edge in pixels)
#   quality:  95   (JPEG quality, high to avoid double-compression blur)

set -euo pipefail

INPUT="$1"
OUTPUT="$2"
MAX_SIZE="${3:-2560}"
QUALITY="${4:-95}"

if [[ ! -f "$INPUT" ]]; then
  echo "ERROR: Input file not found: $INPUT" >&2
  exit 1
fi

# Get dimensions
W=$(sips -g pixelWidth "$INPUT" 2>/dev/null | awk '/pixelWidth/{print $2}')
H=$(sips -g pixelHeight "$INPUT" 2>/dev/null | awk '/pixelHeight/{print $2}')

if [[ -z "$W" || -z "$H" ]]; then
  echo "ERROR: Could not read image dimensions" >&2
  exit 1
fi

# Ensure output directory exists
mkdir -p "$(dirname "$OUTPUT")"

# Resize by longest edge
if [[ "$H" -gt "$W" ]]; then
  # Portrait: constrain height
  if [[ "$H" -gt "$MAX_SIZE" ]]; then
    sips --resampleHeight "$MAX_SIZE" -s formatOptions "$QUALITY" "$INPUT" --out "$OUTPUT" 2>/dev/null
  else
    sips -s formatOptions "$QUALITY" "$INPUT" --out "$OUTPUT" 2>/dev/null
  fi
else
  # Landscape or square: constrain width
  if [[ "$W" -gt "$MAX_SIZE" ]]; then
    sips --resampleWidth "$MAX_SIZE" -s formatOptions "$QUALITY" "$INPUT" --out "$OUTPUT" 2>/dev/null
  else
    sips -s formatOptions "$QUALITY" "$INPUT" --out "$OUTPUT" 2>/dev/null
  fi
fi

# Report result
OUT_W=$(sips -g pixelWidth "$OUTPUT" 2>/dev/null | awk '/pixelWidth/{print $2}')
OUT_H=$(sips -g pixelHeight "$OUTPUT" 2>/dev/null | awk '/pixelHeight/{print $2}')
OUT_SIZE=$(du -h "$OUTPUT" | awk '{print $1}')
ORIENT="landscape"
[[ "$OUT_H" -gt "$OUT_W" ]] && ORIENT="portrait"

echo "${OUT_W}x${OUT_H} ($OUT_SIZE) $ORIENT → $OUTPUT"
