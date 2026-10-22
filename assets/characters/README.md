# Neutral low-poly mannequin

`neutral-low-poly.fbx` is the default offline GVHMR export character. It has
2,527 vertices and 4,810 triangles, one gray material, no textures, and a skinned
humanoid rig. The 22 body joints and finger bones use Mixamo names; this is a
Quaternius mannequin adapted for the exporter, not an Adobe Mixamo asset.

Source: Quaternius' **Universal Animation Library, Standard**, published by the
author under **CC0 1.0 Universal**:

- https://quaternius.com/packs/universalanimationlibrary.html
- https://opengameart.org/content/universal-animation-library
- https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip

The original license notice is included in `LICENSE-Quaternius.txt`. The original
mannequin has 13,744 triangles. The conversion removes all supplied animations,
renames the deform bones, collapses the rest mesh to 35%, retains skin weights,
and assigns a plain gray material. Body proportions and rest axes are retained.
The downloaded source archive's SHA256 is
`18ff1a7215f4852b320203e8aaf02a1578b5c8eef9027fbaedfcedc7b85a3ac2`.

Reproduce with Blender 4.2 after extracting the linked archive:

```powershell
& $blender --background --python-exit-code 1 --python scripts/prepare_neutral_character.py -- --source 'path/to/Animation Library[Standard]/Unity/AnimationLibrary_Unity_Standard.fbx'
```

Use `--character 'amsterdam-hackathon/Geo/Chicken Dance.fbx'` with the extractor
to retain the original textured character. The browser preview is unchanged.
