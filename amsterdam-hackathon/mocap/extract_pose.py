"""Extract one person's MediaPipe world landmarks from a local video, offline."""

import argparse
import hashlib
import json
import math
from pathlib import Path


def extract(video, model, output, max_seconds):
    import cv2
    import mediapipe as mp

    if output.exists():
        raise FileExistsError(f'Refusing to overwrite {output}')
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not cap.isOpened() or not math.isfinite(fps) or fps <= 0:
        raise ValueError('Cannot decode video or determine its frame rate')
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=1,
    )
    frames = []
    fields = ('x', 'y', 'z', 'visibility', 'presence')
    try:
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
            for index in range(math.ceil(max_seconds * fps)):
                ok, bgr = cap.read()
                if not ok:
                    break
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                result = detector.detect_for_video(
                    mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb),
                    round(index / fps * 1000),
                )
                frame = {'time': index / fps, 'world': None, 'image': None}
                if result.pose_world_landmarks:
                    for key, landmarks in [('world', result.pose_world_landmarks[0]),
                                           ('image', result.pose_landmarks[0])]:
                        frame[key] = [{k: float(getattr(p, k)) for k in fields}
                                      for p in landmarks]
                frames.append(frame)
    finally:
        cap.release()
    detected = sum(f['world'] is not None for f in frames)
    if not detected:
        raise ValueError('MediaPipe found no person; no motion output written')
    payload = {
        'schema': 'mediapipe-mixamo-v1', 'fps': fps,
        'source': video.name,
        'source_sha256': hashlib.sha256(video.read_bytes()).hexdigest(),
        'model_sha256': hashlib.sha256(model.read_bytes()).hexdigest(),
        'mediapipe_version': mp.__version__,
        'coordinates': 'mediapipe-world-meters-x-right-y-down-z-away',
        'detected_frames': detected, 'frames': frames,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, allow_nan=False), encoding='utf-8')
    print(json.dumps({'frames': len(frames), 'detected': detected,
                      'fps': fps, 'output': str(output)}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--max-seconds', type=float, default=8)
    args = parser.parse_args()
    if not math.isfinite(args.max_seconds) or args.max_seconds <= 0:
        parser.error('--max-seconds must be positive and finite')
    extract(args.video, args.model, args.output, args.max_seconds)


if __name__ == '__main__':
    main()
