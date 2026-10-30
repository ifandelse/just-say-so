# just-say-so brand files

The mark, the lockup, and their exports, for the README, the docs site, and anywhere else the project is shown.

## Files

| File | What it is |
| --- | --- |
| `mark.svg` | The mark alone, blue, 111.5 by 116. For light backgrounds. |
| `mark-dark.svg` | The mark in the dark-background blue. |
| `mark-white.svg`, `mark-black.svg` | One-colour marks for photographs, print, and badges. |
| `icon.svg`, `icon-dark.svg` | The mark centred in a 128 by 128 box with padding, for favicons and app icons. |
| `lockup.svg` | The mark and the name, for light backgrounds. The name is outlined and the file needs no font. |
| `lockup-dark.svg` | The lockup for dark backgrounds. |
| `lockup-white.svg`, `lockup-black.svg` | One-colour lockups. |
| `og-image.svg` | The lockup centred on white at 1200 by 630, for link previews. |
| `png/` | Rasters of the above: the icon at 16 to 512, the apple touch icon at 180 on white, the mark at 224 and 448, the lockups at 689 and 1379 wide, the social image, and `favicon.ico`. |

## Colours

| Use | Value |
| --- | --- |
| Mark on light backgrounds | `#2757a5`, which is `hsl(217 62% 40%)` |
| Mark on dark backgrounds | `#5b8be0`, which is `hsl(217 60% 58%)` |
| Name on light backgrounds | `#111111` |
| Name on dark backgrounds | `#f2f2f6` |

The blue keeps the saturation and lightness of Vale's green, `hsl(92 62% 40%)` and `hsl(92 60% 58%)`, with the hue moved to 217. Side by side, the just-say-so mark and the Vale mark then have the same visual weight.

## The mark

The mark is three parallelograms (the crossbar, the stem, the hook) and one trapezoid (top right). The sides use only two slants. Each leaning side runs down-left at 1 in 2, and each cut, with the hook's sides, runs down-right at 1 in 2, which is 63.4 degrees on the right and 116.6 on the left. The stroke thickness is 24 units on all four pieces, measured across the piece. The perpendicular gap at each joint is 6 units. The stem's lowest vertex sits on the hook's baseline.

```
crossbar  M36 0 78 0 66 24 24 24Z
trapezoid M84.7 0 111.5 0 86.5 50.1 73.1 23.3Z
stem      M40.1 89.2 53.5 116 83.1 56.8 69.7 30Z
hook      M0 76 26.8 76 46.8 116 20 116Z
```

Keep the gaps when scaling. Below about 16 pixels the gaps close and the mark reads as a solid J, which is acceptable for a favicon and nowhere else.

## The name

Space Grotesk, weight 700, letter-spacing −0.02em, the name as `just-say-so` with the dashes. In the lockup the mark stands 1.02em tall, centred on the em box, with a gap of 0.42em before the name. The lockup files contain the name as outlines. A page that sets the name as live text should load Space Grotesk 700 and use the same spacing.

Space Grotesk is by Florian Karsten, under the SIL Open Font License 1.1. The outlines in the lockups are derived from it; the licence permits that, and a copy of the licence is at `OFL-SpaceGrotesk.txt`.

## Regenerating

The SVGs come from a script that builds the mark from its four paths and shapes the name with HarfBuzz from the Space Grotesk variable font at weight 700, then outlines it with fontTools. The PNGs are rendered from the SVGs with headless Chrome at device scale 1, and `favicon.ico` is packed from the 16, 32, and 48 pixel icons. Change the mark's paths or the name in one place and rerun.
