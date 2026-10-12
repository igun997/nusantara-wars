import math
from lib import *
from units import M as unit_mats, clear_all_objects_of

PI = math.pi


def BM():
    m = unit_mats()
    m.update(
        stone=get_mat("stone", tex="stone", rough=0.9, tile=1.2),
        stone_dark=get_mat("stone_dark", tex="stone", tint="#8a8a8a", rough=0.9, tile=1.2),
        tile=get_mat("roof_tile", tex="roof_tile", rough=0.7, tile=1.4),
        wood_dark=get_mat("wood_dark", tex="wood", tint="#9a7a5a", rough=0.8, tile=1.0),
        concrete=get_mat("concrete", tex="concrete", rough=0.9, tile=1.6),
        bamboo_big=get_mat("bamboo_big", tex="bamboo", rough=0.7, tile=1.0),
        thatch_big=get_mat("thatch_big", tex="thatch", rough=0.95, tile=1.1),
        dirt=get_mat("dirt_b", tex="dirt", rough=1.0, tile=1.5),
        hazard=get_mat("hazard", color="#f0c000", rough=0.6),
        dark=get_mat("dark", color="#14161a", rough=0.8),
        core_green=get_mat("core_green", color="#3cff6a", emit="#3cff6a", emit_strength=4.0, rough=0.2),
        core_cyan=get_mat("core_cyan", color="#4ad8ff", emit="#4ad8ff", emit_strength=4.0, rough=0.2),
        banner_parang=get_mat("banner_parang", tex="batik_parang", rough=0.9, tile=0.9),
        banner_mega=get_mat("banner_mega", tex="batik_megamendung", rough=0.9, tile=0.9),
        banner_kawung=get_mat("banner_kawung", tex="batik_kawung", rough=0.9, tile=0.9),
    )
    return m


def build(name, fn, at):
    clear_all_objects_of(name)
    B = Builder(name)
    fn(B, BM())
    ob = B.build()
    ob.location = at
    return ob


def banner(B, m, x, y, mat, h=2.2, w=0.5):
    B.cyl(m["wood"], (x, y, 0), 0.04, 0.04, h, seg=6)
    B.cube(mat, (x + w / 2 + 0.03, y, h - 0.7), (w, 0.03, 0.62))
    B.sphere(m["gold"], (x, y, h + 0.02), (0.1, 0.1, 0.1), seg=6)


# =============================================================== Town centres (4x4)
def tc_jawa(B, m):
    """Keraton joglo: stone platform, soko guru pillars, tumpang sari tiered roof."""
    B.cube(m["stone"], (0, 0, 0), (3.9, 3.9, 0.3))
    B.cube(m["stone_dark"], (0, 0, 0.3), (3.6, 3.6, 0.1))
    B.cube(m["stone"], (0, -2.1, 0), (1.3, 0.5, 0.18))                       # entrance steps
    B.cube(m["stone"], (0, -1.95, 0.1), (1.1, 0.4, 0.15))
    for sx in (-0.7, 0.7):
        for sy in (-0.7, 0.7):
            B.cyl(m["wood_dark"], (sx, sy, 0.4), 0.13, 0.12, 1.65, seg=8)       # soko guru
    for px in (-1.5, -0.5, 0.5, 1.5):
        for py in (-1.5, 1.5):
            B.cyl(m["wood"], (px, py, 0.4), 0.08, 0.08, 1.15, seg=6)
    for py in (-0.5, 0.5):
        for px in (-1.5, 1.5):
            B.cyl(m["wood"], (px, py, 0.4), 0.08, 0.08, 1.15, seg=6)
    B.cube(m["wood"], (0, 0.85, 0.4), (1.9, 0.1, 1.25))                      # back wall
    B.cube(m["wood_dark"], (0, 0, 0.4), (1.9, 1.9, 1.0))                     # inner room
    B.cube(m["dark"], (0, -0.96, 0.4), (0.7, 0.04, 0.85))                    # door
    # tumpang sari roof
    B.pyramid(m["tile"], (0, 0, 1.55), 2.9, 2.0, 0.5, sides=4)
    B.pyramid(m["tile"], (0, 0, 2.02), 1.95, 1.2, 0.5, sides=4)
    B.pyramid(m["tile"], (0, 0, 2.5), 1.25, 0.55, 0.5, sides=4)
    B.pyramid(m["tile"], (0, 0, 2.98), 0.62, 0.0, 0.7, sides=4)
    B.cyl(m["gold"], (0, 0, 3.64), 0.05, 0.02, 0.5, seg=6)
    B.sphere(m["gold"], (0, 0, 3.92), (0.14, 0.14, 0.14), seg=8)
    for sy in (-1.7, 1.7):
        banner(B, m, -1.75, sy, m["banner_parang"], 2.0)
    banner(B, m, 1.75, -1.75, m["banner_kawung"], 2.0)


