"""Recover removed root travel, then calibrate contacts on Motion Stage's actual rigs.
Requires Python + NumPy and the local npm dependencies; no model inference.
"""
import json
from pathlib import Path
import subprocess
import tempfile
import numpy as np

root = Path(__file__).resolve().parent.parent
config = json.loads((root / 'config.json').read_text())
entry = next(item for item in config['animations'] if item['id'] == 'first-of-year')
source = (root / entry['file']).resolve().with_suffix('.npz')
data = np.load(source)
report = json.loads(source.with_suffix('.validation.json').read_text())
if report['root_motion'] != 'in-place':
    raise ValueError('This scene restores travel removed by an in-place bake')
angle = np.deg2rad(report['initial_heading_alignment_degrees'])
xz = data['joints_global'][:, 0, [0, 2]].astype(float)
xz -= xz[0]
xz = xz @ np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
xz *= report['translation_scale']
motion = dict(version=1, source=source.name, fps=float(data['fps']), duration=float(data['duration']),
              root_motion='in-place', coordinate_space='Three.js Y-up; saved FBX heading and scale; metres',
              root_xz=np.round(xz, 5).tolist())
with tempfile.NamedTemporaryFile(mode='w+', suffix='.json') as temporary:
    json.dump(motion, temporary); temporary.flush()
    subprocess.run(['node', str(root / 'scripts/sample-first-of-year.mjs'), temporary.name], check=True, cwd=root)
