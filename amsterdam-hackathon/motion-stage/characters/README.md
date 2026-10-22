# Mixamo Ch20 character files

Both user-provided exports were moved from Downloads to the mounted project SSD
on 2026-10-22, with SHA-256 verification before removing the original files.
The FBX entries in this directory are symlinks to:

`/Volumes/T7-2tb-2509/Projects/amsterdam-hackathon/Characters`

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| Ch20_nonPBR.fbx | 52386304 | 7a4e977cf0639759edc6bedb874b79d74ce7d086b12b45ff5cfbeae20c510e63 |
| character.fbx | 52145408 | 6bcf2e9e0095c2d0f99762f82e976802c863d9169574c9c955e28b045f899ab8 |

Both have the Ch20 mesh and 65 bones prefixed `mixamorig6`. The non-PBR export
contains two animation clips; the character export contains none. Motion Stage
ignores target animation clips and drives both with the selected source motion.
Catalog: `../server/characters.js`.
