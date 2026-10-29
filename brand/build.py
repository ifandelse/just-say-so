# Builds the brand SVGs. Needs fontTools, uharfbuzz, and the Space Grotesk
# variable font (sg/SpaceGrotesk[wght].ttf from the google/fonts repo) in
# a scratch directory; run from there with the output directory as the
# argument: python build_brand.py /path/to/repo/brand. The PNGs are
# rendered afterwards with headless Chrome; see brand/README.md.
import os, json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import uharfbuzz as hb

OUT = sys.argv[1]
os.makedirs(os.path.join(OUT, 'png'), exist_ok=True)

# The mark: U from the candidates page, four pieces, 111.5 x 116.
MARK = [
  'M36 0 78 0 66 24 24 24Z',
  'M84.7 0 111.5 0 86.5 50.1 73.1 23.3Z',
  'M40.1 89.2 53.5 116 83.1 56.8 69.7 30Z',
  'M0 76 26.8 76 46.8 116 20 116Z',
]
MW, MH = 111.5, 116
BLUE, BLUE_DARK, INK, PAPER = '#2757a5', '#5b8be0', '#111111', '#f2f2f6'

def mark_paths(color, scale=1, dx=0, dy=0):
    t = f' transform="translate({dx:.2f} {dy:.2f}) scale({scale:.4f})"' if (scale != 1 or dx or dy) else ''
    return f'<g fill="{color}"{t}>' + ''.join(f'<path d="{d}"/>' for d in MARK) + '</g>'

def svg(w, h, body, vb=None):
    vb = vb or f'0 0 {w} {h}'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}" role="img" aria-label="just-say-so">{body}</svg>\n'

# Marks
for name, color in [('mark', BLUE), ('mark-dark', BLUE_DARK), ('mark-white', '#ffffff'), ('mark-black', INK)]:
    open(os.path.join(OUT, f'{name}.svg'), 'w').write(svg(MW, MH, mark_paths(color)))
# Square icon: the mark centred in a 128 box with padding, for favicons
pad_x, pad_y = (128 - MW) / 2, (128 - MH) / 2
for name, color in [('icon', BLUE), ('icon-dark', BLUE_DARK)]:
    open(os.path.join(OUT, f'{name}.svg'), 'w').write(svg(128, 128, mark_paths(color, 1, pad_x, pad_y)))

# The wordmark: Space Grotesk at weight 700, shaped with HarfBuzz, outlined.
vf = TTFont('sg/SpaceGrotesk-VF.ttf')
font = instantiateVariableFont(vf, {'wght': 700})
upm = font['head'].unitsPerEm
asc, desc = font['hhea'].ascent, -font['hhea'].descent
glyph_set = font.getGlyphSet()
order = font.getGlyphOrder()
blob = hb.Blob(open('sg/SpaceGrotesk-VF.ttf', 'rb').read())
face = hb.Face(blob); hfont = hb.Font(face); hfont.set_variations({'wght': 700})
S = 100.0  # font size in SVG units
k = S / upm
TRACK = -0.02 * S  # letter-spacing -0.02em, as in the comps
def shape(text):
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(hfont, buf, {'kern': True, 'liga': True})
    return list(zip(buf.glyph_infos, buf.glyph_positions))

def wordmark(text, color, x0, baseline):
    paths = []; x = x0
    for info, pos in shape(text):
        gname = order[info.codepoint]
        pen = SVGPathPen(glyph_set)
        tpen = TransformPen(pen, (k, 0, 0, -k, x + pos.x_offset * k, baseline - pos.y_offset * k))
        glyph_set[gname].draw(tpen)
        d = pen.getCommands()
        if d: paths.append(f'<path d="{d}"/>')
        x += pos.x_advance * k + TRACK
    width = x - x0 - TRACK
    return f'<g fill="{color}">' + ''.join(paths) + '</g>', width

# Lockup geometry, matching the comps: mark height 1.02em, gap 0.42em, mark centred on the em box.
mark_h = 1.02 * S; scale = mark_h / MH; mark_w = MW * scale
gap = 0.42 * S
box_center = mark_h / 2
baseline = box_center + (asc - desc) * k / 2
text_x = mark_w + gap
_, text_w = wordmark('just-say-so', INK, text_x, baseline)
pad = 8
W, H = text_x + text_w + pad * 2, mark_h + pad * 2
def lockup(mark_color, text_color, bg=None):
    body = (f'<rect width="{W:.1f}" height="{H:.1f}" fill="{bg}"/>' if bg else '')
    body += f'<g transform="translate({pad} {pad})">' + mark_paths(mark_color, scale) + wordmark('just-say-so', text_color, text_x, baseline)[0] + '</g>'
    return svg(round(W, 1), round(H, 1), body)
open(os.path.join(OUT, 'lockup.svg'), 'w').write(lockup(BLUE, INK))
open(os.path.join(OUT, 'lockup-dark.svg'), 'w').write(lockup(BLUE_DARK, PAPER))
open(os.path.join(OUT, 'lockup-white.svg'), 'w').write(lockup('#ffffff', '#ffffff'))
open(os.path.join(OUT, 'lockup-black.svg'), 'w').write(lockup(INK, INK))
# Social image: the light lockup centred on paper, 1200 x 630
sc = 1.3; lw, lh = W * sc, H * sc
body = f'<rect width="1200" height="630" fill="#ffffff"/><g transform="translate({(1200 - lw) / 2:.1f} {(630 - lh) / 2:.1f}) scale({sc})"><g transform="translate({pad} {pad})">' + mark_paths(BLUE, scale) + wordmark('just-say-so', INK, text_x, baseline)[0] + '</g></g>'
open(os.path.join(OUT, 'og-image.svg'), 'w').write(svg(1200, 630, body))
print(json.dumps({'upm': upm, 'asc': asc, 'desc': desc, 'lockup': [round(W, 1), round(H, 1)], 'text_w': round(text_w, 1), 'mark_w': round(mark_w, 1)}))
