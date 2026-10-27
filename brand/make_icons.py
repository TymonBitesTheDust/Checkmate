# Rasterises the icon SVGs (from export-svgs.mjs) into every size the
# Windows, Android and browser extension builds need, one set per style.
import os, sys, io
import cairosvg
from PIL import Image

OUT = sys.argv[1]
SVG = os.path.join(OUT, 'svg')
STYLES = ['tickwise', 'archive', 'riot', 'tide', 'frontier', 'neon']

def render(name, size):
    png = cairosvg.svg2png(url=os.path.join(SVG, name + '.svg'), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert('RGBA')

def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)

save(render('tickwise', 1024), f'{OUT}/icon-1024.png')
save(render('tickwise', 512), f'{OUT}/icon-512.png')

dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for style in STYLES:
    # Windows icon frames
    for s in (256, 64, 48, 32, 16):
        save(render(style, s), f'{OUT}/win/{style}/icon{s}.png')
    suffix = '' if style == 'tickwise' else f'_{style}'
    for d, f in dens.items():
        # legacy launcher icon, inset slightly like stock icons
        s = int(48 * f)
        canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
        inner = render(style, int(s * 0.92))
        canvas.paste(inner, ((s - inner.width) // 2, (s - inner.height) // 2), inner)
        save(canvas, f'{OUT}/android/res/mipmap-{d}/ic_launcher{suffix}.png')
        save(canvas, f'{OUT}/android/res/mipmap-{d}/ic_launcher{suffix}_round.png')
        # adaptive layers (108dp)
        a = int(108 * f)
        save(render(f'{style}-fg', a), f'{OUT}/android/res/mipmap-{d}/ic_launcher{suffix}_foreground.png')
        save(render(f'{style}-bg', a), f'{OUT}/android/res/mipmap-{d}/ic_launcher{suffix}_background.png')

# the browser extension (toolbar, extensions page, notifications)
for s in (16, 32, 48, 128):
    save(render('tickwise', s), f'{OUT}/ext/icon{s}.png')

for d, f in dens.items():
    save(render('notify', int(24 * f)), f'{OUT}/android/res/drawable-{d}/ic_stat_tick.png')
print('icons written to', OUT)
