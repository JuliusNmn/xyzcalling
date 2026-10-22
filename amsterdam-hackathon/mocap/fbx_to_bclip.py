"""Extract densely baked FBX curves into TD's sampled channel-only bclip format.

The bcli chunk layout is inferred from the user's TD 2025.31550 pattern1.bclip.
This is not a general FBX evaluator: sparse nonlinear curves/layer blends fail.
"""

import argparse
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import zlib

TICKS = 46186158000


@dataclass
class Node:
    name: str
    props: list
    children: list

    def child(self, name):
        return next(n for n in self.children if n.name == name)


def read_fbx(path):
    raw = path.read_bytes()
    if raw[:23] != b'Kaydara FBX Binary  \x00\x1a\x00':
        raise ValueError('Expected binary FBX')
    version = struct.unpack_from('<I', raw, 23)[0]
    header = struct.Struct('<QQQB' if version >= 7500 else '<IIIB')

    def props(start, count):
        result, pos = [], start
        for _ in range(count):
            tag = chr(raw[pos]); pos += 1
            if tag in 'YCFDIL':
                fmt = {'Y': 'h', 'C': '?', 'F': 'f', 'D': 'd', 'I': 'i', 'L': 'q'}[tag]
                result.append(struct.unpack_from('<' + fmt, raw, pos)[0])
                pos += struct.calcsize(fmt)
            elif tag in 'SR':
                size = struct.unpack_from('<I', raw, pos)[0]; pos += 4
                value = raw[pos:pos + size]; pos += size
                result.append(value.decode('utf-8', errors='strict') if tag == 'S' else value)
            elif tag in 'fdlibc':
                count_, encoding, size = struct.unpack_from('<III', raw, pos); pos += 12
                value = raw[pos:pos + size]; pos += size
                if encoding not in (0, 1):
                    raise ValueError('Unsupported FBX array encoding')
                if encoding:
                    value = zlib.decompress(value)
                fmt = {'f': 'f', 'd': 'd', 'l': 'q', 'i': 'i', 'b': '?', 'c': 'b'}[tag]
                result.append(struct.unpack('<' + str(count_) + fmt, value))
            else:
                raise ValueError(f'Unsupported FBX property {tag!r}')
        return result

    def node(pos):
        end, count, size, name_len = header.unpack_from(raw, pos)
        if end == 0:
            return None, pos + header.size
        if not pos < end <= len(raw):
            raise ValueError('Invalid FBX offset')
        pos += header.size
        name = raw[pos:pos + name_len].decode(); pos += name_len
        # Mesh data is irrelevant and expensive to decompress.
        values = [] if name in {'Vertices', 'PolygonVertexIndex', 'Normals', 'UV', 'UVIndex', 'Tangents', 'Binormals'} else props(pos, count)
        pos += size
        children = []
        while pos < end:
            child, pos = node(pos)
            if child is None:
                break
            children.append(child)
        if pos != end:
            raise ValueError('Invalid FBX node boundary')
        return Node(name, values, children), end

    roots, pos = [], 27
    while True:
        item, pos = node(pos)
        if item is None:
            break
        roots.append(item)
    return {n.name: n for n in roots}


