# Исправление соединений между листами

В изображении для компьютера нити уходили под верхний или боковой край листов 02 и 04, хотя булавки находились в левом верхнем углу. Из фонового изображения встроенным image_gen удалены только неверные нити. Четыре листа, булавки, секундомер и фон сохранены.

Новое изображение сайта: `frontend/assets/landing/corporate-process-dossier-base-v4.webp`. [Оригинал](corporate-process-dossier-base-v4.png).

Три соединения 01→02→03→04 добавлены отдельным SVG-слоем в `frontend/corporate.html`, с масштабированием вместе с изображением. Начала и концы путей привязаны к основаниям булавок. Нити обходят листы и текст; исправленные соединения остаются одинаковыми при изменении размера блока. В мобильном изображении соединения уже закреплены на булавках, поэтому оно сохранено.

Проверено в браузере в обычном размере окна и на ширине 1024 px: SVG и фон занимают одинаковую область, соединения доходят до булавок и не пересекают текст. На ширине 390 px проверено сохранение правильных мобильных соединений и отсутствие двойного слоя нитей. Временный размер окна сброшен. [Скриншот исправленного блока](process-desktop-v4.jpg).

## Точный промпт

Use case: precise-object-edit.
Edit target: the attached existing DETECTUM detective-dossier desktop artwork.
Change ONLY this: completely remove the three thin red/orange strings running between the paper sheets. Restore the same quiet dark leather background underneath those string pixels. Do not draw replacement strings; they will be placed precisely in the website.
Critical invariants: keep EVERY other pixel/content and the original canvas framing as unchanged as possible. All four blank ivory paper sheets must retain their exact positions, dimensions, silhouettes, fiber texture, folds, shadows and color. Preserve all four existing brass pins exactly in place at the TOP LEFT corner of each sheet; DO NOT remove the pins. Preserve the antique brass stopwatch in the same upper-right position and size, the same soft amber light, and the same dark quiet matte background. Keep canvas 1309 x 1201 proportions. No crop, no resize, no extra pins, no new objects, no text. This is precise removal of red threads only, not a redesign.
