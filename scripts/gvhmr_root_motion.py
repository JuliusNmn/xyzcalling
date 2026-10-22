"""Separate slowly drifting world height from short dance movements."""
import numpy as np


def floor_drift(joints, fps):
    """Estimate floor drift with a centered 3s lower envelope and 0.5s smoothing.

    The lowest body joint also handles hand-supported floor work. The lower
    percentile rejects short airborne intervals, rather than pinning a jumping
    foot to the floor every frame. This is a monocular heuristic, not foot locking.
    Clips shorter than the window keep their original vertical motion.
    """
    window = max(3, round(3 * fps) | 1)
    if len(joints) < window:
        return np.zeros(len(joints))
    ground = np.min(joints[:, :, 1], axis=1)
    padded = np.pad(ground, window // 2, mode='edge')
    envelope = np.percentile(np.lib.stride_tricks.sliding_window_view(padded, window), 20, axis=1)
    smooth = max(1, round(.5 * fps) | 1)
    baseline = np.convolve(np.pad(envelope, smooth // 2, mode='edge'), np.ones(smooth) / smooth, mode='valid')
    return baseline - baseline[0]
