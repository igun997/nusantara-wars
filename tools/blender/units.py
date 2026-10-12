import math
from lib import *

PI = math.pi


def M():
    return dict(
        skin=get_mat("skin", tex="skin", rough=0.8, tile=0.6),
        parang=get_mat("batik_parang", tex="batik_parang", rough=0.9, tile=0.45),
        kawung=get_mat("batik_kawung", tex="batik_kawung", rough=0.9, tile=0.4),
        mega=get_mat("batik_mega", tex="batik_megamendung", rough=0.9, tile=0.35),
        red=get_mat("cloth_red", tex="cloth_red", rough=0.9, tile=0.5),
        white=get_mat("cloth_white", tex="cloth_white", rough=0.9, tile=0.5),
        green=get_mat("cloth_green", tex="cloth_green", rough=0.9, tile=0.5),
        blue=get_mat("cloth_blue", tex="cloth_blue", rough=0.9, tile=0.5),
        black=get_mat("cloth_black", tex="cloth_black", rough=0.95, tile=0.5),
        wood=get_mat("wood", tex="wood", rough=0.8, tile=0.6),
        bamboo=get_mat("bamboo", tex="bamboo", rough=0.7, tile=0.6),
        thatch=get_mat("thatch", tex="thatch", rough=0.95, tile=0.5),
        metal=get_mat("metal", tex="metal", rough=0.35, metal=0.8, tile=0.6),
        gold=get_mat("gold", color="#d9a92a", rough=0.3, metal=0.9),
        steel=get_mat("steel", color="#b9c0c8", rough=0.25, metal=0.95),
        paint_red=get_mat("paint_red", color="#c93a2e", rough=0.5, metal=0.2),
        paint_blue=get_mat("paint_blue", color="#2f9fd6", rough=0.5, metal=0.3),
        paint_yellow=get_mat("paint_yellow", color="#f2c230", rough=0.5, metal=0.2),
        rubber=get_mat("rubber", color="#1b1b1b", rough=0.95),
        glass=get_mat("glass", color="#1f2c3a", rough=0.15, metal=0.3),
        hair=get_mat("hair", color="#15110f", rough=0.9),
    )


def legs(B, mat, w=0.2, h=0.46, gap=0.1, r=0.09):
    for sx in (-1, 1):
        B.cyl(mat, (sx * gap, 0, 0), r, r * 0.85, h, seg=6)


def torso(B, mat, z=0.45, w=0.42, d=0.24, h=0.42):
    B.cube(mat, (0, 0, z), (w, d, h))


def arms(B, skin, sleeve=None, z=0.82, spread=0.27, h=0.36, fwd=(0, 0)):
    for i, sx in enumerate((-1, 1)):
        B.cyl(sleeve or skin, (sx * spread, fwd[i], z - h), 0.06, 0.055, h, seg=6)


def head(B, skin, hair, z=0.9, r=0.19):
    B.sphere(skin, (0, 0, z + r), (r * 2, r * 2.1, r * 2.1), seg=10)
    B.sphere(hair, (0, 0.03, z + r * 1.25), (r * 2.05, r * 1.9, r * 1.6), seg=8)


def build_unit(name, fn):
    clear_all_objects_of(name)
    m = M()
    B = Builder(name)
    fn(B, m)
    ob = B.build()
    return ob


def clear_all_objects_of(name):
    ob = bpy.data.objects.get(name)
    if ob:
        bpy.data.objects.remove(ob, do_unlink=True)


# ------------------------------------------------------------------ workers
def warga_jawa(B, m):
    legs(B, m["parang"], r=0.1)
    B.cyl(m["parang"], (0, 0, 0.1), 0.2, 0.16, 0.38, seg=8)           # sarong
    torso(B, m["blue"])
    arms(B, m["skin"], m["blue"])
    head(B, m["skin"], m["hair"])
    B.pyramid(m["bamboo"], (0, 0, 1.12), 0.46, 0.04, 0.2, sides=12)      # caping
    # cangkul (hoe) over the shoulder
    B.cyl(m["wood"], (0.3, -0.06, 0.12), 0.025, 0.025, 0.85, seg=5, rot=(0.2, 0, 0))
    B.cube(m["steel"], (0.3, -0.2, 0.9), (0.14, 0.02, 0.1), rot=(0.2, 0, 0))


