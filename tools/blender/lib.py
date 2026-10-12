"""Low-poly model builder for Nusantara Wars (runs inside Blender).

Conventions: 1 unit = 1 grid cell. Models are built with the front facing -Y in
Blender (+Z after glTF export), origin at bottom centre.
"""
import bpy, bmesh, math, os
from mathutils import Matrix, Vector, Euler

TEX_DIR = "/home/nst/WebstormProjects/wars/tools/textures_src"
OUT_DIR = "/home/nst/WebstormProjects/wars/public/assets/models"

_mats = {}


def clear_all():
    for o in list(bpy.data.objects):
        if o.type in {"MESH", "EMPTY"}:
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)


def hex_lin(h):
    h = h.lstrip("#")
    return [(int(h[i:i + 2], 16) / 255.0) ** 2.2 for i in (0, 2, 4)] + [1.0]


def get_mat(name, tex=None, tint=None, color=None, rough=0.75, metal=0.0, emit=None, emit_strength=0.0, tile=1.5):
    """tile = world units per texture repeat (stored on the material for UV projection)."""
    key = (name, tex, tint, color, rough, metal, emit, emit_strength, tile)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if tex:
        img = bpy.data.images.load(os.path.join(TEX_DIR, tex + ".png"), check_existing=True)
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = img
        if tint:
            mx = nt.nodes.new("ShaderNodeMix")
            mx.data_type = "RGBA"
            mx.blend_type = "MULTIPLY"
            mx.inputs["Factor"].default_value = 1.0
            mx.inputs["B"].default_value = hex_lin(tint)
            nt.links.new(tn.outputs["Color"], mx.inputs["A"])
            nt.links.new(mx.outputs["Result"], bsdf.inputs["Base Color"])
        else:
            nt.links.new(tn.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = hex_lin(color or "#888888")
    if emit:
        bsdf.inputs["Emission Color"].default_value = hex_lin(emit)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    m["tile"] = tile
    _mats[key] = m
    return m


class Builder:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def _mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _tag(self, geom_verts, mat, smooth):
        mi = self._mi(mat)
        faces = {f for v in geom_verts for f in v.link_faces}
        for f in faces:
            f.material_index = mi
            f.smooth = smooth

    def _xf(self, verts, loc, rot, scale=(1, 1, 1)):
        m = Matrix.Translation(Vector(loc)) @ Euler(rot, "XYZ").to_matrix().to_4x4() @ Matrix.Diagonal(Vector((*scale, 1)))
        bmesh.ops.transform(self.bm, matrix=m, verts=verts)

    # ---- primitives (loc = bottom centre unless center=True) ----
    def cube(self, mat, loc, size, rot=(0, 0, 0), center=False, smooth=False):
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        vs = r["verts"]
        l = list(loc)
        if not center:
            l[2] += size[2] / 2
        self._xf(vs, l, rot, size)
        self._tag(vs, mat, smooth)

    def cyl(self, mat, loc, r1, r2, h, seg=8, rot=(0, 0, 0), center=False, smooth=True, spin=0.0):
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
        vs = r["verts"]
        l = list(loc)
        if not center:
            l[2] += h / 2
        self._xf(vs, l, (rot[0], rot[1], rot[2] + spin))
        self._tag(vs, mat, smooth)

    def pyramid(self, mat, loc, r1, r2, h, sides=4, rot=(0, 0, 0), scale_xy=(1, 1)):
        """Square/poly frustum roof; r2=0 gives a point."""
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r1, radius2=max(r2, 1e-4), depth=h)
        vs = r["verts"]
        l = list(loc)
        l[2] += h / 2
        self._xf(vs, l, (rot[0], rot[1], rot[2] + math.pi / sides), (scale_xy[0], scale_xy[1], 1))
        self._tag(vs, mat, False)

    def sphere(self, mat, loc, scale, seg=10, center=True, smooth=True):
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=max(4, seg // 2 + 1), radius=0.5)
        vs = r["verts"]
        l = list(loc)
        if not center:
            l[2] += scale[2] / 2
        self._xf(vs, l, (0, 0, 0), scale)
        self._tag(vs, mat, smooth)

    def wedge(self, mat, loc, size, ridge_inset=0.0, rot=(0, 0, 0)):
        """Gable roof: base sx*sy at loc(bottom centre), ridge along X, height sz."""
        sx, sy, sz = size
        hx, hy = sx / 2, sy / 2
        v = [
            self.bm.verts.new((-hx, -hy, 0)), self.bm.verts.new((hx, -hy, 0)),
            self.bm.verts.new((hx, hy, 0)), self.bm.verts.new((-hx, hy, 0)),
            self.bm.verts.new((-hx + ridge_inset, 0, sz)), self.bm.verts.new((hx - ridge_inset, 0, sz)),
        ]
        faces = [
            (v[0], v[1], v[5], v[4]), (v[2], v[3], v[4], v[5]),
            (v[0], v[4], v[3]), (v[1], v[2], v[5]), (v[3], v[2], v[1], v[0]),
        ]
        for f in faces:
            self.bm.faces.new(f)
        self._xf(v, loc, rot)
        self._tag(v, mat, False)

    def arc(self, mat, center, radius, a0, a1, thick, seg=8, plane="XZ", width=None):
        """Chain of small boxes along an arc: bows, blades, hoops."""
        width = width or thick
        for i in range(seg):
            t0 = a0 + (a1 - a0) * i / seg
            t1 = a0 + (a1 - a0) * (i + 1) / seg
            tm = (t0 + t1) / 2
            ln = abs(radius * (t1 - t0)) * 1.15
            cx, cy, cz = center
            if plane == "XZ":
                p = (cx + math.cos(tm) * radius, cy, cz + math.sin(tm) * radius)
                self.cube(mat, p, (thick, width, ln), rot=(0, -tm, 0), center=True)
            elif plane == "YZ":
                p = (cx, cy + math.cos(tm) * radius, cz + math.sin(tm) * radius)
                self.cube(mat, p, (width, thick, ln), rot=(tm, 0, 0), center=True)
            else:  # XY (horizontal ring)
                p = (cx + math.cos(tm) * radius, cy + math.sin(tm) * radius, cz)
                self.cube(mat, p, (ln, thick, width), rot=(0, 0, tm + math.pi / 2), center=True)

    # ---- finalise ----
    def build(self, at=(0, 0, 0), collection=None):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        uv = bm.loops.layers.uv.verify()
        for f in bm.faces:
            mat = self.mats[f.material_index]
            tile = float(mat.get("tile", 1.5))
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co
                if ax == 0:
                    u, v = c.y, c.z
                elif ax == 1:
                    u, v = c.x, c.z
                else:
                    u, v = c.x, c.y
                l[uv].uv = (u / tile, v / tile)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        ob.location = at
        return ob


def export_glb(ob, name):
    os.makedirs(OUT_DIR, exist_ok=True)
    loc = ob.location.copy()
    ob.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT_DIR, name + ".glb"),
        export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_animations=False, export_cameras=False, export_lights=False,
        export_image_format="JPEG", export_jpeg_quality=78, export_texcoords=True, export_normals=True,
    )
    ob.location = loc
