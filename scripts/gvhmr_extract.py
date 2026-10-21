"""Full-duration GVHMR inference, without the compiled PyTorch3D renderer.

Run with artifacts/gvhmr-env/Scripts/python.exe scripts/gvhmr_extract.py.
Preprocessing can run before the licensed SMPL-X model is supplied.
"""
import argparse
import gc
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def inspect_video(path):
    import av
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        timestamps = []
        blank_frames = []
        end = 0
        for frame in container.decode(stream):
            t = float(frame.pts * stream.time_base)
            timestamps.append(t)
            gray = frame.to_ndarray(format='gray')
            blank_frames.append(bool(gray.mean() < 8 and gray.std() < 3))
            end = t + 1 / float(stream.average_rate)
        if not timestamps:
            raise ValueError(f'Empty video: {path}')
        if stream.duration:
            end = max(end, float((stream.start_time or 0) + stream.duration) * float(stream.time_base))
        duration = end - timestamps[0]
        return dict(file=path.name, sha256=sha256(path), frames=len(timestamps),
                    fps=float(stream.average_rate), width=stream.width, height=stream.height,
                    duration=duration, first_pts=timestamps[0], timestamps=timestamps, blank_frames=blank_frames)


def prepare_video(source, target, info):
    """Resample by presentation time, never relabel the original frames as 30 FPS."""
    import av
    import cv2
    count = math.ceil(info['duration'] * 30 - 1e-7)
    scale = min(1, 960 / max(info['width'], info['height']))
    width, height = [int(n * scale) // 2 * 2 for n in (info['width'], info['height'])]
    temp = target.with_name(target.stem + '.partial.mp4')
    with av.open(str(source)) as reader, av.open(str(temp), 'w') as writer:
        output = writer.add_stream('libx264', rate=30)
        output.width, output.height, output.pix_fmt = width, height, 'yuv420p'
        output.options = {'crf': '18', 'preset': 'fast'}
        frames = iter(reader.decode(video=0))
        current = next(frames)
        following = next(frames, None)
        for i in range(count):
            t = i / 30 + info['first_pts']
            while following is not None and float(following.time) <= t + 1e-8:
                current, following = following, next(frames, None)
            image = cv2.resize(current.to_ndarray(format='rgb24'), (width, height))
            frame = av.VideoFrame.from_ndarray(image, format='rgb24')
            for packet in output.encode(frame):
                writer.mux(packet)
        for packet in output.encode():
            writer.mux(packet)
    temp.replace(target)
    return count, width, height


def clear_gpu():
    import torch
    gc.collect()
    torch.cuda.empty_cache()


def preprocess(video, work, batch_size, static_camera):
    import torch
    from hmr4d.utils.preproc import Tracker, VitPoseExtractor, Extractor, SimpleVO
    from hmr4d.utils.geo.hmr_cam import get_bbx_xys_from_xyxy
    from hmr4d.utils.preproc.vitfeat_extractor import get_batch
    from tqdm import tqdm

    def cached(name, fn):
        path = work / name
        if path.exists():
            return torch.load(path, map_location='cpu')
        value = fn()
        temp = path.with_suffix('.partial.pt')
        torch.save(value, temp)
        temp.replace(path)
        return value

    def track():
        tracker = Tracker()
        boxes = tracker.get_one_track(str(video)).float()
        return {'bbx_xyxy': boxes, 'bbx_xys': get_bbx_xys_from_xyxy(boxes, base_enlarge=1.2).float()}

    boxes = cached('boxes.pt', track)
    clear_gpu()

    # Keep images on CPU and bound every GPU batch, including HMR2 (upstream
    # uploads the whole clip at once). The network/checkpoints are unchanged.
    def features(kind):
        images, _ = get_batch(str(video), boxes['bbx_xys'], img_ds=0.5)
        extractor = VitPoseExtractor() if kind == 'pose' else Extractor()
        result = []
        for start in tqdm(range(0, len(images), batch_size), desc=kind):
            if kind == 'pose':
                value = extractor.extract(images[start:start + batch_size], boxes['bbx_xys'][start:start + batch_size])
            else:
                with torch.no_grad():
                    value = extractor.extractor({'img': images[start:start + batch_size].cuda()}).cpu()
            result.append(value.cpu())
        return torch.cat(result)

    kp2d = cached('vitpose.pt', lambda: features('pose'))
    clear_gpu()
    image_features = cached('features.pt', lambda: features('features'))
    clear_gpu()
    rotation = torch.eye(3).repeat(len(kp2d), 1, 1)
    if not static_camera:
        vo = cached('camera.pt', lambda: SimpleVO(str(video), scale=0.5, step=8, method='sift').compute())
        rotation = torch.from_numpy(vo[:, :3, :3]).float()
    return boxes['bbx_xys'], kp2d, image_features, rotation


def predict(data, output, repo, static_camera):
    import torch
    import hydra
    from hydra import compose, initialize_config_module
    # Register only inference components. Training callbacks import the native
    # PyTorch3D renderer, which is unnecessary for exporting joint animation.
    import hmr4d.model.gvhmr.gvhmr_pl_demo
    import hmr4d.model.gvhmr.utils.endecoder
    import hmr4d.network.gvhmr.relative_transformer
    from hmr4d.utils.net_utils import detach_to_cpu
    with initialize_config_module(version_base='1.3', config_module='hmr4d.configs'):
        cfg = compose(config_name='demo', overrides=['video_name=offline'])
    model = hydra.utils.instantiate(cfg.model, _recursive_=False)
    model.load_pretrained_model(str(repo / cfg.ckpt_path))
    model.eval().cuda()
    with torch.no_grad():
        prediction = model.predict(data, static_cam=static_camera)
        params = prediction['smpl_params_global']
        joints, _, transforms = model.pipeline.endecoder.fk_v2(
            **{k: v[None].cuda() for k, v in params.items()}, get_intermediate=True)
        rest = model.pipeline.endecoder.smplx_model.get_skeleton(params['betas'][0:1].cuda())[0, :22]
        # Retain the official prediction plus the exact skeleton used by the model.
        prediction['joints_global'] = joints[0]
        prediction['rotations_global'] = transforms[0, :, :, :3, :3]
        prediction['rest_joints'] = rest
        prediction = detach_to_cpu(prediction)
    torch.save(prediction, output)
    del model
    clear_gpu()
    return prediction


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gvhmr', type=Path, default=ROOT / 'artifacts/GVHMR')
    parser.add_argument('--videos', type=Path, default=ROOT / 'videos')
    parser.add_argument('--video', type=Path, help='Process one file instead of the folder')
    parser.add_argument('--batch-size', type=int, default=4)
    parser.add_argument('--static-camera', action='store_true', help='Only for footage with a fixed camera')
    parser.add_argument('--preprocess-only', action='store_true')
    parser.add_argument('--inspect-only', action='store_true')
    parser.add_argument('--blender', type=Path, default=ROOT / 'artifacts/blender/blender-4.2.0-windows-x64/blender.exe')
    parser.add_argument('--character', type=Path, default=ROOT / 'amsterdam-hackathon/Geo/Chicken Dance.fbx')
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error('--batch-size must be positive')
    repo = args.gvhmr.resolve()
    videos = [args.video.resolve()] if args.video else sorted(args.videos.resolve().glob('*.mp4'))
    if not videos:
        parser.error('No videos found')
    sys.path.insert(0, str(repo))
    os.chdir(repo)
    verified_weights = {}
    if not args.inspect_only:
        from gvhmr_download_weights import FILES
        for name, (size, expected) in FILES.items():
            path = repo / 'inputs/checkpoints' / name
            if not path.is_file() or path.stat().st_size != size or sha256(path) != expected:
                raise RuntimeError(f'Missing or corrupt checkpoint: {path}. Run scripts/gvhmr_download_weights.py and verify it before inference.')
            verified_weights[name] = expected
    for video in videos:
        info = inspect_video(video)
        print(json.dumps({k: v for k, v in info.items() if k not in {'timestamps', 'blank_frames'}}), flush=True)
        if args.inspect_only:
            continue
        import torch
        from hmr4d.utils.geo.hmr_cam import estimate_K
        from hmr4d.utils.geo_transform import compute_cam_angvel
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA GPU required')
        work = ROOT / 'artifacts/gvhmr-runs' / f'{video.stem}-{info["sha256"][:12]}'
        work = work / ('static' if args.static_camera else 'moving')
        work.mkdir(parents=True, exist_ok=True)
        normalized = work / 'input-30fps.mp4'
        if not normalized.exists():
            prepare_video(video, normalized, info)
        import cv2
        cap = cv2.VideoCapture(str(normalized))
        count, width, height = [int(cap.get(p)) for p in [cv2.CAP_PROP_FRAME_COUNT, cv2.CAP_PROP_FRAME_WIDTH, cv2.CAP_PROP_FRAME_HEIGHT]]
        cap.release()
        boxes, kp, features, rotations = preprocess(normalized, work, args.batch_size, args.static_camera)
        assert count == len(boxes) == len(kp) == len(features) == len(rotations)
        if args.preprocess_only:
            continue
        body_model = repo / 'inputs/checkpoints/body_models/smplx/SMPLX_NEUTRAL.npz'
        if not body_model.exists():
            raise FileNotFoundError(f'Licensed SMPL-X model required at {body_model}. Download from https://smpl-x.is.tue.mpg.de/')
        import numpy as np
        # A black outro has no recoverable pose. Exclude it from the temporal
        # network, then hold the final recovered pose through the video endpoint.
        valid_source = np.flatnonzero(~np.array(info['blank_frames']))
        if not len(valid_source):
            raise ValueError(f'No visible image content in {video}')
        last_valid_end = (info['timestamps'][valid_source[-1] + 1] - info['first_pts']
                          if valid_source[-1] + 1 < len(info['timestamps']) else info['duration'])
        valid_count = min(count, math.ceil(last_valid_end * 30 - 1e-7))
        data = dict(length=torch.tensor(valid_count), bbx_xys=boxes[:valid_count], kp2d=kp[:valid_count],
                    K_fullimg=estimate_K(width, height).repeat(valid_count, 1, 1),
                    cam_angvel=compute_cam_angvel(rotations[:valid_count]), f_imgseq=features[:valid_count])
        result = work / 'hmr4d_results.pt'
        pred = torch.load(result, map_location='cpu') if result.exists() else predict(data, result, repo, args.static_camera)
        if valid_count < count:
            def pad(value):
                return torch.cat([value, value[-1:].expand(count - len(value), *value.shape[1:])])
            pred['smpl_params_global'] = {k: pad(v) for k, v in pred['smpl_params_global'].items()}
            for key in ['joints_global', 'rotations_global']:
                pred[key] = pad(pred[key])
        motion = video.with_suffix('.gvhmr.npz')
        meta = {k: v for k, v in info.items() if k not in {'timestamps', 'blank_frames'}}
        meta.update(inference_fps=30, inference_frames=count, static_camera=args.static_camera,
                    recovered_frames=valid_count, held_black_outro_frames=count - valid_count,
                    checkpoints_sha256=verified_weights,
                    gvhmr_commit=subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip(),
                    character=str(args.character.resolve()), character_sha256=sha256(args.character),
                    body_model_sha256=sha256(body_model))
        np.savez_compressed(motion, **{k: v.numpy() for k, v in pred['smpl_params_global'].items()},
                            joints_global=pred['joints_global'].numpy(), rotations_global=pred['rotations_global'].numpy(),
                            rest_joints=pred['rest_joints'].numpy(), duration=info['duration'], fps=30.,
                            source_timestamps=np.array(info['timestamps']) - info['first_pts'])
        video.with_suffix('.gvhmr.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
        subprocess.run([str(args.blender.resolve()), '--background', '--python-exit-code', '1', '--python',
                        str(ROOT / 'scripts/gvhmr_retarget.py'), '--', '--input', str(motion),
                        '--character', str(args.character.resolve()), '--output', str(video.with_suffix('.gvhmr.fbx'))], check=True)


if __name__ == '__main__':
    main()