def warga_sunda(B, m):
    legs(B, m["black"], r=0.085)
    torso(B, m["white"])
    B.cube(m["green"], (0, -0.001, 0.52), (0.44, 0.25, 0.1))              # sash
    arms(B, m["skin"], m["white"])
    head(B, m["skin"], m["hair"])
    B.cyl(m["mega"], (0, 0, 1.07), 0.2, 0.2, 0.09, seg=10)                # iket
    # pikulan: bamboo pole across shoulders + two baskets
    B.cyl(m["bamboo"], (0, 0.0, 0.86), 0.025, 0.025, 1.2, seg=5, rot=(0, PI / 2, 0))
    for sx in (-0.55, 0.55):
        B.cyl(m["thatch"], (sx, 0, 0.5), 0.14, 0.1, 0.22, seg=8)
        B.cyl(m["bamboo"], (sx, 0, 0.7), 0.012, 0.012, 0.2, seg=4)


# ------------------------------------------------------------------ melee
def prajurit_jawa(B, m):
    legs(B, m["parang"], r=0.1)
    B.cyl(m["parang"], (0, 0, 0.1), 0.2, 0.17, 0.4, seg=8)
    torso(B, m["skin"])
    B.cube(m["red"], (0, 0, 0.62), (0.44, 0.26, 0.09))                    # sash
    arms(B, m["skin"], None)
    head(B, m["skin"], m["hair"])
    B.sphere(m["kawung"], (0, 0.0, 1.14), (0.4, 0.4, 0.2), seg=10)          # blangkon
    B.sphere(m["kawung"], (0, 0.18, 1.04), (0.12, 0.1, 0.12), seg=6)
    # keris
    B.cube(m["wood"], (0.22, -0.14, 0.48), (0.04, 0.04, 0.1), rot=(0.4, 0, 0))
    B.cube(m["steel"], (0.22, -0.2, 0.37), (0.035, 0.03, 0.22), rot=(0.4, 0, 0))
    # shield
    B.cyl(m["metal"], (-0.33, -0.12, 0.52), 0.24, 0.24, 0.05, seg=12, rot=(PI / 2, 0, 0), center=True)
    B.cyl(m["gold"], (-0.33, -0.15, 0.52), 0.07, 0.04, 0.05, seg=8, rot=(PI / 2, 0, 0), center=True)
    # tombak
    B.cyl(m["wood"], (0.36, 0, 0), 0.022, 0.022, 1.45, seg=5)
    B.pyramid(m["steel"], (0.36, 0, 1.4), 0.05, 0.0, 0.18, sides=4)
    B.cube(m["red"], (0.36, 0, 1.3), (0.07, 0.07, 0.07))


def prajurit_sunda(B, m):
    legs(B, m["black"], r=0.09)
    torso(B, m["black"])
    B.cube(m["green"], (0, -0.001, 0.6), (0.44, 0.25, 0.1))                # sash
    B.cube(m["mega"], (0, -0.13, 0.5), (0.3, 0.02, 0.26))                  # chest cloth
    arms(B, m["skin"], m["black"])
    head(B, m["skin"], m["hair"])
    B.cyl(m["mega"], (0, 0, 1.06), 0.2, 0.2, 0.09, seg=10)
    B.cube(m["mega"], (0.12, 0.1, 1.15), (0.1, 0.06, 0.1), rot=(0, 0, 0.5))
    # kujang: curved blade held forward
    B.cube(m["wood"], (0.34, -0.2, 0.55), (0.05, 0.05, 0.14))
    B.arc(m["steel"], (0.34, -0.2, 0.62), 0.22, -0.25, 1.4, 0.04, seg=7, plane="YZ", width=0.035)
    B.sphere(m["steel"], (0.34, -0.36, 0.72), (0.06, 0.08, 0.06), seg=6)
    # bamboo shield
    B.cube(m["bamboo"], (-0.33, -0.12, 0.34), (0.05, 0.3, 0.46), rot=(0, 0, 0.1))


# ------------------------------------------------------------------ ranged
def pemanah_jawa(B, m):
    legs(B, m["parang"], r=0.09)
    B.cyl(m["parang"], (0, 0, 0.1), 0.19, 0.16, 0.38, seg=8)
    torso(B, m["green"])
    arms(B, m["skin"], m["green"])
    head(B, m["skin"], m["hair"])
    B.sphere(m["kawung"], (0, 0, 1.14), (0.4, 0.4, 0.2), seg=10)
    # bow
    B.arc(m["wood"], (-0.32, -0.25, 0.7), 0.42, -1.1, 1.1, 0.04, seg=8, plane="XZ", width=0.04)
    B.cube(m["white"], (-0.32 - 0.0, -0.25, 0.7), (0.012, 0.012, 0.8), center=True)
    # quiver
    B.cyl(m["wood"], (0.05, 0.17, 0.5), 0.07, 0.06, 0.45, seg=6, rot=(0.2, 0, 0.2))
    for dx in (-0.03, 0.0, 0.03):
        B.cube(m["red"], (0.1 + dx, 0.2, 1.0), (0.015, 0.015, 0.1), rot=(0.2, 0, 0.2))


