"""Render sampled poses from an exported FBX for visual inspection in Blender."""
import argparse
from pathlib import Path
import sys
import math
import bpy
from mathutils import Vector


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fbx', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=5)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(args.fbx.resolve()), automatic_bone_orientation=False)
    scene = bpy.context.scene
    rig, = [o for o in scene.objects if o.type == 'ARMATURE']
    start, end = rig.animation_data.action.frame_range
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = 400, 600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world = bpy.data.worlds.new('World')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.16, .18, .21, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .6
    scene.view_settings.view_transform = 'Standard'
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    scene.camera = camera
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 2.7
    lights = []
    for offset, power, size in [((2, -3, 4), 500, 4), ((-3, -2, 2), 250, 3), ((0, 3, 3), 350, 2)]:
        bpy.ops.object.light_add(type='AREA')
        light = bpy.context.object
        light.data.energy, light.data.shape, light.data.size = power, 'DISK', size
        lights.append((light, Vector(offset)))
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    for index in range(args.samples):
        frame = start + (end - start) * index / max(1, args.samples - 1)
        scene.frame_set(math.floor(frame), subframe=frame % 1)
        bpy.context.view_layer.update()
        hips = next(b for b in rig.pose.bones if b.name.endswith('Hips'))
        pos = rig.matrix_world @ hips.head
        center = Vector((pos.x, pos.y, 1))
        camera.location = center + Vector((0, -5, .2))
        aim(camera, center)
        for light, offset in lights:
            light.location = center + offset
            aim(light, center)
        scene.render.filepath = str(output / f'{index:02}.png')
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
