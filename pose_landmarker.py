# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["mediapipe==1.1.1", "opencv-contrib-python==5.0.0.93"]
# ///
"""Extract poses from a video using MediaPipe's Pose Landmarker Tasks API.

Run with dependencies managed by uv:
    uv run --python 3.12 pose_landmarker.py
    uv run --python 3.12 pose_landmarker.py --max-frames 100 -o smoke.poses.jsonl
    uv run --python 3.12 pose_landmarker.py other_video.mp4 --num-poses 2

Output is JSONL: a metadata record followed by one record per decoded frame.
Each pose contains 33 normalized image landmarks and 33 world landmarks
(meters, relative to the hip midpoint), with visibility/presence scores.
Frames without a detected person have an empty poses list. Pose array indices
are not persistent person IDs. Existing output files are never overwritten.

API reference: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python
"""

import argparse
from dataclasses import asdict
import json
import math
from pathlib import Path
import shutil
import sys
import tempfile
from urllib.request import urlopen

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


ROOT = Path(__file__).resolve().parent
DEFAULT_VIDEO = ROOT / "videos" / (
    "The Chemical Brothers - Wide Open (Official Music Video) ft. Beck [BC2dRkm8ATU].mp4"
)
DEFAULT_MODEL = ROOT / "models" / "pose_landmarker_full.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_full/float16/latest/pose_landmarker_full.task"
)
LANDMARK_NAMES = (
    "nose left_eye_inner left_eye left_eye_outer right_eye_inner right_eye "
    "right_eye_outer left_ear right_ear mouth_left mouth_right left_shoulder "
    "right_shoulder left_elbow right_elbow left_wrist right_wrist left_pinky "
    "right_pinky left_index right_index left_thumb right_thumb left_hip "
    "right_hip left_knee right_knee left_ankle right_ankle left_heel right_heel "
    "left_foot_index right_foot_index"
).split()


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def download_model(path: Path) -> None:
    """Cache the official full model, publishing it only after download completes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading model to {path}", file=sys.stderr, flush=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            with urlopen(MODEL_URL, timeout=60) as response:
                shutil.copyfileobj(response, output)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def run(args: argparse.Namespace) -> None:
    video = args.video.resolve()
    output_path = (args.output or video.with_suffix(".poses.jsonl")).resolve()
    model = args.model.resolve()
    if not video.is_file():
        raise FileNotFoundError(f"Video not found: {video}")
    if output_path.exists():
        raise FileExistsError(f"Output already exists; choose another with -o: {output_path}")
    if output_path in (video, model):
        raise ValueError("Output must differ from the video and model paths")
    if not model.is_file():
        if model != DEFAULT_MODEL:
            raise FileNotFoundError(f"Custom model not found: {model}")
        download_model(model)

    capture = cv2.VideoCapture(str(video))
    processed = 0
    frames_with_pose = 0
    try:
        if not capture.isOpened():
            raise RuntimeError(f"Could not open video: {video}")
        fps = capture.get(cv2.CAP_PROP_FPS)
        if not math.isfinite(fps) or fps <= 0:
            raise RuntimeError("Video has no usable frame rate")
        ok, frame = capture.read()
        if not ok:
            raise RuntimeError("Could not decode the first video frame")
        height, width = frame.shape[:2]
        scale = min(1.0, args.max_width / width)
        inference_size = (max(1, round(width * scale)), max(1, round(height * scale)))
        options = vision.PoseLandmarkerOptions(
            base_options=python.BaseOptions(
                model_asset_path=str(model), delegate=python.BaseOptions.Delegate.CPU
            ),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=args.num_poses,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with vision.PoseLandmarker.create_from_options(options) as landmarker:
            with output_path.open("x", encoding="utf-8") as output:
                metadata = {
                    "type": "metadata", "video": str(video), "model": str(model),
                    "mediapipe_version": mp.__version__, "fps": fps,
                    "width": width, "height": height,
                    "inference_size": list(inference_size),
                    "num_poses": args.num_poses, "landmark_names": LANDMARK_NAMES,
                    "world_units": "meters", "world_origin": "hip_midpoint",
                }
                output.write(json.dumps(metadata) + "\n")
                previous_timestamp = -1
                while ok and (args.max_frames is None or processed < args.max_frames):
                    # Prefer decoder timestamps (also handles variable frame rates).
                    # Fall back to frame index / FPS if the backend omits timestamps.
                    position_ms = capture.get(cv2.CAP_PROP_POS_MSEC)
                    timestamp = (
                        round(position_ms) if math.isfinite(position_ms) and position_ms >= 0
                        else round(processed * 1000 / fps)
                    )
                    if timestamp <= previous_timestamp:
                        timestamp = max(previous_timestamp + 1, round(processed * 1000 / fps))
                    previous_timestamp = timestamp
                    if (width, height) != inference_size:
                        frame = cv2.resize(frame, inference_size, interpolation=cv2.INTER_AREA)
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    result = landmarker.detect_for_video(
                        mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), timestamp
                    )
                    poses = [
                        {
                            "landmarks": [asdict(point) for point in normalized],
                            "world_landmarks": [asdict(point) for point in world],
                        }
                        for normalized, world in zip(
                            result.pose_landmarks, result.pose_world_landmarks
                        )
                    ]
                    output.write(json.dumps({
                        "type": "frame", "frame_index": processed,
                        "timestamp_ms": timestamp, "poses": poses,
                    }, allow_nan=False) + "\n")
                    processed += 1
                    frames_with_pose += bool(poses)
                    if processed % 250 == 0:
                        print(f"Processed {processed} frames ({timestamp / 1000:.1f}s)",
                              file=sys.stderr, flush=True)
                    if args.max_frames is not None and processed >= args.max_frames:
                        break
                    ok, frame = capture.read()
    finally:
        capture.release()
    print(f"Saved {processed} frames ({frames_with_pose} with poses) to {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", nargs="?", type=Path, default=DEFAULT_VIDEO)
    parser.add_argument("-o", "--output", type=Path, help="JSONL output; default: VIDEO.poses.jsonl")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL,
                        help="Local .task model; the default full model downloads automatically")
    parser.add_argument("--num-poses", type=positive_int, default=1)
    parser.add_argument("--max-width", type=positive_int, default=1280,
                        help="Inference width limit, preserving aspect ratio (default: 1280)")
    parser.add_argument("--max-frames", type=positive_int, help="Stop after this many frames")
    args = parser.parse_args()
    try:
        run(args)
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"Error: {error}\n")
    except KeyboardInterrupt:
        parser.exit(130, "Interrupted; any JSONL output contains only completed frames.\n")


if __name__ == "__main__":
    main()
