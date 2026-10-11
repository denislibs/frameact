# Assembles captured frames into a looping GIF with one shared palette.
# usage: python3 render-motion.py <framesdir> <out.gif> [fps] [hold_frame_index]
import sys, glob
from PIL import Image
d, out = sys.argv[1], sys.argv[2]
fps = int(sys.argv[3]) if len(sys.argv) > 3 else 20
assert (1000 // fps) % 10 == 0, "GIF frame delay is stored in 1/100 s: use 10, 20, 25 or 50 fps"
files = sorted(glob.glob(f"{d}/f*.png"))
frames = [Image.open(f).convert("RGB") for f in files]
# palette from a strip of evenly sampled frames, so every scene's colors are represented
samples = [frames[int(i * (len(frames) - 1) / 11)] for i in range(12)]
w, h = samples[0].size
strip = Image.new("RGB", (w, h * len(samples)))
for i, im in enumerate(samples): strip.paste(im, (0, i * h))
pal = strip.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
q = [f.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
q[0].save(out, save_all=True, append_images=q[1:], duration=round(1000 / fps), loop=0, optimize=True, disposal=1)
print(out, len(q), "frames")