def tc_sunda(B, m):
    """Imah panggung: stilt house with a julang ngapak (wing) ijuk roof."""
    B.cyl(m["dirt"], (0, 0, 0), 2.2, 2.2, 0.08, seg=16)
    for sx in (-1.5, -0.5, 0.5, 1.5):
        for sy in (-1.5, -0.5, 0.5, 1.5):
            B.cyl(m["bamboo_big"], (sx, sy, 0.05), 0.09, 0.08, 0.85, seg=6)     # stilts
    B.cube(m["wood"], (0, 0, 0.9), (3.6, 3.6, 0.16))                          # floor
    B.cube(m["wood_dark"], (0, 0, 0.9), (3.8, 0.12, 0.2))
    B.cube(m["bamboo_big"], (0, 0, 1.06), (2.8, 2.6, 1.05))                  # woven walls
    B.cube(m["dark"], (0, -1.31, 1.06), (0.75, 0.04, 0.85))                  # door
    for sx in (-0.9, 0.9):
        B.cube(m["dark"], (sx, -1.31, 1.35), (0.4, 0.04, 0.4))               # windows
    # sloped ladder
    B.cube(m["wood_dark"], (0, -2.35, 0.1), (0.9, 1.4, 0.07), rot=(0.52, 0, 0))
    # julang ngapak roof: steep gable with flared wings at the gable ends
    B.wedge(m["thatch_big"], (0, 0, 2.05), (4.2, 3.4, 1.55), ridge_inset=0.35)
    for sx in (-1, 1):
        B.cube(m["thatch_big"], (sx * 2.18, 0, 2.7), (0.1, 0.9, 1.1), rot=(0, sx * -0.6, 0))
        B.cube(m["wood_dark"], (sx * 2.28, 0, 3.15), (0.1, 0.12, 0.7), rot=(0, sx * -0.35, 0))
    B.cube(m["wood_dark"], (0, 0, 3.58), (4.0, 0.12, 0.08))                  # ridge board
    # kujang crossed above the entrance
    B.arc(m["steel"], (0, -1.62, 2.1), 0.28, -0.3, 1.3, 0.05, seg=6, plane="YZ", width=0.04)
    banner(B, m, -1.9, -1.75, m["banner_mega"], 2.6)
    banner(B, m, 1.9, -1.75, m["banner_mega"], 2.6)


# =============================================================== Houses (2x2)
def house_jawa(B, m):
    B.cube(m["stone"], (0, 0, 0), (1.9, 1.9, 0.16))
    B.cube(m["wood_dark"], (0, 0, 0.16), (1.35, 1.35, 0.75))
    B.cube(m["dark"], (0, -0.69, 0.16), (0.4, 0.03, 0.6))
    for sx in (-0.7, 0.7):
        for sy in (-0.7, 0.7):
            B.cyl(m["wood"], (sx, sy, 0.16), 0.06, 0.06, 0.8, seg=6)
    B.pyramid(m["tile"], (0, 0, 0.9), 1.45, 0.35, 0.55, sides=4)
    B.pyramid(m["tile"], (0, 0, 1.43), 0.5, 0.0, 0.4, sides=4)
    B.sphere(m["gold"], (0, 0, 1.85), (0.1, 0.1, 0.1), seg=6)


def house_sunda(B, m):
    for sx in (-0.7, 0.7):
        for sy in (-0.7, 0.7):
            B.cyl(m["bamboo_big"], (sx, sy, 0), 0.07, 0.06, 0.55, seg=6)
    B.cube(m["wood"], (0, 0, 0.55), (1.8, 1.8, 0.1))
    B.cube(m["bamboo_big"], (0, 0, 0.65), (1.4, 1.3, 0.7))
    B.cube(m["dark"], (0, -0.66, 0.65), (0.4, 0.03, 0.55))
    B.wedge(m["thatch_big"], (0, 0, 1.3), (2.1, 1.8, 0.85), ridge_inset=0.2)
    for sx in (-1, 1):
        B.cube(m["thatch_big"], (sx * 1.08, 0, 1.65), (0.07, 0.5, 0.6), rot=(0, sx * -0.6, 0))
    B.cube(m["wood"], (0, -1.15, 0), (0.5, 0.8, 0.05), rot=(0.55, 0, 0))


