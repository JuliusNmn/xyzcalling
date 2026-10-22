import struct
import unittest
from pathlib import Path

from fbx_to_bclip import decode_bclip, encode_bclip, extract


ROOT = Path(__file__).resolve().parents[1]


class ClipTests(unittest.TestCase):
    def test_exact_template_roundtrip(self):
        raw = (ROOT / 'Chan/pattern1.bclip').read_bytes()
        rate, start, channels, ends, default = decode_bclip(raw)
        self.assertEqual((rate, len(channels), len(channels['chan1'])), (60, 1, 1000))
        self.assertEqual(encode_bclip(rate, channels, start, ends, default), raw)

    def test_multiple_named_channels(self):
        channels = {'mixamorig_Hips:ty': [0., 1., 2.],
                    'mixamorig_LeftHandRing2:rx': [88., 90., 92.]}
        rate, start, actual, ends, default = decode_bclip(encode_bclip(30, channels))
        self.assertEqual((rate, start, actual, ends, default), (30, 0, channels, (2, 2), 0))

    def test_truncated_chunk_rejected(self):
        raw = encode_bclip(30, {'bone:rx': [1.]})
        with self.assertRaises((ValueError, struct.error)):
            decode_bclip(raw[:-5])

    def test_nonfinite_rejected(self):
        with self.assertRaises(ValueError):
            encode_bclip(30, {'bone:rx': [float('nan')]})

    def test_mismatched_lengths_rejected(self):
        with self.assertRaises(ValueError):
            encode_bclip(30, {'a': [1., 2.], 'b': [1.]})

    def test_original_dances(self):
        for name, count in [('Chicken Dance', 144), ('Arms Hip Hop Dance', 660)]:
            with self.subTest(name=name):
                rate, channels, report = extract(ROOT / 'Geo' / (name + '.fbx'), 'mixamo.com')
                self.assertEqual(rate, 30)
                self.assertEqual(report['samples'], count)
                self.assertEqual(report['channels'], 159)
                self.assertIn('mixamorig_LeftHandRing2:rx', channels)
                raw = encode_bclip(rate, channels)
                self.assertEqual(decode_bclip(raw)[2], channels)


if __name__ == '__main__':
    unittest.main()
