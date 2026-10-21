"""Remove unused GUI imports and defer optional native PyTorch3D operations."""
from pathlib import Path


def patch(repo):
    body = Path(repo) / 'hmr4d/utils/body_model/body_model.py'
    body.write_text(body.read_text(encoding='utf-8').replace('from turtle import forward\n', ''), encoding='utf-8')
    matcher = Path(repo) / 'hmr4d/utils/preproc/relpose/model/cv2_matcher.py'
    source = matcher.read_text(encoding='utf-8')
    marker = '        # Match descriptors using FLANN matcher (better for SIFT)'
    if '# Pose Studio: featureless-frame guard' not in source:
        source = source.replace(marker, '        # Pose Studio: featureless-frame guard\n'
            '        if des0 is None or des1 is None or len(des0) < 2 or len(des1) < 2:\n'
            '            return np.empty((0, 2), dtype=np.float32), np.empty((0, 2), dtype=np.float32)\n\n' + marker)
        matcher.write_text(source, encoding='utf-8')
    solver = Path(repo) / 'hmr4d/utils/preproc/relpose/solver_two_view.py'
    source = solver.read_text(encoding='utf-8')
    if '# Pose Studio: unobservable camera guard' not in source:
        source = source.replace('        matches = np.stack(',
            '        # Pose Studio: unobservable camera guard\n'
            '        if len(pts0) < 8 or len(pts1) < 8:\n'
            '            print("[SimpleVO] No camera evidence; holding previous orientation")\n'
            '            return np.eye(4)\n'
            '        matches = np.stack(')
        source = source.replace('        # cam2_from_cam1 means',
            '        if answer.cam2_from_cam1 is None:\n'
            '            print("[SimpleVO] Unsolved camera; holding previous orientation")\n'
            '            return np.eye(4)\n\n'
            '        # cam2_from_cam1 means')
        solver.write_text(source, encoding='utf-8')
    path = Path(repo) / 'hmr4d/utils/geo_transform.py'
    source = path.read_text(encoding='utf-8')
    old = 'import pytorch3d.ops.knn as knn\n'
    call = '        squared_dist, _, _ = knn.knn_points('
    if source.startswith('# Pose Studio: lazy optional KNN import\n'):
        return
    if source.count(old) != 1 or source.count(call) != 1:
        raise RuntimeError('GVHMR source differs from the pinned revision; review compatibility patch')
    source = source.replace(old, '').replace(call, '        import pytorch3d.ops.knn as knn\n' + call)
    path.write_text('# Pose Studio: lazy optional KNN import\n' + source, encoding='utf-8')


if __name__ == '__main__':
    patch(Path(__file__).resolve().parents[1] / 'artifacts/GVHMR')