def pemanah_sunda(B, m):
    legs(B, m["black"], r=0.085)
    torso(B, m["green"])
    B.cube(m["thatch"], (0, 0, 0.38), (0.46, 0.27, 0.12))                  # leaf skirt
    arms(B, m["skin"], None)
    head(B, m["skin"], m["hair"])
    B.cyl(m["mega"], (0, 0, 1.07), 0.2, 0.2, 0.09, seg=10)
    # sumpit (blowpipe) held to the mouth
    B.cyl(m["bamboo"], (0, -0.5, 0.98), 0.025, 0.025, 1.0, seg=6, rot=(PI / 2, 0, 0), center=True)
    B.cyl(m["bamboo"], (0, -0.2, 0.98), 0.03, 0.03, 0.08, seg=6, rot=(PI / 2, 0, 0), center=True)
    # dart quiver (bamboo tube)
    B.cyl(m["bamboo"], (-0.05, 0.16, 0.4), 0.05, 0.05, 0.4, seg=6, rot=(-0.2, 0, 0))


# ------------------------------------------------------------------ vehicles
def wheel(B, m, x, y, r, w=0.07, z=None):
    B.cyl(m["rubber"], (x, y, z if z is not None else r), r, r, w, seg=14, rot=(0, PI / 2, 0), center=True)
    B.cyl(m["steel"], (x, y, z if z is not None else r), r * 0.45, r * 0.45, w + 0.01, seg=8, rot=(0, PI / 2, 0), center=True)


def siege_jawa(B, m):
    """Becak Meriam: a becak (rickshaw) carrying a cannon."""
    # front wheels / seat carriage (passenger up front, driver behind)
    wheel(B, m, -0.42, -0.3, 0.26)
    wheel(B, m, 0.42, -0.3, 0.26)
    B.cube(m["red"], (0, -0.3, 0.3), (0.7, 0.9, 0.12))                       # chassis
    B.cube(m["paint_red"], (0, -0.38, 0.42), (0.62, 0.55, 0.28))              # seat body
    B.cube(m["gold"], (0, -0.38, 0.7), (0.66, 0.6, 0.04))
    # cannon on the seat
    B.cyl(m["steel"], (0, -0.72, 0.9), 0.12, 0.09, 1.0, seg=10, rot=(PI / 2 + 0.12, 0, 0), center=True)
    B.cyl(m["metal"], (0, -0.2, 0.84), 0.15, 0.15, 0.16, seg=10, rot=(PI / 2 + 0.12, 0, 0), center=True)
    B.cyl(m["gold"], (0, -1.18, 0.98), 0.1, 0.1, 0.05, seg=10, rot=(PI / 2 + 0.12, 0, 0), center=True)
    # rear wheel + driver with caping
    wheel(B, m, 0, 0.55, 0.3)
    B.cyl(m["steel"], (0, 0.3, 0.45), 0.02, 0.02, 0.75, seg=5, rot=(PI / 2, 0, 0), center=True)
    B.cube(m["black"], (0, 0.5, 0.52), (0.2, 0.16, 0.3))
    B.sphere(m["skin"], (0, 0.5, 0.95), (0.2, 0.2, 0.2), seg=8)
    B.pyramid(m["bamboo"], (0, 0.5, 1.02), 0.3, 0.03, 0.14, sides=10)


def siege_sunda(B, m):
    """Angkot Tempur: an armoured minibus with a roof cannon."""
    for x in (-0.4, 0.4):
        wheel(B, m, x, -0.55, 0.22)
        wheel(B, m, x, 0.5, 0.22)
    B.cube(m["paint_blue"], (0, -0.02, 0.2), (0.78, 1.6, 0.42))                # lower body
    B.cube(m["paint_blue"], (0, 0.12, 0.62), (0.76, 1.15, 0.45))               # cabin
    B.cube(m["glass"], (0, 0.12, 0.7), (0.78, 1.0, 0.2))                       # windows
    B.cube(m["paint_yellow"], (0, 0.12, 0.32), (0.8, 1.45, 0.06))              # stripe
    B.cube(m["metal"], (0, -0.62, 0.34), (0.62, 0.22, 0.28))                   # armour grille
    B.cube(m["steel"], (0, 0.12, 1.1), (0.7, 1.1, 0.06))                       # roof plate
    for sx in (-0.38, 0.38):
        B.cube(m["steel"], (sx, 0.12, 0.2), (0.04, 1.2, 0.3))                  # side armour
    B.cyl(m["steel"], (0, -0.35, 1.28), 0.11, 0.08, 0.85, seg=10, rot=(PI / 2 + 0.1, 0, 0), center=True)
    B.cyl(m["metal"], (0, 0.1, 1.2), 0.2, 0.2, 0.2, seg=10)
    B.cube(m["paint_red"], (0, -0.4, 1.12), (0.3, 0.12, 0.05))                 # destination sign
    for sx in (-0.2, 0.2):
        B.sphere(m["paint_yellow"], (sx, -0.82, 0.3), (0.12, 0.05, 0.12), seg=6)  # headlamps


