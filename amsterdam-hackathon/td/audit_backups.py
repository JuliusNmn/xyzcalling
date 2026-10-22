"""Expand copies of saved TD patches and inventory changes without rendering."""
import hashlib
import json
from collections import Counter
from datetime import datetime
from pathlib import Path
import shutil
import subprocess
import sys

PROJECT = Path(__file__).resolve().parents[1]
EXPAND = '/Applications/TouchDesigner 2025.31550.app/Contents/MacOS/toeexpand'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    destination = Path(sys.argv[1]).resolve()
    sources = sorted((PROJECT / 'Backup').rglob('*.toe'), key=lambda p: p.stat().st_mtime)
    sources += [PROJECT / 'TD.toe', PROJECT / 'TD.13.toe']
    reports = []
    previous = {}
    for i, source in enumerate(sources):
        slot = destination / f'{i:02d}'
        slot.mkdir(parents=True, exist_ok=False)
        copied = slot / source.name
        shutil.copy2(source, copied)
        process = subprocess.run([EXPAND, copied.name], cwd=slot, capture_output=True, text=True)
        expanded = slot / (copied.name + '.dir')
        if not expanded.is_dir():
            raise RuntimeError(f'{source}: {process.stdout} {process.stderr}')
        files = {str(p.relative_to(expanded)): digest(p) for p in expanded.rglob('*') if p.is_file()}
        nodes = {}
        for p in expanded.rglob('*.n'):
            text = p.read_text(errors='replace')
            nodes[str(p.relative_to(expanded))[:-2]] = text.splitlines()[0] if text else ''
        report = {
            'source': str(source), 'sha256': digest(source),
            'modified': datetime.fromtimestamp(source.stat().st_mtime).astimezone().isoformat(),
            'expanded': str(expanded), 'file_count': len(files),
            'expanded_bytes': sum(p.stat().st_size for p in expanded.rglob('*') if p.is_file()),
            'node_count': len(nodes), 'node_types': dict(Counter(nodes.values())),
            'nodes': nodes,
            'added': sorted(files.keys() - previous.keys()),
            'removed': sorted(previous.keys() - files.keys()),
            'changed': sorted(k for k in files.keys() & previous.keys() if files[k] != previous[k]),
        }
        reports.append(report)
        previous = files
        print(source.relative_to(PROJECT), 'nodes', len(nodes), 'files', len(files),
              'added', len(report['added']), 'removed', len(report['removed']),
              'changed', len(report['changed']), flush=True)
    output = PROJECT / 'td' / 'backup_audit.json'
    output.write_text(json.dumps(reports, indent=2), encoding='utf-8')
    print('REPORT', output)


if __name__ == '__main__':
    main()
