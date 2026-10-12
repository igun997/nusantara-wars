import math, random
from lib import *
from units import clear_all_objects_of
from buildings import BM

PI = math.pi


def build(name, fn, at):
    clear_all_objects_of(name)
    B = Builder(name)
    fn(B, BM() | NM())
    ob = B.build()
    ob.location = at
    return ob


def NM():
    return dict(
        leaf=get_mat("leaf", tex="forest", tint="#b8e07a", rough=0.9, tile=1.0),
        leaf2=get_mat("leaf2", tex="forest", tint="#9bd16a", rough=0.9, tile=1.0),
        leaf_dark=get_mat("leaf_dark", tex="forest", tint="#6aa050", rough=0.9, tile=1.0),
        bark=get_mat("bark", tex="wood", tint="#9a7e66", rough=0.95, tile=0.7),
        rock=get_mat("rock", tex="rock", rough=0.95, tile=1.2),
        gold_ore=get_mat("gold_ore", color="#ffc83a", emit="#ffb400", emit_strength=1.2, rough=0.3, metal=0.8),
        paddy=get_mat("paddy", tex="paddy", rough=0.8, tile=1.2),
        rice=get_mat("rice", color="#d4c24a", rough=0.8),
        water=get_mat("water_s", color="#4a8a9a", rough=0.15, metal=0.1),
        red_nuke=get_mat("red_nuke", color="#c83a2c", rough=0.4, metal=0.3),
        white_nuke=get_mat("white_nuke", color="#e6e6e0", rough=0.4, metal=0.4),
        flame=get_mat("flame", color="#ffa030", emit="#ff8000", emit_strength=6.0, rough=0.5),
        lava=get_mat("lava", color="#ff5a1c", emit="#ff4000", emit_strength=3.0, rough=0.5),
    )


def tree_jati(B, m):
    rnd = random.Random(3)
    B.cyl(m["bark"], (0, 0, 0), 0.16, 0.1, 1.5, seg=7)
    for i, (x, y, z, s) in enumerate([(0, 0, 1.5, 1.4), (0.3, 0.1, 1.2, 1.0), (-0.3, -0.1, 1.3, 1.0), (0.1, 0.3, 1.9, 0.9)]):
        B.sphere(m["leaf"] if i % 2 == 0 else m["leaf2"], (x, y, z), (s, s, s * 0.7), seg=7, center=True)


def tree_palm(B, m):
    # curved trunk
    x = y = 0.0
    for i in range(7):
        B.cyl(m["bark"], (x, y, i * 0.28), 0.1 - i * 0.008, 0.09 - i * 0.008, 0.3, seg=6, rot=(0.08, 0.1, 0))
        x += 0.02 * i * 0.2
    top = (0.06, 0, 1.95)
    for k in range(8):
        a = k / 8 * 2 * PI
        B.cube(m["leaf_dark"] if k % 2 else m["leaf"], (top[0] + math.cos(a) * 0.5, math.sin(a) * 0.5, top[2] - 0.12),
               (0.85, 0.2, 0.04), rot=(0, 0, a), center=True)
        B.cube(m["leaf"], (top[0] + math.cos(a) * 0.95, math.sin(a) * 0.95, top[2] - 0.38),
               (0.5, 0.17, 0.035), rot=(0, 0, a), center=True)
    B.sphere(m["bark"], (0.06, 0, 1.95), (0.18, 0.18, 0.18), seg=6)
    B.sphere(m["leaf_dark"], (0.1, 0.1, 1.82), (0.14, 0.14, 0.14), seg=6)


def tree_pine(B, m):
    B.cyl(m["bark"], (0, 0, 0), 0.14, 0.1, 0.8, seg=6)
    for i in range(5):
        B.cyl(m["leaf_dark"] if i % 2 else m["leaf2"], (0, 0, 0.5 + i * 0.42), 0.9 - i * 0.16, 0.05, 0.75, seg=8, smooth=False)


def bamboo_clump(B, m):
    rnd = random.Random(5)
    for i in range(10):
        a = rnd.random() * 2 * PI
        r = rnd.random() * 0.4
        x, y = math.cos(a) * r, math.sin(a) * r
        h = 1.6 + rnd.random() * 1.0
        tx, ty = rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12)
        B.cyl(m["bamboo"], (x, y, 0), 0.05, 0.035, h, seg=5, rot=(tx, ty, 0))
        for k in range(3):
            B.cube(m["leaf"], (x + tx * h * 0.9, y - ty * h * 0.9, h * 0.8 + k * 0.1), (0.4, 0.06, 0.02),
                   rot=(0, 0, rnd.random() * 2 * PI), center=True)


def rock_big(B, m):
    rnd = random.Random(8)
    for i, (x, y, s) in enumerate([(0, 0, 1.0), (0.5, 0.25, 0.65), (-0.45, 0.2, 0.55)]):
        B.sphere(m["rock"], (x, y, 0), (s * 1.2, s, s * 0.9), seg=6, center=False, smooth=False)


