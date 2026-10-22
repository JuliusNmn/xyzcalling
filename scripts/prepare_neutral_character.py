"""Convert Quaternius' CC0 mannequin to a lightweight Mixamo-named FBX.

Run in Blender with -- --source AnimationLibrary_Unity_Standard.fbx.
See assets/characters/README.md for provenance and reproduction.
"""
import argparse
from pathlib import Path
import sys

import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/characters/neutral-low-poly.fbx')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(args.source.resolve()), automatic_bone_orientation=False)
    rig, = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    for obj in bpy.context.scene.objects:
        obj.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    names = {'DEF-hips': 'Hips', 'DEF-spine.001': 'Spine', 'DEF-spine.002': 'Spine1',
             'DEF-spine.003': 'Spine2', 'DEF-neck': 'Neck', 'DEF-head': 'Head'}
    for side, label in [('L', 'Left'), ('R', 'Right')]:
        for source, target in [('shoulder', 'Shoulder'), ('upper_arm', 'Arm'),
                               ('forearm', 'ForeArm'), ('hand', 'Hand'), ('thigh', 'UpLeg'),
                               ('shin', 'Leg'), ('foot', 'Foot'), ('toe', 'ToeBase')]:
            names[f'DEF-{source}.{side}'] = label + target
        for source, target in [('f_index', 'Index'), ('f_middle', 'Middle'),
                               ('f_ring', 'Ring'), ('f_pinky', 'Pinky'), ('thumb', 'Thumb')]:
            for n in range(1, 4):
                names[f'DEF-{source}.{n:02d}.{side}'] = f'{label}Hand{target}{n}'
    for source, target in names.items():
        # Blender propagates bone renames to the corresponding vertex groups.
        rig.data.bones[source].name = 'mixamorig:' + target
    material = bpy.data.materials.new('Neutral gray')
    material.diffuse_color = (.45, .49, .53, 1)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = material.diffuse_color
    shader.inputs['Roughness'].default_value = .8
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new('Low poly', 'DECIMATE')
        modifier.ratio = .35
        # Collapse in rest space; retain the original skin weights/armature.
        bpy.ops.object.modifier_move_up(modifier=modifier.name)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.data.materials.clear()
        obj.data.materials.append(material)
        for polygon in obj.data.polygons:
            polygon.material_index = 0
        print(f'{obj.name}: {len(obj.data.vertices)} vertices, '
              f'{sum(len(p.vertices) - 2 for p in obj.data.polygons)} triangles', flush=True)
    bpy.context.view_layer.update()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.fbx(filepath=str(args.output.resolve()), object_types={'ARMATURE', 'MESH'},
                            add_leaf_bones=False, bake_anim=False, axis_forward='-Z', axis_up='Y')


if __name__ == '__main__':
    main()
