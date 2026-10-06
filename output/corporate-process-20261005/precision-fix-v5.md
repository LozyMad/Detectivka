# Исправление нитей и секундомера v5

Владелец попросил переделать неудачные нити и исправить ошибки циферблата. Текст, фото участников и порядок четырёх шагов сохранены.

## Что сделано

- На компьютере крепления листов 02 и 04 перенесены к правому краю, ближе к соседним листам. Вместо длинных кривых — три короткие натянутые нити в центральном промежутке.
- Каждая нить точно соединяет два крепления по порядку 01 → 02 → 03 → 04. Шляпки креплений нарисованы поверх концов нитей.
- Старый сгенерированный секундомер удалён из обоих фоновых изображений. На компьютере также удалены прежние растровые крепления.
- Встроенным image_gen создан новый латунный корпус на настоящем прозрачном фоне, с пустым эмалевым циферблатом.
- Поверх пустого циферблата добавлен точный SVG: 60 секундных делений, 12 подписей 0–55 с шагом 5, небольшая 30-минутная шкала с шестью подписями 0–25, стрелки и центральное крепление. Все деления расположены математически по кругу. Масштаб и пропорции корпуса и циферблата совпадают.
- На телефоне сохранены существующие соединения слева от листов; заменены фон без старых часов и сами часы.

## Файлы

Сайт:
- [Фон для компьютера](../../frontend/assets/landing/corporate-process-dossier-base-v5.webp) — 1308 × 1202.
- [Фон для телефона](../../frontend/assets/landing/corporate-process-dossier-mobile-v5.webp) — 887 × 1774.
- [Прозрачный корпус секундомера](../../frontend/assets/landing/detectum-stopwatch-case-v5.webp) — 1122 × 1402, альфа-канал сохранён.
- [Точный циферблат](../../frontend/assets/landing/detectum-stopwatch-face-v5.svg) — тот же viewBox 1122 × 1402.
- [Разметка блока](../../frontend/corporate.html).
- [Оформление](../../frontend/css/corporate-process.css).

Оригиналы изображений:
- [Фон для компьютера, PNG](corporate-process-dossier-base-v5.png).
- [Фон для телефона, PNG](corporate-process-dossier-mobile-v5.png).
- [Корпус секундомера, PNG](detectum-stopwatch-case-v5.png).

Использован встроенный image_gen; CLI и внешние API не использовались. Python применялся только для копирования и экспорта WebP. Нити, крепления и точная шкала выполнены средствами SVG.

## Проверка

В браузере проверены обычное окно, 1024, 390 и 320 px: изображения загружаются, все четыре текста помещаются на листах, горизонтального скролла нет. На 320 px часы не пересекаются с длительностью и первым листом.

Отдельно проверены числа и количество делений циферблата, а также совпадение обоих концов каждой нити с центрами соответствующих креплений. Проверка изменений файлов завершилась без ошибок.

Итоговый вид:
- [Обычное окно](process-desktop-v5.jpg).
- [Экран 1024 px](process-desktop-1024-v5.jpg).
- [Экран 320 px](process-mobile-320-v5.jpg).

## Точные промпты

### Редактирование фона для компьютера

```text
Use case: precise-object-edit.
Asset type: existing Detectum corporate landing-page desktop dossier background.
Input image 1 is the edit target.
Remove ONLY the brass stopwatch in the upper-right corner and the FOUR small brass pins at the upper-left corners of the four paper sheets. Reconstruct the underlying quiet dark brown-black leather background where the watch was, and the ivory paper texture where each pin was.
Keep the four paper sheets exactly where they are, with exactly the same silhouettes, dimensions, tears, folds, shadows, colors and blank paper surfaces. Keep the entire composition, canvas aspect ratio and quiet textured background unchanged. The image already has NO strings: keep it that way.
Do not move, resize or redraw any paper. No clock, no watch, no pins, no threads, no new objects, no text, no numbers, no additional details. This is a careful local removal for adding precise separate watch and connecting-pin layers in the website.
```

### Редактирование фона для телефона

```text
Use case: precise-object-edit.
Asset type: existing Detectum corporate landing-page mobile dossier background.
Input image 1 is the edit target.
Remove ONLY the brass stopwatch in the upper-right corner. Reconstruct its area as the same quiet dark brown-black leather background.
Keep absolutely everything else unchanged: all FOUR stacked blank ivory paper sheets, their exact positions and dimensions, all four brass pins and all connecting red threads along the left side, folds, tears, shadows, lighting, colors and the portrait canvas aspect ratio.
No watch, no clock, no replacement objects, no added details, no text or numbers. A precise separate watch layer will be added in the website.
```

### Новый корпус секундомера

```text
Use case: product-mockup.
Asset type: transparent cutout of a vintage brass stopwatch for the dark warm Detectum detective landing page.
Create one refined photorealistic antique brass mechanical stopwatch, photographed exactly straight-on, upright, with a perfectly circular ivory enamel dial. Transparent background. Full object visible, with a small suspension ring above the ribbed crown, a restrained warm aged golden brass case, subtle patina and natural dimensional shading. The watch is a tasteful old detective prop; not a cartoon, not flat vector art.
IMPORTANT: The circular dial must be completely BLANK ivory enamel: no printed numbers, no ticks, no hands, no subdial, no lettering or logo. We will accurately add all markings and hands as a separate precision layer in the website. The blank dial must be a perfect unobstructed circle with no perspective deformation.
Composition: portrait 4:5 canvas, watch upright and centered horizontally, object fills most of the canvas with about 6 percent transparent margin on either side, suspension ring in the upper part, dial centered in the lower part. Soft warm highlight at upper left and darker lower-right rim to match the existing sepia-black scene. No other objects, no cast shadow on an opaque surface, no background, no decorative detail on the dial.
```
