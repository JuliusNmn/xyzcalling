"""Download public checkpoints from the mirror used by the official linked demo.

SMPL-X is intentionally excluded: obtain it from the licensed publisher.
Source: https://huggingface.co/spaces/LittleFrog/GVHMR/blob/main/app.py
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import time
from urllib.parse import quote
import requests

ROOT = Path(__file__).resolve().parents[1] / 'artifacts/GVHMR/inputs/checkpoints'
FILES = {
    'gvhmr/gvhmr_siga24_release.ckpt': (163508011, '4fae7da2de388d5da3514cb27a2d003f364dacb280e9cf88972b710e589c6b91'),
    'yolo/yolov8x.pt': (136867539, 'c4d5a3f000d771762f03fc8b57ebd0aae324aeaefdd6e68492a9c4470f2d1e8b'),
    'vitpose/vitpose-h-multi-coco.pth': (2549075546, '50e33f4077ef2a6bcfd7110c58742b24c5859b7798fb0eedd6d2215e0a8980bc'),
    'hmr2/epoch=10-step=25000.ckpt': (2709494041, '2dcf79638109781d1ae5f5c44fee5f55bc83291c210653feead9b7f04fa6f20e'),
}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def download(name):
    size, expected = FILES[name]
    target = ROOT / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size == size and digest(target) == expected:
        print(f'Verified {name}', flush=True)
        return
    if target.exists():
        raise RuntimeError(f'Existing checkpoint failed integrity verification: {target}. Remove or repair that file before redownloading; it will not be silently used.')
    partial = target.with_suffix(target.suffix + '.partial')
    url = 'https://huggingface.co/camenduru/GVHMR/resolve/main/' + quote(name)
    for attempt in range(5):
        offset = partial.stat().st_size if partial.exists() else 0
        if offset == size:
            break
        try:
            # A fresh query avoids an expired cached signed redirect.
            response = requests.get(url, params={'download': 'true', 't': int(time.time())},
                                    headers={'Range': f'bytes={offset}-'} if offset else {},
                                    stream=True, timeout=(30, 90))
            response.raise_for_status()
            mode = 'ab' if response.status_code == 206 else 'wb'
            done = offset if mode == 'ab' else 0
            tick = time.monotonic()
            with response, partial.open(mode) as f:
                for chunk in response.iter_content(4 * 1024 * 1024):
                    f.write(chunk)
                    done += len(chunk)
                    if time.monotonic() - tick > 20:
                        print(f'{name}: {done / size:.0%}', flush=True)
                        tick = time.monotonic()
            break
        except requests.RequestException as e:
            print(f'{name}: retry {attempt + 1} ({type(e).__name__})', flush=True)
            if attempt == 4:
                raise
    if partial.stat().st_size != size or digest(partial) != expected:
        raise RuntimeError(f'Checkpoint integrity check failed: {name}')
    partial.replace(target)
    print(f'Downloaded and SHA256 verified: {name}', flush=True)


if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(download, FILES))
