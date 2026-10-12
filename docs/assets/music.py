# Procedural soundtrack for the frameact videos. No samples, no licenses: everything is synthesized.
# The rhythm is the frame tick (120 BPM = a soft click every 0.5 s), chords change per scene,
# and one-shot sounds are placed on the exact timestamps of the animation events.
# usage: python3 music.py explainer how-it-works.wav   |   python3 music.py banner banner.wav
import sys, math, wave
import numpy as np

SR = 44100
rng = np.random.default_rng(7)

def t_axis(dur): return np.arange(int(dur * SR)) / SR
def env_ar(n, a, r):  # linear attack, exponential-ish release
    e = np.ones(n); na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e
def lowpass_fast(x, cutoff):
    """One-pole low-pass y[n] = a*y[n-1] + (1-a)*x[n], done per 4096-sample block with FFT convolution."""
    a = math.exp(-2 * math.pi * cutoff / SR); b = 1 - a; m = 4096
    pw = a ** np.arange(m); P = np.fft.rfft(pw, 2 * m)
    y = np.zeros_like(x); acc = 0.0
    for s in range(0, len(x), m):
        blk = x[s:s + m]; k = len(blk)
        conv = np.fft.irfft(np.fft.rfft(blk, 2 * m) * P, 2 * m)[:k] * b
        yb = a ** np.arange(1, k + 1) * acc + conv
        y[s:s + k] = yb; acc = yb[-1]
    return y
def note(n): return 440.0 * 2 ** ((n - 69) / 12)

class Mix:
    def __init__(self, dur):
        self.n = int(dur * SR); self.L = np.zeros(self.n); self.R = np.zeros(self.n)
    def add(self, t0, sig, gain=1.0, pan=0.0):
        i = int(t0 * SR); j = min(self.n, i + len(sig)); k = j - i
        if k <= 0: return
        l = gain * math.cos((pan + 1) * math.pi / 4); r = gain * math.sin((pan + 1) * math.pi / 4)
        self.L[i:j] += sig[:k] * l; self.R[i:j] += sig[:k] * r
    def write(self, path, fade_out=1.5):
        f = np.ones(self.n); nf = int(fade_out * SR); f[-nf:] = np.linspace(1, 0, nf) ** 1.5
        L, R = np.tanh(self.L * 1.2) * f, np.tanh(self.R * 1.2) * f
        peak = max(np.abs(L).max(), np.abs(R).max()) or 1.0
        s = np.stack([L, R], 1) / peak * 0.89
        with wave.open(path, "wb") as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((s * 32767).astype("<i2").tobytes())

# ---- instruments -------------------------------------------------------------------------
def pad(chord, dur, detune=0.004):
    t = t_axis(dur); out = np.zeros_like(t)
    for m in chord:
        f = note(m)
        for d in (1 - detune, 1 + detune):
            ph = 2 * np.pi * f * d * t + 0.3 * np.sin(2 * np.pi * 0.17 * t)
            out += np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    out = lowpass_fast(out, 900) / (len(chord) * 2.2)
    return out * env_ar(len(t), min(1.2, dur / 3), min(1.4, dur / 3))
def pluck(m, dur=0.45, bright=0.5):
    t = t_axis(dur); f = note(m)
    e = np.exp(-t * 9)
    return (np.sin(2 * np.pi * f * t) + bright * 0.5 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 18)
            + 0.15 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 30)) * e * 0.5
def bass(m, dur=0.42):
    t = t_axis(dur); f = note(m); e = np.exp(-t * 5) * env_ar(len(t), 0.004, 0.05)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t)) * e * 0.8
def tick(accent=False):
    t = t_axis(0.03); n = rng.standard_normal(len(t)) * np.exp(-t * 400)
    s = np.sin(2 * np.pi * (2600 if accent else 1900) * t) * np.exp(-t * 180)
    return (n * 0.15 + s * 0.9) * (0.9 if accent else 0.55)
def blip(f=1320, dur=0.09):
    t = t_axis(dur); return np.sin(2 * np.pi * f * t) * np.exp(-t * 45) * env_ar(len(t), 0.002, 0.02)