def rice_patch(B, m):
    """Sawah resource (2x2): terraced paddy with rice stalks."""
    B.cube(m["dirt"], (0, 0, 0), (2.0, 2.0, 0.12))
    B.cube(m["water"], (0, 0, 0.1), (1.78, 1.78, 0.04))
    rnd = random.Random(2)
    for ix in range(7):
        for iy in range(7):
            x = -0.78 + ix * 0.26 + rnd.uniform(-0.03, 0.03)
            y = -0.78 + iy * 0.26 + rnd.uniform(-0.03, 0.03)
            B.pyramid(m["rice"] if (ix + iy) % 3 else m["leaf2"], (x, y, 0.12), 0.08, 0.0, 0.34 + rnd.uniform(0, 0.12), sides=4)


def goldmine(B, m):
    B.sphere(m["rock"], (0, 0, 0), (1.5, 1.4, 1.1), seg=7, center=False, smooth=False)
    B.sphere(m["rock"], (0.6, 0.4, 0), (0.9, 0.8, 0.7), seg=6, center=False, smooth=False)
    rnd = random.Random(11)
    for i in range(9):
        a = rnd.random() * 2 * PI
        r = 0.4 + rnd.random() * 0.4
        B.sphere(m["gold_ore"], (math.cos(a) * r, math.sin(a) * r * 0.9, 0.4 + rnd.random() * 0.35),
                 (0.22, 0.2, 0.22), seg=5, smooth=False)
    # mine frame
    for sx in (-0.35, 0.35):
        B.cyl(m["wood"], (sx, -0.85, 0), 0.06, 0.06, 0.8, seg=5)
    B.cube(m["wood"], (0, -0.85, 0.78), (0.9, 0.1, 0.1))
    B.cube(m["dark"], (0, -0.7, 0.05), (0.55, 0.3, 0.7))


def rudal_atom(B, m):
    """Nuclear missile, standing upright, nose +Z."""
    B.cyl(m["white_nuke"], (0, 0, 0), 0.34, 0.34, 2.6, seg=14)
    B.cyl(m["red_nuke"], (0, 0, 1.25), 0.345, 0.345, 0.25, seg=14)
    B.cyl(m["hazard"], (0, 0, 0.95), 0.345, 0.345, 0.12, seg=14)
    B.cyl(m["red_nuke"], (0, 0, 2.6), 0.34, 0.0, 1.0, seg=14)
    for i in range(4):
        a = i * PI / 2
        B.cube(m["red_nuke"], (math.cos(a) * 0.5, math.sin(a) * 0.5, 0.0), (0.04 if i % 2 == 0 else 0.5, 0.5 if i % 2 == 0 else 0.04, 0.8), rot=(0, 0, 0), center=False)
    B.cyl(m["dark"], (0, 0, -0.1), 0.26, 0.3, 0.2, seg=10)
    B.cyl(m["flame"], (0, 0, -0.5), 0.2, 0.0, 0.5, seg=8)


def candi(B, m):
    """Stepped temple landmark (Borobudur-ish)."""
    for i in range(5):
        s = 3.4 - i * 0.6
        B.cube(m["stone"], (0, 0, i * 0.34), (s, s, 0.34))
        B.cube(m["stone_dark"], (0, 0, i * 0.34 + 0.34), (s - 0.1, s - 0.1, 0.03))
    for sx in (-1, 0, 1):
        for sy in (-1, 0, 1):
            if sx == 0 and sy == 0:
                continue
            B.cyl(m["stone"], (sx * 0.55, sy * 0.55, 1.7), 0.2, 0.17, 0.3, seg=8)
            B.sphere(m["stone"], (sx * 0.55, sy * 0.55, 2.1), (0.34, 0.34, 0.34), seg=8)
    B.cyl(m["stone"], (0, 0, 1.7), 0.32, 0.26, 0.5, seg=8)
    B.sphere(m["stone"], (0, 0, 2.5), (0.6, 0.6, 0.6), seg=10)
    B.pyramid(m["stone"], (0, 0, 2.78), 0.08, 0.0, 0.4, sides=6)


NATURE = dict(
    tree_jati=tree_jati, tree_palm=tree_palm, tree_pine=tree_pine, bamboo_clump=bamboo_clump,
    rock_big=rock_big, rice_patch=rice_patch, goldmine=goldmine, rudal_atom=rudal_atom, candi=candi,
)


def build_all(do_export=True, base=(0, -48)):
    out = {}
    for i, (name, fn) in enumerate(NATURE.items()):
        ob = build(name, fn, (base[0] + (i % 5) * 5.0, base[1] - (i // 5) * 5.0, 0))
        out[name] = ob
        if do_export:
            export_glb(ob, name)
    return out
