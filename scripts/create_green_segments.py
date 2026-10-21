"""Hand-built eight-sided, disconnected green figure on the existing Mixamo rig.

Blender --background --python scripts/create_green_segments.py
All visible geometry is authored below; only the compatible skeleton is reused.
"""
from pathlib import Path
import math
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(ROOT / 'amsterdam-hackathon/Geo/Chicken Dance.fbx'), automatic_bone_orientation=False)
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
for obj in list(bpy.context.scene.objects):
    if obj != rig:
        bpy.data.objects.remove(obj, do_unlink=True)
rig.animation_data_clear()
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
for bone in rig.pose.bones:
    bone.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
bones = {b.name.rsplit(':', 1)[-1]: b for b in rig.data.bones}
def head(name):
    return rig.matrix_world @ bones[name].head_local

vertices, faces, weights = [], [], []
def segment(name, start, end, radius, depth=None, trim=.018, sides=8):
    """Capped bevel-ended prism, rigidly weighted to one bone. No smooth shading."""
    start, end = Vector(start), Vector(end)
    axis = (end - start).normalized()
    start += axis * trim
    end -= axis * trim
    length = (end - start).length
    rotation = Vector((0, 0, 1)).rotation_difference(axis)
    base = len(vertices)
    for distance, taper in [(0, .82), (.012, 1), (length - .012, 1), (length, .82)]:
        for i in range(sides):
            angle = 2 * math.pi * i / sides + math.pi / 8
            point = Vector((math.cos(angle) * radius * taper, math.sin(angle) * (depth or radius) * taper, distance))
            vertices.append(tuple(start + rotation @ point))
            weights.append(bones[name].name)
    faces.append(tuple(base + i for i in reversed(range(sides))))
    for ring in range(3):
        for i in range(sides):
            a = base + ring * sides + i
            b = base + ring * sides + (i + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.append(tuple(base + 3 * sides + i for i in range(sides)))

# A narrow floating torso and tall featureless head match the reference silhouette.
segment('Spine1', head('Spine') - Vector((0, 0, .045)), head('Neck'), .068, .058, trim=.012)
segment('Head', head('Head'), head('Head') + Vector((0, 0, .255)), .068, .060, trim=.005)
for side in ['Left', 'Right']:
    segment(side + 'Arm', head(side + 'Arm'), head(side + 'ForeArm'), .055)
    segment(side + 'ForeArm', head(side + 'ForeArm'), head(side + 'Hand'), .052)
    wrist = head(side + 'Hand')
    direction = (wrist - head(side + 'ForeArm')).normalized()
    segment(side + 'Hand', wrist, wrist + direction * .115, .052, .032, trim=.012, sides=6)
    segment(side + 'UpLeg', head(side + 'UpLeg'), head(side + 'Leg'), .067, trim=.025)
    segment(side + 'Leg', head(side + 'Leg'), head(side + 'Foot'), .060, trim=.025)
    ankle = head(side + 'Foot')
    # Chunky horizontal shoes, with a visible ankle gap.
    heel = Vector((ankle.x, ankle.y + .035, .045))
    toe = Vector((ankle.x, head(side + 'ToeBase').y - .075, .045))
    segment(side + 'Foot', heel, toe, .063, .043, trim=0)

mesh = bpy.data.meshes.new('GreenSegments_HandBuiltMesh')
mesh.from_pydata(vertices, [], faces)
mesh.update()
obj = bpy.data.objects.new('GreenSegments', mesh)
bpy.context.collection.objects.link(obj)
material = bpy.data.materials.new('Signal Green')
material.diffuse_color = (.035, .8, .085, 1)
material.use_nodes = True
shader = material.node_tree.nodes.get('Principled BSDF')
shader.inputs['Base Color'].default_value = material.diffuse_color
shader.inputs['Roughness'].default_value = .8
obj.data.materials.append(material)
for name in sorted(set(weights)):
    group = obj.vertex_groups.new(name=name)
    group.add([i for i, bone in enumerate(weights) if bone == name], 1, 'REPLACE')
modifier = obj.modifiers.new('Mixamo skin', 'ARMATURE')
modifier.object = rig
obj.parent = rig
obj.matrix_parent_inverse = rig.matrix_world.inverted()
rig.name = 'Armature'
output = ROOT / 'assets/characters/green-segments.fbx'
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.fbx(filepath=str(output), use_selection=True, object_types={'ARMATURE', 'MESH'},
    add_leaf_bones=False, bake_anim=False, use_armature_deform_only=False,
    axis_forward='-Z', axis_up='Y', path_mode='AUTO')
print(f'Created {output}: {len(vertices)} vertices, {len(faces)} faces, {len(rig.data.bones)} bones')