def chime(m, dur=1.4):
    t = t_axis(dur); f = note(m)
    return (np.sin(2 * np.pi * f * t) * np.exp(-t * 2.2) + 0.4 * np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t * 4)
            + 0.2 * np.sin(2 * np.pi * f * 3 * t) * np.exp(-t * 7)) * 0.6
def thump(dur=0.35):
    t = t_axis(dur); f = 55 * (1 + 2.5 * np.exp(-t * 40))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * 0.9
def whoosh(dur=0.7, up=True):
    t = t_axis(dur); n = rng.standard_normal(len(t))
    env = np.sin(np.pi * t / dur) ** 2
    # crude band-pass sweep: modulate filtered noise by a sweeping sine
    sweep = np.linspace(300, 2400, len(t)) if up else np.linspace(2400, 300, len(t))
    y = lowpass_fast(n, 1800) * np.sin(2 * np.pi * np.cumsum(sweep) / SR)
    return lowpass_fast(y * env, 3800) * 0.38
def buzz(dur=0.4):
    t = t_axis(dur); f1, f2 = 110, 116.5
    sq = np.sign(np.sin(2 * np.pi * f1 * t)) * 0.5 + np.sign(np.sin(2 * np.pi * f2 * t)) * 0.5
    return lowpass_fast(sq, 700) * env_ar(len(t), 0.005, 0.15) * 0.55
def riser(dur=1.2):
    t = t_axis(dur); n = rng.standard_normal(len(t))
    y = lowpass_fast(n, 600) * (t / dur) ** 2 * np.sin(2 * np.pi * np.cumsum(np.linspace(200, 1600, len(t))) / SR)
    return lowpass_fast(y, 3500) * 0.5

# ---- arrangements ------------------------------------------------------------------------
A, C, D, E, F, G, B, Gs, Fs = 57, 60, 62, 64, 65, 67, 71, 68, 66  # midi, octave 3/4 region
def explainer(mx):
    # chords per scene (start, end, notes)
    scenes = [
        (0.0, 2.5, [A - 12, C, E, G, B]),            # intro · Am9
        (2.5, 11.0, [A - 12, C, E, G, B]),           # 01 signals
        (11.0, 18.5, [F - 12, A, C, E]),             # 02 one pass · Fmaj7
        (18.5, 26.5, [C - 12, E, G, B, D + 12]),     # 03 phases · Cmaj9
        (26.5, 33.5, [G - 12, B, D + 12, Fs + 12]),  # 04 forced reflow · Gmaj7
        (33.5, 41.5, [D - 12, F, A, C + 12]),        # 05 gating · Dm7
        (41.5, 48.0, [E - 12, Gs, B, D + 12]),       # 06 stricterdom · E7 (tension)
        (48.0, 55.5, [A - 12, C, E, G, B]),          # outro + credits · Am9 resolve
    ]
    for s, e, ch in scenes:
        mx.add(s, pad(ch, e - s + 0.6), gain=0.42, pan=-0.15)
        mx.add(s + 0.02, pad([m + 12 for m in ch[1:]], e - s + 0.6, detune=0.006), gain=0.12, pan=0.35)
        if s > 0: mx.add(s - 0.35, whoosh(0.7, up=True), gain=0.26)
    # frame ticks, 120 BPM, accent every bar; quiet during intro/outro
    beat = 0.5
    for i in range(int(55.5 / beat)):
        t0 = i * beat
        if t0 < 2.5 or t0 > 48: continue
        mx.add(t0, tick(accent=(i % 4 == 0)), gain=0.28, pan=(0.25 if i % 2 else -0.25))
    # bass: root on 1, fifth-ish syncopation on 3.5
    for s, e, ch in scenes[1:-1]:
        root = ch[0] - 12
        t0 = math.ceil(s / 2) * 2
        while t0 < e - 0.5:
            mx.add(t0, bass(root), gain=0.55); mx.add(t0 + 1.25, bass(root + 7, 0.3), gain=0.35)
            t0 += 2
    # arpeggio: 8th notes over chord tones, grows through the piece
    for s, e, ch in scenes[1:-1]:
        tones = [m + 12 for m in ch[1:]] + [m + 24 for m in ch[1:3]]
        k = 0; t0 = s + 0.25
        while t0 < e - 0.3:
            g = 0.16 + 0.12 * min(1, (t0 - 2.5) / 30)
            mx.add(t0, pluck(tones[k % len(tones)], bright=0.6), gain=g, pan=0.4 * math.sin(k * 0.9))
            k += 1; t0 += 0.25 if (k % 8) < 6 else 0.5
    # event sounds (seconds match the animation timeline in how-it-works.html)
    for t0 in (4.3, 12.6, 13.2, 13.8, 35.6, 36.3, 37.0):          # set() pops / held writes
        mx.add(t0, blip(1320 + 110 * (hash(t0) % 3)), gain=0.5, pan=0.2)
    for t0 in (20.0, 20.4, 20.8, 21.2):                           # arrivals in scene 03
        mx.add(t0, blip(990, 0.07), gain=0.35, pan=-0.2)
    for t0 in (7.6, 15.3, 38.4):                                  # rAF sweeps
        mx.add(t0, whoosh(0.75, up=True), gain=0.42)
    for t0, m in ((8.35, A + 12), (15.95, F + 12), (31.1, G + 12), (38.9, D + 12)):  # commits
        mx.add(t0, thump(), gain=0.7); mx.add(t0, chime(m), gain=0.5, pan=0.1)
    for t0 in (21.9, 22.1, 22.5, 22.7):                           # sorting into phases
        mx.add(t0, blip(1760, 0.06), gain=0.3, pan=0.3)
    mx.add(28.0, thump(0.3), gain=0.5); mx.add(29.6, blip(1980, 0.12), gain=0.5)  # forced reflow steps
    mx.add(43.0, blip(880, 0.1), gain=0.4)                        # the illegal write drops in
    mx.add(43.45, buzz(), gain=0.8)                               # stricterdom catches it
    for t0 in (44.6, 44.9, 45.2, 45.5, 46.1):                     # console lines
        mx.add(t0, tick(), gain=0.5, pan=0.3)
    mx.add(46.1, chime(E + 24, 1.0), gain=0.25)
    mx.add(47.0, riser(1.2), gain=0.6)                            # into the outro
    mx.add(48.2, whoosh(1.0, up=True), gain=0.5)
    mx.add(49.1, thump(0.5), gain=0.8); mx.add(49.1, chime(A + 12, 2.0), gain=0.6); mx.add(49.1, chime(E + 12, 2.0), gain=0.4, pan=0.3)
    mx.add(51.7, whoosh(0.9, up=True), gain=0.3)                   # credits: line sweeps, photo commits
    mx.add(52.9, thump(0.4), gain=0.5); mx.add(52.9, chime(C + 24, 2.2), gain=0.4, pan=-0.2); mx.add(53.3, chime(E + 24, 2.0), gain=0.3, pan=0.3)

