"""Build small WebP assets from the originals; requires Pillow.

Original artwork stays available for future edits. Only used assets get derivatives.
Run from the repository root. The report also includes unused and already small files.
"""
from pathlib import Path
from io import BytesIO
from PIL import Image
import json

root = Path(__file__).resolve().parents[1]
frontend = root / 'frontend'
sources = [p for p in frontend.rglob('*') if p.suffix in ('.html', '.css', '.js')]
texts = {p: p.read_text(encoding='utf-8') for p in sources}
report = []
for source in sorted((frontend / 'assets').rglob('*')):
    if source.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp') or '.opt' in source.stem:
        continue
    used = any(source.name in text or source.with_suffix('.opt.webp').name in text for text in texts.values())
    with Image.open(source) as original:
        row = dict(file=source.relative_to(root).as_posix(), bytes_before=source.stat().st_size,
                   dimensions=list(original.size), used=used)
        if not used or (source.suffix == '.webp' and source.stat().st_size < 100_000):
            row.update(bytes_after=row['bytes_before'], result='unused' if not used else 'already small')
            report.append(row)
            continue
        limit = 1600
        quality = 86
        if source.parent.name == 'board':
            limit = 768 if source.stem in ('cork', 'walnut-frame') or source.stem.startswith('note-') else 1600
            if source.stem in ('pushpins', 'red-thread'): limit = 512
            quality = 87
        elif 'wordmark' in source.stem: limit, quality = 1086, 90
        elif source.stem == 'torn-paper-v2': limit = 1086
        elif source.stem in ('corporate-addressbook', 'corporate-questions'):
            # Keep fine UI text sharp, using lossless WebP.
            limit = 2560
        im = original.copy()
        im.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        encoded = BytesIO()
        im.save(encoded, 'WEBP', quality=quality, method=6,
                lossless=source.stem in ('corporate-addressbook', 'corporate-questions'))
        if len(encoded.getvalue()) >= row['bytes_before'] * .9:
            row.update(bytes_after=row['bytes_before'], result='already efficient')
        else:
            destination = source.with_suffix('.opt.webp')
            destination.write_bytes(encoded.getvalue())
            for p in texts: texts[p] = texts[p].replace(source.name, destination.name)
            row.update(bytes_after=destination.stat().st_size,
                       optimized=destination.relative_to(root).as_posix(), dimensions_after=list(im.size), result='optimized')
        report.append(row)

for p, text in texts.items():
    if text != p.read_text(encoding='utf-8'): p.write_text(text, encoding='utf-8')
(root / 'docs').mkdir(exist_ok=True)
(root / 'docs/image-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
active = [row for row in report if row['used']]
print(json.dumps(dict(images=len(report), used=len(active), before=sum(r['bytes_before'] for r in active),
                      after=sum(r['bytes_after'] for r in active)), indent=2))
