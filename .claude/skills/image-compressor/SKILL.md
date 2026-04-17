---
name: image-compressor
description: "Compress and resize images for web using the image-optimizer MCP or sips. Use when asked to 'compress images', 'optimize for web', 'resize photos', or 'make images smaller'. Called by image-selector pipeline."
---

# Image Compressor

Compresses and resizes images for the website. The user exports from Lightroom at full quality for client delivery. This skill creates web-optimized copies that Astro then processes into WebP/AVIF at build time.

## Web Compression Specs (Research-Backed)

| Setting | Value | Why |
|---------|-------|-----|
| **Long edge** | 2560px | Covers 1.5x DPI at 1920px viewports (2560 = 1920 x 1.33) |
| **JPEG quality** | 95% | Sharp re-encodes to WebP/AVIF. Starting at 95% avoids compounding artifacts in skies, skin tones, and bokeh, and keeps web images visibly crisp. Lower source quality = visible banding after re-encode. |
| **Color space** | sRGB, profile embedded | Web standard. Non-sRGB images display desaturated. |
| **EXIF metadata** | Strip | Privacy (GPS coordinates, camera model). Keep only color profile. |
| **Format** | JPEG | Astro converts to WebP (q80) and AVIF (q68) at build time. |

## Target File Sizes (After Astro Processes)

These are targets for the final delivered format. Use to verify optimization is working:

| Image Type | AVIF Target | WebP Target | JPEG Fallback |
|---|---|---|---|
| Hero / full-width (1920px) | 120-180 KB | 200-300 KB | 350-500 KB |
| Gallery thumbnails (600-800px) | 30-50 KB | 50-80 KB | 80-120 KB |
| Card covers (400px) | 15-25 KB | 25-40 KB | 40-60 KB |
| OG / social sharing (1200x630) | N/A (must be JPEG) | N/A | 80-120 KB at q85 |

## Process

### Using image-optimizer MCP (preferred)
1. Use the `image-optimizer` MCP tool to batch-optimize selected images
2. Resize to max 2560px on the long edge
3. Compress to 95% JPEG quality
4. Strip EXIF metadata
5. Convert to sRGB color space
6. Output to the portfolio subfolder

### Fallback: macOS sips
```bash
for f in /path/to/selected/*.jpg; do
  sips --resampleHeightWidthMax 2560 -s formatOptions 95 "$f" --out "$DEST/$(basename "$f")"
done
```

Note: `sips` does not strip EXIF directly in the resize command. Use a separate step if needed:
```bash
# Strip EXIF with exiftool (if installed)
exiftool -all= -tagsfromfile @ -colorspacetags "$DEST"/*.jpg
```

## Important
- **Always ask the user** before compressing: "Should I compress these for web? Your originals at [source path] will stay untouched."
- Never modify the source files. Always copy first, compress the copy.
- Source images should already be in sRGB from Lightroom. If they're Adobe RGB or ProPhoto RGB, colors will be wrong on the web.

## Lightroom Export Settings (For Akash's Reference)

When exporting from Lightroom Classic for the web pipeline:
- **Resize to Fit**: Long Edge, 2560px
- **Don't Enlarge**: Checked
- **Resolution**: 72 pixels per inch
- **Quality**: 95%
- **Color Space**: sRGB
- **Output Sharpening**: Sharpen for Screen, Standard
- **Metadata**: Copyright Only (strips camera info, GPS, lens data)

For client delivery (full quality), export at 100% quality with all metadata. The web pipeline handles its own compression.

## Pipeline Position
```
image-selector → auto-tagger → cover-selector → image-compressor (YOU) → gallery-deployer
```