# =============================================================== Barracks (3x3)
def barracks_jawa(B, m):
    """Pendopo: open pavilion with a big roof, weapon rack, gamelan drum."""
    B.cube(m["stone"], (0, 0, 0), (2.9, 2.9, 0.25))
    B.cube(m["stone_dark"], (0, 0, 0.25), (2.6, 2.6, 0.06))
    for sx in (-1.1, 1.1):
        for sy in (-1.1, 1.1):
            B.cyl(m["wood_dark"], (sx, sy, 0.3), 0.11, 0.1, 1.3, seg=8)
    for sx in (-1.1, 0, 1.1):
        B.cyl(m["wood"], (sx, 1.1, 0.3), 0.07, 0.07, 1.1, seg=6)
    B.cube(m["wood"], (0, 1.12, 0.3), (2.2, 0.06, 1.0))
    B.pyramid(m["tile"], (0, 0, 1.55), 2.25, 1.0, 0.7, sides=4)
    B.pyramid(m["tile"], (0, 0, 2.2), 1.05, 0.0, 0.55, sides=4)
    B.sphere(m["gold"], (0, 0, 2.78), (0.12, 0.12, 0.12), seg=6)
    # weapon rack (spears + shields)
    B.cube(m["wood"], (0.8, 1.0, 0.3), (1.2, 0.08, 0.1))
    for i in range(5):
        B.cyl(m["wood"], (0.3 + i * 0.25, 1.0, 0.3), 0.02, 0.02, 1.1, seg=4)
        B.pyramid(m["steel"], (0.3 + i * 0.25, 1.0, 1.4), 0.04, 0.0, 0.14, sides=4)
    B.cyl(m["metal"], (-0.6, 1.0, 0.9), 0.3, 0.3, 0.05, seg=12, rot=(PI / 2, 0, 0), center=True)
    # kendang (drum)
    B.cyl(m["wood_dark"], (-0.5, -0.5, 0.31), 0.2, 0.2, 0.55, seg=10, rot=(0, PI / 2, 0.3), center=False)
    banner(B, m, 1.35, -1.35, m["banner_parang"], 1.8)


def barracks_sunda(B, m):
    """Bale with bamboo palisade and kujang gate."""
    B.cyl(m["dirt"], (0, 0, 0), 1.9, 1.9, 0.07, seg=16)
    for a in range(16):
        ang = a / 16 * 2 * PI
        if abs(((ang + PI) % (2 * PI)) - PI) < 0.35 and False:
            continue
        # palisade, leave a gap at the front (angle ~ -90deg)
        if abs(((ang + PI / 2 + PI) % (2 * PI)) - PI) < 0.42:
            continue
        x, y = math.cos(ang) * 1.6, math.sin(ang) * 1.6
        B.cyl(m["bamboo_big"], (x, y, 0.05), 0.09, 0.05, 1.05 + 0.12 * ((a * 7) % 3), seg=6)
    for sx in (-0.5, 0.5):
        B.cyl(m["bamboo_big"], (sx, 0.0, 0.1), 0.1, 0.1, 0.5, seg=6)
    B.cube(m["wood"], (0, 0.15, 0.55), (1.8, 1.6, 0.12))                       # bale platform
    for sx in (-0.8, 0.8):
        for sy in (-0.55, 0.85):
            B.cyl(m["bamboo_big"], (sx, sy, 0.67), 0.06, 0.06, 1.05, seg=6)
    B.pyramid(m["thatch_big"], (0, 0.15, 1.7), 1.7, 0.2, 0.75, sides=4)
    # gate with crossed kujang
    for sx in (-0.55, 0.55):
        B.cyl(m["wood_dark"], (sx, -1.65, 0.05), 0.09, 0.09, 1.6, seg=6)
    B.cube(m["wood_dark"], (0, -1.65, 1.5), (1.4, 0.1, 0.12))
    B.arc(m["steel"], (-0.2, -1.66, 1.62), 0.28, -0.4, 1.2, 0.05, seg=6, plane="XZ", width=0.04)
    B.arc(m["steel"], (0.2, -1.66, 1.62), 0.28, PI - 1.2, PI + 0.4, 0.05, seg=6, plane="XZ", width=0.04)
    banner(B, m, 1.7, -1.4, m["banner_mega"], 2.0)


