"""Run: uv run --no-project --python 3.12 --with numpy python -m unittest discover -s tests -p 'test_audio*.py'."""
import importlib.util
from pathlib import Path
import unittest
from argparse import Namespace
import json
import shutil
import subprocess
import tempfile
import numpy as np

spec = importlib.util.spec_from_file_location("audio", Path(__file__).parents[1] / "analyze_audio.py")
audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio)


class AudioTests(unittest.TestCase):
    def test_bars_preserve_pickup_and_mixed_meter(self):
        beats = np.arange(0, 10, .5)
        result = audio.rhythm(beats, [1, 2.5, 4.5, 6, 8], 10)
        self.assertEqual([b['beat_count'] for b in result['bars']], [3, 4, 3, 4])
        self.assertEqual(result['bars'][0]['start_seconds'], 1)
        self.assertEqual(result['bars'][-1]['end_seconds'], 8)
        self.assertEqual(result['bpm'], 120)

    def test_tempo_averages_quantized_beats(self):
        beats = np.round(np.arange(100) * 60 / 123 / .02) * .02
        self.assertLess(abs(audio.rhythm(beats, beats[::4], 50)['bpm'] - 123), .2)

    def test_silence_and_unmatched_downbeats(self):
        result = audio.rhythm([], [], 5)
        self.assertIsNone(result['bpm'])
        self.assertEqual(result['bars'], [])
        self.assertEqual(audio.rhythm([0, .5, 1], [.25], 2)['downbeats_seconds'], [])

    def test_waveform_keeps_transients_and_silent_bins(self):
        samples = np.zeros(1000)
        samples[121] = .9
        samples[122] = -.8
        wave = audio.waveform(samples, 1000, 1)
        self.assertEqual(len(wave['peaks']), 100)
        self.assertEqual(wave['peaks'][12], [-.8, .9])
        self.assertEqual(wave['peaks'][0], [0, 0])
        self.assertAlmostEqual(wave['bin_seconds'] * len(wave['peaks']), 1)
        self.assertEqual(len(audio.waveform(samples, 1000, 10000)['peaks']), 30000)

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
    def test_delayed_audio_alignment_cache_and_stale_output(self):
        with tempfile.TemporaryDirectory() as directory:
            video = Path(directory) / 'delayed.mp4'
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                            'color=c=black:s=32x32:r=10:d=4', '-itsoffset', '1', '-f', 'lavfi', '-i',
                            'sine=frequency=440:duration=2:sample_rate=22050', '-map', '0:v', '-map', '1:a',
                            '-c:v', 'libx264', '-c:a', 'aac', str(video)], check=True)
            captured = []
            def tracker(samples, sr):
                captured.append(samples)
                return [1, 1.5, 2, 2.5], [1, 2.5]
            args = Namespace(force=False, model='test', device='cpu')
            audio.analyze(video, args, lambda: tracker)
            data = json.loads(Path(str(video) + '.analysis.json').read_text())
            self.assertAlmostEqual(data['duration_seconds'], 4, places=2)
            samples = captured[0]
            self.assertLess(float(np.max(np.abs(samples[:int(.8 * 22050)]))), .001)
            self.assertGreater(float(np.max(np.abs(samples[int(1.2 * 22050):int(2.5 * 22050)]))), .05)
            self.assertLess(float(np.max(np.abs(samples[int(3.2 * 22050):]))), .001)
            audio.analyze(video, args, lambda: self.fail('Cached analysis should not load a model'))
            video.touch()
            # Ensure a modification differs even on filesystems with coarser clocks.
            import os
            os.utime(video, (video.stat().st_atime, video.stat().st_mtime + 2))
            with self.assertRaisesRegex(ValueError, 'stale'):
                audio.analyze(video, args, lambda: tracker)


if __name__ == '__main__':
    unittest.main()
