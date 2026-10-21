"""Show source, actual 2D detections and reimported baked FBX in one video."""

import argparse
import json
from pathlib import Path
import subprocess


CONNECTIONS = [(11, 12), (11, 23), (12, 24), (23, 24),
               (11, 13), (13, 15), (12, 14), (14, 16),
               (23, 25), (25, 27), (24, 26), (26, 28),
               (27, 29), (29, 31), (27, 31), (28, 30), (30, 32), (28, 32),
               (7, 8), (7, 11), (8, 12)]


def main():
    import cv2
    import numpy as np

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--frames', required=True, type=Path)
    parser.add_argument('--landmarks', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(args.output)
    data = json.loads(args.landmarks.read_text())
    cap = cv2.VideoCapture(str(args.source))
    w, h, bar = 384, 512, 64
    command = ['ffmpeg', '-v', 'error', '-n', '-f', 'rawvideo', '-pix_fmt', 'bgr24',
               '-s', f'{w * 3}x{h + bar}', '-r', str(data['fps']), '-i', '-',
               '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
               '-movflags', '+faststart', str(args.output)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for index, frame in enumerate(data['frames'], 1):
            ok, source = cap.read()
            baked = cv2.imread(str(args.frames / f'frame_{index:04d}.png'))
            if not ok or baked is None:
                raise ValueError(f'Missing source or baked frame {index}')
            source = cv2.resize(source, (w, h))
            baked = cv2.resize(baked, (w, h))
            skeleton = np.full((h, w, 3), 238, dtype=np.uint8)
            raw = frame.get('image')
            if raw:
                p = [(round(x['x'] * w), round(x['y'] * h)) for x in raw]
                for a, b in CONNECTIONS:
                    if min(raw[a]['visibility'], raw[b]['visibility']) >= 0.5:
                        cv2.line(skeleton, p[a], p[b], (140, 95, 15), 3, cv2.LINE_AA)
                for i, point in enumerate(p):
                    if raw[i]['visibility'] >= 0.5:
                        cv2.circle(skeleton, point, 4, (70, 150, 220), -1, cv2.LINE_AA)
            else:
                cv2.putText(skeleton, 'NO POSE DETECTED', (40, h // 2),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 150), 2)
            canvas = np.full((h + bar, w * 3, 3), 245, dtype=np.uint8)
            for col, (title, image) in enumerate([
                    ('SOURCE: MIXAMO DANCE', source),
                    ('MEDIAPIPE DETECTIONS', skeleton),
                    ('BAKED FBX: REIMPORTED', baked)]):
                canvas[bar:, col * w:(col + 1) * w] = image
                cv2.putText(canvas, title, (col * w + 12, 24),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.52, (45, 45, 45), 1, cv2.LINE_AA)
            cv2.putText(canvas, f'Synthetic calibration | frame {index}/{len(data["frames"])} | body only, in place',
                        (12, 48), cv2.FONT_HERSHEY_SIMPLEX, 0.46, (80, 80, 80), 1, cv2.LINE_AA)
            process.stdin.write(canvas.tobytes())
        process.stdin.close()
        if process.wait():
            raise RuntimeError('Preview encoder failed')
    finally:
        cap.release()
        if process.poll() is None:
            process.stdin.close()
            process.terminate()
            process.wait()
    print(args.output)


if __name__ == '__main__':
    main()