def extract(path, take=None, include_static=True):
    roots = read_fbx(path)
    objects = {n.props[0]: n for n in roots['Objects'].children}
    connections = [n.props for n in roots['Connections'].children if n.name == 'C']
    stacks = {i: n for i, n in objects.items() if n.name == 'AnimationStack'}
    names = lambda n: n.props[1].split('\x00')[0]
    layer_to_stack = {c[1]: c[2] for c in connections if c[0] == 'OO'
                      and c[1] in objects and objects[c[1]].name == 'AnimationLayer'
                      and c[2] in stacks}
    node_layer = {c[1]: c[2] for c in connections if c[0] == 'OO'
                  and c[1] in objects and objects[c[1]].name == 'AnimationCurveNode'
                  and c[2] in layer_to_stack}
    active = {layer_to_stack[layer] for layer in node_layer.values()}
    if take:
        active = {i for i in active if names(stacks[i]) == take}
    if len(active) != 1:
        raise ValueError(f'Specify a single nonempty take: {[names(stacks[i]) for i in active]}')
    stack = next(iter(active))
    layers = {layer for layer, s in layer_to_stack.items() if s == stack}
    if len(layers) != 1:
        raise ValueError('Multiple animation layers need FBX evaluation; refusing to flatten blindly')
    curve_nodes = {i for i, layer in node_layer.items() if layer in layers}
    targets = {c[1]: (c[2], c[3]) for c in connections if c[0] == 'OP'
               and c[1] in curve_nodes and c[2] in objects and objects[c[2]].name == 'Model'}
    tracks = []
    for c in connections:
        if c[0] != 'OP' or c[2] not in targets or c[1] not in objects:
            continue
        curve = objects[c[1]]
        if curve.name != 'AnimationCurve':
            continue
        model, prop = targets[c[2]]
        prefix = {'Lcl Translation': 't', 'Lcl Rotation': 'r', 'Lcl Scaling': 's'}.get(prop)
        axis = c[3].split('|')[-1].lower()
        if prefix is None or axis not in 'xyz' or len(axis) != 1:
            raise ValueError(f'Unsupported animated property {prop}, {c[3]}')
        model_name = re.sub(r'[^A-Za-z0-9_]', '_', names(objects[model]))
        times = curve.child('KeyTime').props[0]
        values = curve.child('KeyValueFloat').props[0]
        if not times or len(times) != len(values) or not all(math.isfinite(v) for v in values):
            raise ValueError('Invalid FBX curve')
        tracks.append((f'{model_name}:{prefix}{axis}', times, values))
    if not tracks:
        raise ValueError('No transform curves connected to the selected take')
    settings = {n.props[0]: n.props[-1] for n in roots['GlobalSettings'].child('Properties70').children if n.name == 'P'}
    fps = {0: 30, 1: 120, 2: 100, 3: 60, 4: 50, 5: 48, 6: 30,
           7: 30, 8: 30000 / 1001, 9: 30000 / 1001, 10: 25, 11: 24,
           12: 1000, 13: 24000 / 1001, 14: settings.get('CustomFrameRate')}.get(settings.get('TimeMode'))
    if fps is None or fps <= 0:
        raise ValueError('Unknown FBX FPS')
    first = min(t[0] for _, t, _ in tracks)
    last = max(t[-1] for _, t, _ in tracks)
    count = round((last - first) * fps / TICKS) + 1
    grid = [round(first + i * TICKS / fps) for i in range(count)]
    channels, skipped = {}, []
    for name, times, values in tracks:
        constant = max(values) - min(values) < 1e-6
        if constant and not include_static:
            skipped.append(name)
            continue
        if constant:
            sampled = [values[0]] * count
        else:
            by_frame = {}
            for time, value in zip(times, values):
                index = round((time - first) * fps / TICKS)
                # Some FBX keys were converted through float seconds: allow
                # tiny quantization drift, never a meaningful subframe shift.
                if index < 0 or index >= count or abs(time - grid[index]) > max(10, TICKS / fps * 1e-4):
                    raise ValueError(f'Curve {name} is not densely baked on the FPS grid')
                by_frame[index] = value
            if len(by_frame) != count:
                raise ValueError(f'Sparse nonlinear curve {name}; bake with FBX SDK before conversion')
            sampled = [by_frame[i] for i in range(count)]
        if name in channels:
            raise ValueError(f'Channel name collision: {name}')
        channels[name] = sampled
    if not channels:
        raise ValueError('No selected channels')
    return fps, channels, {'take': names(stacks[stack]), 'fps': fps,
                           'samples': count, 'first_key_seconds': first / TICKS,
                           'last_key_seconds': last / TICKS,
                           'curve_channels': len(tracks), 'channels': len(channels),
                           'static_channels_omitted': skipped,
                           'rotation_units': 'degrees, unchanged FBX Lcl Rotation',
                           'translation_units': 'unchanged FBX source units',
                           'start_index': 0}


def chunk(tag, payload=b''):
    return struct.pack('>II', len(payload) + 8, tag) + payload


