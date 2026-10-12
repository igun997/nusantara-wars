"""Generate tileable 512px textures for Nusantara Wars (numpy + PIL)."""
import os
import numpy as np
from PIL import Image, ImageDraw

N = 512
OUT = os.path.join(os.path.dirname(__file__), "textures_src")          # all sources (also used by Blender)
PUB = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "textures")   # only what the game loads at runtime
os.makedirs(OUT, exist_ok=True); os.makedirs(PUB, exist_ok=True)


def fbm(beta=2.0, seed=0, size=N, aniso=(1.0, 1.0)):
    """Tileable noise via spectral synthesis, normalised to 0..1."""
    rng = np.random.default_rng(seed)
    w = rng.standard_normal((size, size))
    fx = np.fft.fftfreq(size)[None, :] * aniso[0]
    fy = np.fft.fftfreq(size)[:, None] * aniso[1]
    f = np.sqrt(fx ** 2 + fy ** 2)
    f[0, 0] = 1.0
    spec = np.fft.fft2(w) / (f ** (beta / 2))
    spec[0, 0] = 0
    n = np.real(np.fft.ifft2(spec))
    n -= n.min()
    return n / n.max()


def mix(c0, c1, t):
    c0, c1 = np.array(c0, float), np.array(c1, float)
    return c0[None, None, :] * (1 - t[..., None]) + c1[None, None, :] * t[..., None]


def save(name, arr):
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    Image.fromarray(arr).save(os.path.join(OUT, name + ".png"), optimize=True)
    print("wrote", name)


def shade(img, n, amt=0.25):
    return img * (1 - amt + amt * 2 * n[..., None])


# ---------------- terrain ----------------
def grass():
    base = fbm(2.6, 1)
    fine = fbm(1.2, 2)
    blades = fbm(0.8, 3, aniso=(0.25, 1.0))
    img = mix((62, 108, 40), (122, 170, 62), base)
    img = shade(img, fine, 0.30)
    img = shade(img, blades, 0.18)
    dry = fbm(3.0, 4)
    img = img * (1 - 0.25 * (dry[..., None] > 0.68)) + 0.25 * (dry[..., None] > 0.68) * np.array([150, 140, 60])
    save("grass", img)


def dirt():
    base = fbm(2.4, 5)
    peb = fbm(0.6, 6)
    img = mix((92, 66, 42), (150, 112, 74), base)
    img = shade(img, peb, 0.28)
    stones = (fbm(0.4, 7) > 0.93)[..., None]
    img = np.where(stones, img * 0.6 + 40, img)
    save("dirt", img)


def sand():
    base = fbm(2.8, 8)
    fine = fbm(0.7, 9)
    ripple = 0.5 + 0.5 * np.sin((np.arange(N)[None, :] * 0.09 + base * 9) * 1.0)
    img = mix((196, 176, 126), (230, 212, 160), base)
    img = shade(img, fine, 0.18)
    img = shade(img, ripple, 0.06)
    save("sand", img)


def rock():
    base = fbm(2.2, 10)
    ridge = 1 - np.abs(2 * fbm(2.0, 11) - 1)
    fine = fbm(1.0, 12)
    img = mix((84, 82, 80), (150, 146, 140), base)
    img = shade(img, ridge, 0.45)
    img = shade(img, fine, 0.2)
    cracks = (ridge > 0.93)[..., None]
    img = np.where(cracks, img * 0.45, img)
    save("rock", img)


def forest():
    base = fbm(2.4, 13)
    fine = fbm(0.9, 14)
    img = mix((30, 58, 26), (70, 92, 38), base)
    img = shade(img, fine, 0.35)
    leaf = (fbm(0.5, 15) > 0.90)[..., None]
    img = np.where(leaf, np.array([140, 100, 40]), img)
    save("forest", img)


