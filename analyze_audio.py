# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["beat-this==1.1.0", "numpy>=2,<3", "torch==2.8.0", "torchaudio==2.8.0"]
# ///
"""Write <video>.analysis.json beside each video. Run with npm run analyze:audio.

Requires ffmpeg/ffprobe. Existing matching analysis is reused; --force replaces it.
All times are seconds on the source media timeline, including leading silence.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import wave

import numpy as np

EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v", ".ogv", ".mkv", ".avi"}
SCHEMA = "pose-studio.audio-analysis"


def probe(path):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_format", "-show_streams",
                             "-of", "json", str(path)], check=True, capture_output=True, text=True)
    data = json.loads(result.stdout)
    if not any(s["codec_type"] == "audio" for s in data["streams"]):
        raise ValueError("Video has no audio stream")
    duration = float(data["format"]["duration"])
    origin = float(data["format"].get("start_time", 0))
    if not math.isfinite(duration) or duration <= 0 or not math.isfinite(origin):
        raise ValueError("Invalid media duration or start time")
    return duration, origin


def waveform(samples, sr, duration, max_bins=30000):
    # Full timeline, at most 100 bins/sec. Min/max retains short transients.
    count = min(max_bins, max(1, math.ceil(duration * 100)))
    edges = np.linspace(0, len(samples), count + 1, dtype=int)
    peaks = []
    for start, end in zip(edges[:-1], edges[1:]):
        block = samples[start:end]
        peaks.append([round(float(block.min()), 4), round(float(block.max()), 4)] if len(block) else [0, 0])
    return {"encoding": "min-max", "start_seconds": 0, "duration_seconds": duration,
            "bin_seconds": duration / count, "sample_rate_hz": sr, "peaks": peaks}


def rhythm(beats, downbeats, duration):
    beats = sorted(set(round(float(t), 6) for t in beats if math.isfinite(t) and 0 <= t < duration))
    # The model's downbeats should coincide with beats. Snap only within 70 ms;
    # reject unmatched predictions instead of manufacturing bar boundaries.
    downbeat_indices = sorted(set(
        index for t in downbeats if math.isfinite(t)
        for index in ([min(range(len(beats)), key=lambda i: abs(beats[i] - t))] if beats else [])
        if abs(beats[index] - t) <= .07
    ))
    downbeats = [beats[i] for i in downbeat_indices]
    # Average over up to eight beats before taking the median: individual model
    # timestamps are quantized to 20 ms, which otherwise biases reported BPM.
    span = min(8, len(beats) - 1)
    intervals = (np.asarray(beats[span:]) - np.asarray(beats[:-span])) / span if span > 0 else []
    bpm = round(60 / float(np.median(intervals)), 3) if len(intervals) else None
    bars = []
    for n, (a, b) in enumerate(zip(downbeat_indices[:-1], downbeat_indices[1:])):
        bars.append({"index": n, "start_seconds": beats[a], "end_seconds": beats[b],
                     "start_beat_index": a, "end_beat_index": b, "beat_count": b - a,
                     "bpm": round(60 * (b - a) / (beats[b] - beats[a]), 3)})
    warnings = []
    if len(bars) < 4:
        warnings.append("Fewer than four complete detected bars; a four-bar export is unavailable.")
    if any(b["beat_count"] not in (3, 4) for b in bars):
        warnings.append("Some detected bars have unusual beat counts. Audition their alignment before exporting.")
    return {"bpm": bpm, "beats_seconds": beats, "downbeats_seconds": downbeats,
            "bars": bars, "warnings": warnings}


def fingerprint(path):
    info = path.stat()
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"name": path.name, "bytes": info.st_size, "mtime_ms": info.st_mtime_ns // 1_000_000,
            "sha256": digest}


def analyze(path, args, get_tracker):
    output = path.with_name(path.name + ".analysis.json")
    source = fingerprint(path)
    if output.exists() and not args.force:
        try:
            old = json.loads(output.read_text())
            if (isinstance(old, dict) and old.get("schema") == SCHEMA and old.get("version") == 1
                    and old.get("source") == source and old.get("analyzer", {}).get("checkpoint") == args.model):
                print(f"Up to date: {output.name}", flush=True)
                return
        except (ValueError, OSError):
            pass
        raise ValueError(f"{output.name} is stale or incompatible; use --force to regenerate")
    duration, origin = probe(path)
    print(f"Extracting audio: {path.name} ({duration:.1f}s)", flush=True)
    with tempfile.TemporaryDirectory(prefix="pose-audio-") as directory:
        wav = Path(directory) / "audio.wav"
        # Preserve source timestamps then shift to the media player's zero.
        # first_pts pads a delayed audio stream; apad covers a silent ending.
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-copyts", "-i", str(path),
                        "-map", "0:a:0", "-vn", "-af",
                        f"asetpts=PTS-({origin})/TB,aresample=22050:async=1:first_pts=0,apad",
                        "-t", str(duration), "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le", str(wav)],
                       check=True)
        with wave.open(str(wav)) as audio:
            sr = audio.getframerate()
            samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768
        print("Detecting beats and downbeats…", flush=True)
        if len(samples) and float(np.max(np.abs(samples))) > .0001:
            beats, downbeats = get_tracker()(samples, sr)
        else:
            beats, downbeats = [], []
        data = {"schema": SCHEMA, "version": 1, "source": source,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "duration_seconds": duration, "timebase": "video-seconds",
                "analyzer": {"name": "beat-this", "version": "1.1.0", "checkpoint": args.model,
                             "device": args.device, "dbn": False},
                **rhythm(beats, downbeats, duration), "waveform": waveform(samples, sr, duration)}
    if fingerprint(path) != source:
        raise ValueError("Video changed during analysis; output discarded")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".audio-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(data, stream, separators=(",", ":"), allow_nan=False)
            stream.write("\n")
        if args.force:
            os.replace(temporary, output)
        else:
            # Exclusive publication, even if another extractor ran concurrently.
            os.link(temporary, output)
        print(f"Saved {output.name}: {len(data['beats_seconds'])} beats, {len(data['bars'])} complete bars, {data['bpm']} BPM", flush=True)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", type=Path, default=[Path(os.environ.get("VIDEO_DIR", Path(__file__).parent / "videos"))])
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--model", default="final0", help="Beat This! checkpoint, default final0")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda", "mps"])
    args = parser.parse_args()
    files = []
    for path in args.paths:
        files.extend(sorted(p for p in path.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS) if path.is_dir() else [path])
    if not files:
        parser.error("No video files found")
    tracker = None
    def get_tracker():
        nonlocal tracker
        if tracker is None:
            from beat_this.inference import Audio2Beats
            tracker = Audio2Beats(checkpoint_path=args.model, device=args.device, dbn=False)
        return tracker
    failures = 0
    for path in dict.fromkeys(files):
        try:
            analyze(path.resolve(), args, get_tracker)
        except Exception as error:
            failures += 1
            print(f"Failed {path.name}: {error}", file=sys.stderr, flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