def encode_bclip(rate, channels, start=0, extends=(2, 2), default=0):
    count = len(next(iter(channels.values())))
    tracks = bytearray(struct.pack('>I', len(channels)))
    for name, values in channels.items():
        encoded = name.encode('utf-8')
        if len(encoded) > 65535 or len(values) != count:
            raise ValueError('Invalid bclip name or sample count')
        if not all(math.isfinite(x) for x in values):
            raise ValueError('Nonfinite sample')
        tracks.extend(chunk(0x100001, struct.pack('>H', len(encoded)) + encoded))
        tracks.extend(chunk(0x100003, struct.pack('>I', extends[0])))
        tracks.extend(chunk(0x100004, struct.pack('>I', extends[1])))
        tracks.extend(chunk(0x100005, struct.pack('>f', default)))
        tracks.extend(chunk(0x100002, struct.pack('>' + str(count) + 'f', *values)))
        tracks.extend(chunk(0x100000))
    return (b'bcli' + chunk(0xf0001, struct.pack('>f', rate))
            + chunk(0xf0002, struct.pack('>d', start))
            + chunk(0xf0003, struct.pack('>I', count))
            + chunk(0xf0005, tracks) + chunk(0xf0000))


def decode_bclip(raw):
    if raw[:4] != b'bcli':
        raise ValueError('Not a TD bcli file')
    rate, start, count, channels, extends, default = None, None, None, {}, None, None
    p = 4
    while p < len(raw):
        length, tag = struct.unpack_from('>II', raw, p)
        if length < 8 or p + length > len(raw):
            raise ValueError('Invalid chunk boundary')
        value = raw[p + 8:p + length]
        if tag == 0xf0001: rate = struct.unpack('>f', value)[0]
        elif tag == 0xf0002: start = struct.unpack('>d', value)[0]
        elif tag == 0xf0003: count = struct.unpack('>I', value)[0]
        elif tag == 0xf0005:
            declared = struct.unpack_from('>I', value)[0]
            q, name, ends = 4, None, []
            while q < len(value):
                size, subtag = struct.unpack_from('>II', value, q)
                if size < 8 or q + size > len(value):
                    raise ValueError('Invalid track chunk')
                data = value[q + 8:q + size]
                if subtag == 0x100001:
                    name_len = struct.unpack_from('>H', data)[0]
                    name = data[2:2 + name_len].decode()
                    ends = []
                elif subtag in (0x100003, 0x100004): ends.append(struct.unpack('>I', data)[0])
                elif subtag == 0x100005: default = struct.unpack('>f', data)[0]
                elif subtag == 0x100002:
                    channels[name] = list(struct.unpack('>' + str(count) + 'f', data))
                elif subtag == 0x100000: extends = tuple(ends)
                else: raise ValueError(f'Unknown track chunk {subtag:x}')
                q += size
            if len(channels) != declared:
                raise ValueError('Channel count mismatch')
        elif tag != 0xf0000:
            raise ValueError(f'Unknown root chunk {tag:x}')
        p += length
    return rate, start, channels, extends, default


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--take')
    parser.add_argument('--animated-only', action='store_true', help='Omit constant authored tracks; can lose fixed finger poses')
    parser.add_argument('--replace-generated', action='store_true', help='Replace only an unchanged output generated from this exact source')
    args = parser.parse_args()
    if args.output.exists():
        manifest = args.output.with_suffix('.json')
        if not args.replace_generated or not manifest.exists():
            raise FileExistsError(args.output)
        old = json.loads(manifest.read_text())
        if (old.get('source_sha256') != hashlib.sha256(args.source.read_bytes()).hexdigest()
                or old.get('output_sha256') != hashlib.sha256(args.output.read_bytes()).hexdigest()):
            raise ValueError('Existing output or source changed; refusing replacement')
    rate, channels, report = extract(args.source, args.take, not args.animated_only)
    raw = encode_bclip(rate, channels)
    decoded = decode_bclip(raw)
    assert decoded[0] == rate and decoded[2] == channels
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(raw)
    report.update({'source': str(args.source.resolve()), 'output': str(args.output.resolve()),
                   'source_sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
                   'output_sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
                   'channel_names': list(channels),
                   'native_TD_validation': 'pending'})
    args.output.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if not isinstance(v, list)}, indent=2))


if __name__ == '__main__':
    main()