def banner(mx):  # 6.5 s loop: outline draws, tick sweeps 2.1–3.5 s, text lands 3.5–4.6 s
    mx.add(0.0, pad([A - 12, C, E, G, B], 7.0), gain=0.4, pan=-0.1)
    mx.add(0.0, pad([C + 12, E + 12, G + 12], 7.0, detune=0.006), gain=0.12, pan=0.35)
    for i in range(13):
        mx.add(i * 0.5, tick(accent=(i % 4 == 0)), gain=0.25, pan=(0.25 if i % 2 else -0.25))
    for k, t0 in enumerate(np.arange(0.4, 2.1, 0.25)):
        mx.add(t0, pluck([C + 12, E + 12, G + 12, B + 12][k % 4], bright=0.6), gain=0.22, pan=0.3 * math.sin(k))
    mx.add(2.0, thump(0.3), gain=0.5)
    mx.add(2.1, whoosh(1.4, up=True), gain=0.6)
    mx.add(3.5, thump(), gain=0.7); mx.add(3.5, chime(A + 12, 1.8), gain=0.5); mx.add(3.5, chime(E + 24, 1.5), gain=0.3, pan=0.3)
    for t0 in (3.6, 3.8, 4.0):
        mx.add(t0, blip(1320, 0.07), gain=0.3, pan=0.2)

if __name__ == "__main__":
    which, out = sys.argv[1], sys.argv[2]
    if which == "explainer":
        mx = Mix(55.5); explainer(mx); mx.write(out, fade_out=2.0)
    else:
        mx = Mix(6.5); banner(mx); mx.write(out, fade_out=0.8)
    print("wrote", out)
