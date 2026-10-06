# Investigation board artwork

The assets are used locally by investigation-board.css and landing-product.css.

## Dark cork, walnut frame and restored pushpin notes (current, 2026-10-06)

Generated with the built-in image_gen.imagegen tool using the approved dark cork / wood concept
in `output/board-concepts-20261006-v3/dark-cork-walnut-board.png` as a material reference.
`dark-cork-surface-v5.webp` is an opaque 1536 × 1024 tobacco-brown cork material.
It repeats directly at 768 × 512 board coordinates for finer cork grain, without mirrored motifs.
The live board paints the cork on the same canvas as its notes, pins and threads: panning and
zooming move the grain with the attachment points. CSS layout zoom preserves sharp overview
text, while a repeated texture fills growing canvas bounds without stretching the source.
The wooden frame stays around the viewport. Public demos use the same cork and frame assets.
`walnut-frame-v5.webp` preserves a transparent opening and is rendered as a 10% nine-slice border.
The original `note-{yellow,pink,blue,green,purple}-pinned.webp` files supplied by the user are reused
without re-encoding or changing their contents, including their original red pushpins.
Live notes, edit dialogs and public board demos all use these restored images.

Paper stays below threads, with a cropped pushpin layer above threads. The layer forwards taps
and drags to the corresponding note. The existing red-thread.opt.webp and thread appearance remain
unchanged. Thread endpoints still meet the original pin bases. Text retains the layout-zoom fix
and minimum displayed sizes in the overview.
Generated sources: `output/board-textures-v5/source/`.
Prompts and asset paths: `docs/board-cork-frame-v5.json`.
Conversion, alpha checks and reused-image hashes: `output/board-textures-v5/prepare-assets.cjs`
and `output/board-textures-v5/asset-audit.json`. Earlier materials are retained.

## Metal board and magnetic notes (previous, 2026-10-06)

Generated with the built-in image_gen.imagegen tool from the user's gray steel board reference.
`metal-surface-v2.webp` is the original softly worn gray metal surface (1536 × 1024),
restored at the user's request. It covers the viewport outside the notes' zoom, so it
does not stretch over the growing canvas when zooming out. Public demos use the same surface.
The unused v3 and v4 variants are retained with their sources and generation prompts
in `docs/board-surface-v3.json` and `docs/board-surface-v4.json`.
`metal-frame-v2.webp` is a metal frame with corner screws and transparent center (768 × 768),
rendered as a 10% nine-slice border image so it remains fixed during zoom and pan.
`note-{yellow,pink,blue,green,purple}-magnet-v2.webp` are blank pastel paper sprites with
round enamel disc magnets and preserved transparency (768 × 768).
They share the existing 300 × 300 note box and magnet attachment area, so the board controller
and thread coordinates do not need changes. Notes, edit dialogs and public board demos use them.

The existing red-thread.opt.webp and thread appearance are unchanged.
On 2026-10-06 the thread layer was raised above paper, with a separate cropped magnet layer
above threads. Magnets follow note movement and route pointer gestures to their paper notes.
Board scaling uses CSS layout zoom, with paper shadows isolated from live text.
Overview labels keep minimum displayed font sizes (title 11px, comment 10px, address 9px)
to avoid unreadably small text at 40% zoom.
Original generated PNGs are retained in `output/board-textures-v2/source/`.
Full prompts and asset paths are recorded in `docs/board-textures-v2.json`.
WebP conversion and alpha validation: `output/board-textures-v2/prepare-assets.cjs` (requires sharp).
The prior cork, wood and pinned-note assets are retained for easy rollback.

## Source of the pinned notes (2026-09-30)

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