# ------------------------------------------------------------------ heroes (Punakawan)
def hero_jawa(B, m):
    """Semar: round, wise, a little too confident."""
    B.cyl(m["kawung"], (0, 0, 0), 0.4, 0.3, 0.6, seg=12)                        # sarong skirt
    B.sphere(m["black"], (0, 0, 0.75), (0.8, 0.62, 0.7), seg=12)                # big belly
    B.sphere(m["skin"], (0, -0.02, 1.18), (0.4, 0.38, 0.4), seg=10)             # head
    B.sphere(m["hair"], (0, 0.04, 1.28), (0.42, 0.34, 0.3), seg=8)
    B.sphere(m["white"], (0, 0.16, 1.25), (0.12, 0.12, 0.2), seg=6)             # kuncung (topknot)
    B.pyramid(m["white"], (0, -0.08, 1.45), 0.07, 0.0, 0.2, sides=6, rot=(-0.4, 0, 0))
    B.sphere(m["skin"], (0, -0.2, 1.17), (0.1, 0.1, 0.1), seg=6)                # nose
    for sx in (-1, 1):
        B.cyl(m["skin"], (sx * 0.38, -0.1, 0.5), 0.07, 0.06, 0.4, seg=6, rot=(0.3, 0, sx * 0.3))
    B.cyl(m["wood"], (0.45, -0.25, 0.0), 0.03, 0.03, 1.4, seg=5)                # staff
    B.sphere(m["gold"], (0.45, -0.25, 1.45), (0.12, 0.12, 0.12), seg=8)
    B.cube(m["gold"], (0, -0.31, 0.55), (0.12, 0.04, 0.16))                     # belt buckle


def hero_sunda(B, m):
    """Cepot: red face, giant nose, always joking."""
    legs(B, m["black"], r=0.11, h=0.5, gap=0.14)
    B.sphere(m["white"], (0, 0, 0.7), (0.72, 0.56, 0.62), seg=12)                # round body
    B.cube(m["mega"], (0, -0.2, 0.62), (0.5, 0.05, 0.2))
    B.sphere(m["paint_red"], (0, -0.02, 1.12), (0.4, 0.38, 0.4), seg=10)         # red face
    B.sphere(m["paint_red"], (0, -0.24, 1.08), (0.2, 0.22, 0.2), seg=8)          # huge nose
    B.sphere(m["white"], (-0.1, -0.2, 1.2), (0.1, 0.06, 0.1), seg=6)             # eyes
    B.sphere(m["white"], (0.1, -0.2, 1.2), (0.1, 0.06, 0.1), seg=6)
    B.cyl(m["mega"], (0, 0, 1.28), 0.22, 0.22, 0.1, seg=10)                       # iket
    B.sphere(m["hair"], (0, 0.04, 1.22), (0.42, 0.3, 0.28), seg=8)
    for sx in (-1, 1):
        B.cyl(m["paint_red"], (sx * 0.38, -0.1, 0.52), 0.07, 0.06, 0.4, seg=6, rot=(0.3, 0, sx * 0.3))
    B.cyl(m["bamboo"], (0.45, -0.2, 0.0), 0.03, 0.03, 1.2, seg=5)
    B.sphere(m["gold"], (0.45, -0.2, 1.25), (0.14, 0.04, 0.14), seg=6)           # tiny golek puppet


UNITS = dict(
    warga_jawa=warga_jawa, warga_sunda=warga_sunda,
    prajurit_jawa=prajurit_jawa, prajurit_sunda=prajurit_sunda,
    pemanah_jawa=pemanah_jawa, pemanah_sunda=pemanah_sunda,
    siege_jawa=siege_jawa, siege_sunda=siege_sunda,
    hero_jawa=hero_jawa, hero_sunda=hero_sunda,
)


def build_all(grid_cols=5, spacing=2.4, do_export=True, base=(0, -20)):
    out = {}
    for i, (name, fn) in enumerate(UNITS.items()):
        ob = build_unit(name, fn)
        ob.location = (base[0] + (i % grid_cols) * spacing, base[1] - (i // grid_cols) * spacing, 0)
        out[name] = ob
        if do_export:
            export_glb(ob, name)
    return out
