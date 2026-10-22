"""Strip FBX mesh payloads without rebaking or altering skeletal animation data."""

import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import struct


@dataclass
class Node:
    name: bytes
    count: int
    props: bytes
    children: list
    terminated: bool


def scalar_properties(node):
    values, pos = [], 0
    for _ in range(node.count):
        tag = chr(node.props[pos])
        pos += 1
        if tag in 'YCFDIL':
            fmt = {'Y': 'h', 'C': '?', 'F': 'f', 'D': 'd', 'I': 'i', 'L': 'q'}[tag]
            values.append(struct.unpack_from('<' + fmt, node.props, pos)[0])
            pos += struct.calcsize(fmt)
        elif tag in 'SR':
            size = struct.unpack_from('<I', node.props, pos)[0]
            pos += 4
            value = node.props[pos:pos + size]
            values.append(value.decode('utf-8', errors='replace') if tag == 'S' else value)
            pos += size
        else:
            raise ValueError(f'Unexpected non-scalar property in {node.name!r}')
    return values


def strip(source, output):
    if output.exists():
        raise FileExistsError(output)
    raw = source.read_bytes()
    if raw[:23] != b'Kaydara FBX Binary  \x00\x1a\x00':
        raise ValueError('Only binary FBX is supported')
    version = struct.unpack_from('<I', raw, 23)[0]
    header = struct.Struct('<QQQB' if version >= 7500 else '<IIIB')

    def read(pos):
        end, count, size, name_len = header.unpack_from(raw, pos)
        if end == 0:
            return None, pos + header.size
        if not pos < end <= len(raw):
            raise ValueError('Invalid FBX node offset')
        pos += header.size
        name = raw[pos:pos + name_len]
        pos += name_len
        props = raw[pos:pos + size]
        pos += size
        children, terminated = [], False
        while pos < end:
            child, pos = read(pos)
            if child is None:
                terminated = True
                break
            children.append(child)
        if pos != end:
            raise ValueError('Invalid FBX child boundary')
        return Node(name, count, props, children, terminated), end

    roots, pos = [], 27
    while True:
        node, pos = read(pos)
        if node is None:
            break
        roots.append(node)
    footer = raw[pos:]
    objects = next(n for n in roots if n.name == b'Objects')
    removed, retained = set(), []
    for node in objects.children:
        values = scalar_properties(node)
        remove = node.name in {b'Geometry', b'Material', b'Texture', b'Video', b'Deformer', b'Pose'}
        if node.name == b'Model' and values[2] in {'Mesh', 'Camera', 'Light'}:
            remove = True
        if node.name == b'NodeAttribute' and values[2] in {'Mesh', 'Camera', 'Light'}:
            remove = True
        if remove:
            removed.add(values[0])
        else:
            retained.append(node)
    objects.children = retained
    connections = next(n for n in roots if n.name == b'Connections')
    connections.children = [n for n in connections.children
                            if not (set(scalar_properties(n)[1:3]) & removed)]

    def encode(node, offset):
        start = offset + header.size + len(node.name) + len(node.props)
        children = bytearray()
        for child in node.children:
            children.extend(encode(child, start + len(children)))
        if node.terminated:
            children.extend(bytes(header.size))
        end = start + len(children)
        return (header.pack(end, node.count, len(node.props), len(node.name))
                + node.name + node.props + children)

    encoded = bytearray(raw[:27])
    for node in roots:
        encoded.extend(encode(node, len(encoded)))
    encoded.extend(bytes(header.size))
    encoded.extend(footer)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(encoded)
    report = {'source': str(source.resolve()), 'output': str(output.resolve()),
              'source_sha256': hashlib.sha256(raw).hexdigest(),
              'output_sha256': hashlib.sha256(encoded).hexdigest(),
              'original_bytes': len(raw), 'animation_only_bytes': len(encoded),
              'removed_objects': len(removed), 'retained_objects': len(retained),
              'fbx_version': version,
              'method': 'Opaque skeletal properties/curve arrays retained; object references pruned; offsets rebuilt'}
    output.with_suffix('.strip.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    strip(args.source, args.output)