# =============================================================== Nuclear reactors (3x3)
def reactor_jawa(B, m):
    """Reaktor Gamelan: a gong-ringed cooling tower under a tiny joglo roof."""
    B.cube(m["stone"], (0, 0, 0), (3.0, 3.0, 0.3))
    B.cyl(m["concrete"], (0, 0, 0.3), 1.05, 0.75, 2.3, seg=14)                 # cooling tower
    B.cyl(m["hazard"], (0, 0, 0.3), 1.07, 1.06, 0.12, seg=14)
    B.cyl(m["core_green"], (0, 0, 2.55), 0.62, 0.62, 0.3, seg=12)              # glowing core
    B.cyl(m["dark"], (0, 0, 2.45), 0.72, 0.72, 0.1, seg=12)
    B.pyramid(m["tile"], (0, 0, 2.9), 0.95, 0.0, 0.7, sides=4)                  # joglo cap
    B.sphere(m["gold"], (0, 0, 3.65), (0.14, 0.14, 0.14), seg=6)
    for i in range(6):
        a = i / 6 * 2 * PI + 0.3
        x, y = math.cos(a) * 1.5, math.sin(a) * 1.5
        B.cyl(m["wood_dark"], (x, y, 0.3), 0.05, 0.05, 1.2, seg=5)               # gong stand
        B.cyl(m["gold"], (x, y, 1.1), 0.34, 0.34, 0.07, seg=14, rot=(PI / 2, 0, a + PI / 2), center=True)
        B.cyl(m["steel"], (x, y, 1.1), 0.08, 0.06, 0.1, seg=8, rot=(PI / 2, 0, a + PI / 2), center=True)
        # glowing cable to the tower
        B.cyl(m["core_green"], (x * 0.7, y * 0.7, 0.35), 0.03, 0.03, 0.9, seg=4, rot=(0, 0, 0))
    B.cube(m["hazard"], (0, -1.45, 0.3), (0.9, 0.05, 0.3))
    B.cube(m["dark"], (0, -1.44, 0.34), (0.6, 0.05, 0.12))
    banner(B, m, -1.3, -1.3, m["banner_parang"], 1.7)


def reactor_sunda(B, m):
    """Reaktor Angklung: bamboo angklung frames around a glowing core."""
    B.cyl(m["dirt"], (0, 0, 0), 1.75, 1.75, 0.1, seg=18)
    B.cyl(m["bamboo_big"], (0, 0, 0.1), 0.95, 0.7, 2.6, seg=12)                 # tower wrapped in bamboo
    B.cyl(m["hazard"], (0, 0, 0.1), 0.97, 0.96, 0.1, seg=12)
    B.cyl(m["core_cyan"], (0, 0, 2.7), 0.55, 0.55, 0.3, seg=12)
    B.cyl(m["dark"], (0, 0, 2.6), 0.68, 0.68, 0.1, seg=12)
    B.pyramid(m["thatch_big"], (0, 0, 3.0), 0.95, 0.0, 0.7, sides=8)
    # angklung frames: two posts + graded bamboo tubes
    for k in range(4):
        a = k / 4 * 2 * PI + PI / 4
        cx, cy = math.cos(a) * 1.45, math.sin(a) * 1.45
        B.cube(m["wood_dark"], (cx, cy, 0.1), (0.1, 0.1, 1.5))
        B.cube(m["wood_dark"], (cx, cy, 1.5), (0.1, 0.1, 0.1))
        B.cube(m["wood_dark"], (cx, cy, 0.4), (0.7, 0.07, 0.07), rot=(0, 0, a + PI / 2))
        for t in range(5):
            off = (t - 2) * 0.14
            ox, oy = -math.sin(a) * off, math.cos(a) * off
            B.cyl(m["bamboo"], (cx + ox, cy + oy, 0.45 - 0.0), 0.04, 0.04, 0.45 + 0.17 * (4 - abs(t - 2) * 2) * 0.35 + 0.1, seg=5)
        B.cyl(m["core_cyan"], (cx * 0.62, cy * 0.62, 0.15), 0.03, 0.03, 0.9, seg=4)
    B.cube(m["hazard"], (0, -1.38, 0.12), (0.9, 0.05, 0.3))
    banner(B, m, 1.4, -1.4, m["banner_mega"], 1.7)


BUILDINGS = dict(
    tc_jawa=tc_jawa, tc_sunda=tc_sunda, house_jawa=house_jawa, house_sunda=house_sunda,
    barracks_jawa=barracks_jawa, barracks_sunda=barracks_sunda,
    reactor_jawa=reactor_jawa, reactor_sunda=reactor_sunda,
)


def build_all(do_export=True, base=(0, -32)):
    out = {}
    x = base[0]
    for i, (name, fn) in enumerate(BUILDINGS.items()):
        ob = build(name, fn, (base[0] + (i % 4) * 6.0, base[1] - (i // 4) * 6.0, 0))
        out[name] = ob
        if do_export:
            export_glb(ob, name)
    return out
