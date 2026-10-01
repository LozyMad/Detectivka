"""Optimize user-provided pinned notes. Requires Pillow; run from any directory."""
from pathlib import Path
from PIL import Image
from io import BytesIO
import json

root = Path(__file__).resolve().parents[1]
sources = root / 'Доска'
destination = root / 'frontend/assets/board'
artwork = [('yellow', '22_11_26-1'), ('blue', '22_11_44-2'),
           ('green', '22_11_48-3'), ('pink', '22_11_52-4'), ('purple', '22_11_54-5')]
report = []
for color, suffix in artwork:
    matches = list(sources.glob(f'*{suffix}.png'))
    if len(matches) != 1:
        raise RuntimeError(f'Expected one source image for {color}, found {len(matches)}')
    source = matches[0]
    target = destination / f'note-{color}-pinned.webp'
    with Image.open(source) as image:
        original_size = list(image.size)
        image = image.convert('RGBA')
        image.thumbnail((768, 768), Image.Resampling.LANCZOS)
        encoded = BytesIO()
        image.save(encoded, 'WEBP', quality=87, method=6, alpha_quality=100)
        temporary = target.with_suffix('.webp.tmp')
        temporary.write_bytes(encoded.getvalue())
        temporary.replace(target)
        report.append(dict(file=target.relative_to(root).as_posix(),
                           source=source.relative_to(root).as_posix(),
                           bytes_before=source.stat().st_size, bytes_after=target.stat().st_size,
                           dimensions=original_size, dimensions_after=list(image.size), used=True,
                           result='optimized pinned note'))
(root / 'docs/board-note-image-audit.json').write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
audit_path = root / 'docs/image-audit.json'
audit = json.loads(audit_path.read_text(encoding='utf-8'))
audit = [row for row in audit if not (row['file'].startswith('frontend/assets/board/') and
         (Path(row['file']).name.startswith('note-') or Path(row['file']).name.startswith('pushpins')))]
audit_path.write_text(json.dumps(sorted(audit + report, key=lambda row: row['file']),
                                  ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(dict(images=len(report), before=sum(row['bytes_before'] for row in report),
                      after=sum(row['bytes_after'] for row in report)), indent=2))