def paddy():
    """Sawah (rice paddy): green rows with water glints."""
    base = fbm(2.6, 16)
    rows = 0.5 + 0.5 * np.sin(np.arange(N)[:, None] * (2 * np.pi * 16 / N) + base * 1.5)
    img = mix((96, 150, 50), (160, 200, 70), rows)
    img = shade(img, fbm(1.0, 17), 0.2)
    save("paddy", img)


# ---------------- building materials ----------------
def wood():
    g = fbm(1.8, 20, aniso=(0.12, 1.0))
    fine = fbm(1.0, 21, aniso=(0.2, 1.0))
    img = mix((92, 58, 32), (160, 106, 60), g)
    img = shade(img, fine, 0.25)
    planks = 8
    for i in range(planks):
        y = int(i * N / planks)
        img[y:y + 3, :, :] *= 0.45
    # per-plank tint
    for i in range(planks):
        y0, y1 = int(i * N / planks), int((i + 1) * N / planks)
        img[y0:y1] *= 0.88 + 0.24 * ((i * 37) % 7) / 7
    save("wood", img)


def thatch():
    """Ijuk / alang-alang roof strands."""
    s = fbm(0.9, 22, aniso=(1.0, 0.12))
    base = fbm(2.0, 23)
    img = mix((78, 60, 34), (170, 140, 80), s)
    img = shade(img, base, 0.25)
    for i in range(0, N, 32):
        img[i:i + 2] *= 0.6
    save("thatch", img)


