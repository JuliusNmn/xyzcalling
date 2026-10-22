from pathlib import Path
import sys
import unittest
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from gvhmr_root_motion import floor_drift


class GroundingTests(unittest.TestCase):
    def test_drift_jumps_and_crouches(self):
        fps = 30
        t = np.arange(900) / fps
        joints = np.zeros((len(t), 22, 3))
        joints[:, :, 1] = .05 * t[:, None]
        joints[:, 0, 1] += 1
        jump = .4 * np.maximum(0, 1 - np.abs(t - 10) / .3)
        joints[:, :, 1] += jump[:, None]
        crouch = .3 * np.maximum(0, 1 - np.abs(t - 20) / 2)
        joints[:, 0, 1] -= crouch
        before = joints.copy()
        corrected = joints[:, 0, 1] - floor_drift(joints, fps)
        np.testing.assert_array_equal(joints, before)
        self.assertLess(np.ptp(corrected[(t > 3) & (t < 8)]), .01)
        self.assertLess(abs((corrected[300] - corrected[270]) - .4), .03)
        self.assertLess(abs((corrected[540] - corrected[600]) - .3), .03)
        self.assertLess(np.ptp(corrected), .8)

    def test_short_clips_keep_height(self):
        np.testing.assert_array_equal(floor_drift(np.zeros((30, 22, 3)), 30), np.zeros(30))


if __name__ == '__main__':
    unittest.main()
