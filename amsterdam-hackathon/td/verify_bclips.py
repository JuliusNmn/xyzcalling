"""Run in TD Textport: validate external CLI-written clips, then remove own nodes."""

import json
from pathlib import Path
import uuid

import numpy as np
import td


def verify():
    folder = Path('/Users/moritzcarlonaeumann/2026-Calendar/projects/amsterdam-hackathon')
    scratch = td.op('/').create(td.baseCOMP, '__clip_check_' + uuid.uuid4().hex[:8])
    report = {'files': [], 'scene_parameters_modified': False}
    try:
        for name in ('Chicken_Dance', 'Arms_Hip_Hop_Dance', 'Chicken_Dance_MediaPipe'):
            path = folder / 'Chan' / (name + '.bclip')
            expected = json.loads(path.with_suffix('.json').read_text())
            reader = scratch.create(td.fileinCHOP, 'read_' + name)
            reader.par.file = str(path)
            reader.cook(force=True)
            if reader.errors():
                raise RuntimeError(reader.errors())
            assert reader.numChans == expected['channels'], (name, reader.numChans)
            assert reader.numSamples == expected['samples'], (name, reader.numSamples)
            assert abs(reader.rate - expected['fps']) < 0.001
            assert [c.name for c in reader.chans()] == expected['channel_names']
            assert np.isfinite(reader.numpyArray()).all()
            report['files'].append({'file': str(path), 'channels': reader.numChans,
                                    'samples': reader.numSamples, 'rate': reader.rate,
                                    'native_read_success': True})
        # Independent comparison to the already loaded original FBX in TD.
        original = td.op('/project1/scenes/Dance/Chicken_Dance')
        source = scratch.create(td.importselectCHOP, 'original_full_range')
        source.par.parent = original.path
        source.par.useparentanim = False
        source.par.animation = 'mixamo.com'
        source.par.sampleratemode = 'filefps'
        source.par.playmode = 'outputfullrange'
        source.par.timeslice = False
        source.cook(force=True)
        if source.errors():
            raise RuntimeError(source.errors())
        reader = scratch.op('read_Chicken_Dance')
        common = [c.name for c in source.chans() if reader[c.name] is not None]
        errors = {name: float(np.max(np.abs(np.array(source[name].vals) - np.array(reader[name].vals))))
                  for name in common}
        report['original_native_comparison'] = {
            'native_channels': source.numChans, 'native_samples': source.numSamples,
            'native_rate': source.rate, 'common_channels': len(common),
            'max_absolute_error': max(errors.values()) if errors else None,
            'per_channel_max_error': errors,
            'missing_from_cli': [c.name for c in source.chans() if reader[c.name] is None],
        }
        print('BCLIP_NATIVE_CHECK', json.dumps(report))
    finally:
        scratch.destroy()
    (folder / 'Chan' / 'bclip_native_verification.json').write_text(json.dumps(report, indent=2) + '\n')


verify()
