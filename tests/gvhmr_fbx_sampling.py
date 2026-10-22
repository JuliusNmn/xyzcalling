"""Blender regression for long fractional FBX endpoints and original sample times."""
from pathlib import Path
import sys
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from gvhmr_retarget import export_fbx

for duration in [1.047, 185.8857]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.object.armature_add()
    rig = bpy.context.object
    bone = rig.pose.bones[0]
    count = int(np.ceil(duration * 30))
    endpoint = duration * 30
    for frame, x in [(0, 0), (count - 2, 0), (count - 1, 1), (endpoint, 1)]:
        bone.location.x = x
        bone.keyframe_insert('location', frame=frame)
    for curve in rig.animation_data.action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = 'LINEAR'
    path = ROOT / 'artifacts/fractional-sampling-test.fbx'
    export_fbx(path, rig, {'inference_frames': count})
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.fbx(filepath=str(path))
    rig, = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    action = rig.animation_data.action
    curve = next(c for c in action.fcurves if 'location' in c.data_path and c.array_index == 0)
    times = np.array([key.co.x for key in curve.keyframe_points])
    times -= action.frame_range[0]
    expected = np.append(np.arange(count, dtype=float), endpoint)
    np.testing.assert_allclose(times, expected, atol=0.001, rtol=0)
    assert abs((action.frame_range[1] - action.frame_range[0]) / 30 - duration) < .0001
    print(f'PASS: {duration}s retains {count} original samples and exact endpoint')