def roof_tile():
    img = np.zeros((N, N, 3))
    rows, cols = 10, 12
    th, tw = N / rows, N / cols
    ys, xs = np.mgrid[0:N, 0:N]
    row = (ys // th).astype(int)
    off = (row % 2) * tw / 2
    u = ((xs + off) % tw) / tw
    v = (ys % th) / th
    curve = np.sqrt(np.clip(1 - (2 * u - 1) ** 2, 0, 1))
    n = fbm(2.0, 24)
    base = mix((150, 62, 38), (196, 98, 56), n)
    lit = 0.65 + 0.35 * curve * (0.6 + 0.4 * v)
    img = base * lit[..., None]
    edge = (v > 0.9) | (u < 0.04) | (u > 0.96)
    img = np.where(edge[..., None], img * 0.5, img)
    save("roof_tile", img)


def stone():
    ys, xs = np.mgrid[0:N, 0:N]
    rows, cols = 8, 6
    th, tw = N / rows, N / cols
    row = (ys // th).astype(int)
    off = (row % 2) * tw / 2
    u = ((xs + off) % tw) / tw
    v = (ys % th) / th
    n = fbm(2.2, 25)
    fine = fbm(0.9, 26)
    cell = ((xs + off) // tw).astype(int) + row * 17
    tint = 0.8 + 0.3 * (np.sin(cell * 12.9898) * 0.5 + 0.5)
    img = mix((110, 106, 98), (168, 160, 148), n) * tint[..., None]
    img = shade(img, fine, 0.25)
    mortar = (v < 0.05) | (u < 0.03)
    img = np.where(mortar[..., None], np.array([60, 58, 54]) * (0.8 + 0.4 * n[..., None]), img)
    mossy = (fbm(2.4, 27) > 0.72)[..., None] & (v[..., None] < 0.5)
    img = np.where(mossy, img * 0.7 + np.array([10, 36, 6]), img)
    save("stone", img)


def bamboo():
    g = fbm(1.4, 28, aniso=(0.1, 1.0))
    img = mix((128, 150, 60), (190, 190, 90), g)
    for x in range(0, N, 64):
        img[:, x:x + 3] *= 0.6
    for y in range(0, N, 128):
        img[y:y + 6, :] *= 0.55
    img = shade(img, fbm(1.0, 29), 0.18)
    save("bamboo", img)


def metal():
    n = fbm(1.6, 30)
    f = fbm(0.6, 31)
    img = mix((70, 78, 88), (140, 150, 160), n)
    img = shade(img, f, 0.2)
    for y in range(0, N, 128):
        img[y:y + 3] *= 0.55
    for x in range(0, N, 128):
        img[:, x:x + 3] *= 0.55
    save("metal", img)


def concrete():
    n = fbm(2.0, 32)
    f = fbm(0.7, 33)
    img = mix((120, 122, 124), (176, 178, 176), n)
    img = shade(img, f, 0.2)
    stains = fbm(3.0, 34) > 0.78
    img = np.where(stains[..., None], img * 0.78, img)
    save("concrete", img)


# ---------------- batik / cloth ----------------
def batik_parang(c_bg=(46, 30, 20), c_fg=(214, 176, 112)):
    ys, xs = np.mgrid[0:N, 0:N].astype(float)
    t = 2 * np.pi / N * 6
    band = np.sin((xs + ys) * t + 2.2 * np.sin((xs - ys) * t * 0.5))
    mask = (band > 0.25).astype(float)
    n = fbm(1.0, 40)
    img = mix(c_bg, c_fg, mask * (0.8 + 0.2 * n))
    dots = np.sin(xs * t * 2) * np.sin(ys * t * 2) > 0.8
    img = np.where(dots[..., None] & (mask[..., None] < 0.5), np.array(c_fg) * 0.85, img)
    img = shade(img, fbm(0.8, 41), 0.15)
    save("batik_parang", img)


def batik_kawung(c_bg=(30, 40, 78), c_fg=(224, 196, 120)):
    im = Image.new("RGB", (N, N), c_bg)
    d = ImageDraw.Draw(im)
    cell = N // 4
    for gy in range(-1, 5):
        for gx in range(-1, 5):
            cx, cy = gx * cell + cell // 2, gy * cell + cell // 2
            r = cell * 0.42
            for dx, dy in ((r * 0.5, 0), (-r * 0.5, 0), (0, r * 0.5), (0, -r * 0.5)):
                d.ellipse([cx + dx - r * 0.55, cy + dy - r * 0.55, cx + dx + r * 0.55, cy + dy + r * 0.55], outline=c_fg, width=5)
            d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=c_fg)
    arr = np.array(im, float)
    arr = shade(arr, fbm(0.8, 42), 0.18)
    save("batik_kawung", arr)


def batik_megamendung(c1=(140, 28, 30), c2=(236, 214, 170)):
    """Sunda/Cirebon-style cloud bands for iket and banners."""
    ys, xs = np.mgrid[0:N, 0:N].astype(float)
    t = 2 * np.pi / N
    f = np.sin(xs * t * 2 + np.sin(ys * t * 3) * 1.2) + np.cos(ys * t * 4)
    bands = 0.5 + 0.5 * np.sin(f * 4.0)
    img = mix(c1, c2, bands)
    img = shade(img, fbm(0.8, 43), 0.2)
    save("batik_megamendung", img)


def cloth(name, color, seed):
    n = fbm(0.7, seed)
    img = np.ones((N, N, 3)) * np.array(color, float)
    weave = 0.5 + 0.5 * np.sin(np.arange(N)[None, :] * 2 * np.pi / 4) * np.sin(np.arange(N)[:, None] * 2 * np.pi / 4)
    img = shade(img, n, 0.3)
    img = shade(img, weave, 0.12)
    save(name, img)


def skin():
    n = fbm(2.0, 50)
    img = mix((150, 98, 64), (196, 138, 94), n)
    save("skin", img)


if __name__ == "__main__":
    grass(); dirt(); sand(); rock(); forest(); paddy()
    wood(); thatch(); roof_tile(); stone(); bamboo(); metal(); concrete()
    batik_parang(); batik_kawung(); batik_megamendung()
    skin()
    cloth("cloth_red", (170, 40, 40), 60)
    cloth("cloth_white", (220, 214, 200), 61)
    cloth("cloth_green", (50, 120, 70), 62)
    cloth("cloth_blue", (40, 70, 150), 63)
    cloth("cloth_black", (34, 30, 30), 64)
    import shutil
    for n in ("grass", "dirt", "sand", "rock", "forest", "paddy"):
        shutil.copy2(os.path.join(OUT, n + ".png"), os.path.join(PUB, n + ".png"))
