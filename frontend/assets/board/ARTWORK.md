# Investigation board artwork

Generated with the built-in imagegen tool on 2026-09-30. The assets are used locally by investigation-board.css.

## Pinned notes (updated 2026-09-30)

Five replacement images supplied by the user in `Доска/` include the red pushpin in the artwork.
The old seven paper textures and separate pushpin sprite have been removed from the frontend.
`note-{yellow,blue,green,pink,purple}-pinned.webp` preserve transparency at 768 × 768, quality 87.
Rebuild with `python scripts/optimize-board-notes.py` (requires Pillow and the source folder).
The sources total 10,739,431 bytes; the five served images total 376,314 bytes.
Detailed measurements are in `docs/board-note-image-audit.json`.
Saved orange notes display yellow paper; saved mint notes display green paper. Text, positions,
and links are retained. The live edit control is separate from the decorative pushpin.

## detective-desk.png

Full environment artwork behind the live board: dark detective study, walnut desk, warm lamp, papers and magnifying glass. Opaque PNG.

### Generation prompt

Use case: stylized-concept. Asset type: background artwork for an interactive detective investigation board website. Create a cinematic realistic vintage detective study environment, landscape 16:9. Straight-on frontal camera, dark charcoal plaster wall covering the upper 85 percent of the picture, subtly lit by warm amber light. A richly textured dark walnut desk surface along the bottom 15 percent, a few soft-focus cream papers and a dark pen resting on the desk, small brass magnifying glass near lower right. At the extreme left edge only, a partial vintage black desk lamp and a little blurred green plant; extreme right edge only a dark wooden office furnishing. The center and almost all of the upper portion MUST be plain dark empty wall, because a large interactive cork board and UI will be placed there in code. Furniture must not occupy the central region. Elegant moody noir atmosphere, amber highlights, shallow depth of field in foreground, natural warm wood grain. No corkboard, no frame, no notes on wall, no writing, no typography, no user interface, no people, no watermark. Professional website background, not a screenshot.

## walnut-frame.png

A wooden frame with transparent centre, rendered through CSS border-image so the frame stays fixed while the board zooms and pans.

### Generation prompt

Use case: product-mockup. Asset type: transparent PNG nine-slice wooden picture frame for a website cork investigation board. A single square dark walnut wooden frame, perfectly straight-on orthographic frontal view, all four sides present, mitered 45-degree joints at four corners. Narrow richly detailed carved bevel moulding, warm amber highlighted inner lip and dark outer rim, realistic brown wood grain, vintage detective office furniture quality. Frame occupies full image to outer edges; each wood rail is about 8 percent of total image width. The entire large central opening MUST be genuinely transparent alpha, and everything outside the frame is transparent. No cork, no picture, no glass, no background, no objects, no writing, no UI, no watermark. Clean continuous straight rails suitable for CSS border-image stretching: top/bottom wood grain horizontal, side wood grain vertical. No perspective distortion.
