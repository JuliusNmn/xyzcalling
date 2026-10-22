# Vulkan investigation, 21 October 2026

## Status

Static comparison completed for 17 saved project files: 15 files recursively
inside Backup (including duplicate saves), plus TD.toe and TD.13.toe in the
project root. All were successfully expanded by Derivative's bundled toeexpand.
This establishes readability of the saved networks, not runtime correctness.

Moritz reports Backup/TD.7.toe works and subsequently reports that Backup/TD.9.toe
also seemed to stay open. TD.9 already includes the Normal POP, scene rendering
and OSC-driven animation index. This weakens the Normal-POP-only hypothesis.
Duration, scene activity and interaction conditions of the TD.9 observation
are not yet established. The exact Vulkan error and a controlled runtime
reproduction are still missing. No cause is confirmed.

Original snapshot SHA-256 hashes were checked after the analysis: unchanged.
Full inventory, hashes and expanded-file comparisons: backup_audit.json.
Expanded diagnostic data: /private/tmp/td-vulkan-audit.v7mISp (temporary).

## Relevant version changes

| Save | Nodes | Relevant saved changes |
| --- | ---: | --- |
| TD.1 | 260 | Earlier metadata/scene setup |
| TD.2 | 452 | One FBX and one Render TOP |
| TD.3 | 477 | Still one FBX and one Render TOP |
| TD.4 | 703 | Three FBXs and three Render TOPs |
| TD.5 | 709 | Three FBXs and three Render TOPs |
| TD.6 | 714 | Three FBXs and three Render TOPs |
| TD.7 | 944 | Four FBXs, four Render TOPs; user-confirmed working |
| TD.8 | 975 | First-of-the-Year FBX moved into scene; Normal POP inserted; new camera/light/Render TOP |
| TD.9 | 984 | Playback index driven by OSC seconds; lookup/crossfade nodes added; user reports it seemed to stay open |
| TD.10 | 1017 | Point-sprite particle network added under firstoftheyear/geo4 |
| TD.11, nested Backup | 1018 | Normal POP and particle branch remain |
| TD.13, Backup | 1024 | Normal POP and particle branch remain; same hash as Backup/TD.toe |
| TD.12, nested Backup | 1018 | Later save time than TD.13; same hash as its neighbouring TD.toe |
| Root TD.toe / TD.13.toe | 1015 | Identical files, separate branch of saved edits |

File numbers are not a reliable chronological ordering: nested backup saves
were made later. See timestamps in the JSON inventory.

## First useful comparison: TD.7 versus TD.8

The First-of-the-Year FBX is already present in TD.7 at /project1/base2.
In TD.8 it is under /project1/scenes/firstoftheyear and has a new render setup.
The geometry path changes from:

    Ch03/mesh -> Ch03/deform

to:

    Ch03/mesh -> Ch03/normal1 -> Ch03/deform

Here mesh is an Import Select POP and deform is a Skin Deform POP, not a
Deform SOP. normal1 is a Normal POP with tangents set to computeifnone.
This added GPU calculation is a useful first isolation target, not proof of
a Normal POP bug. Rendering/viewing the newly moved geometry is another
possible trigger.

Other changes: FBX importscale becomes 0.01; Ch03 scale becomes 0.01 per axis.
The imported Phong material and animation parameters are unchanged in this
7-to-8 comparison. The new Render TOP is 1280 x 720, not an extreme resolution.

TD.9 introduces a variable animation index from OSC. TD.10 adds a particle
system with maxparticles 10000, birthrate 100 and life 17. These are additional
isolation targets only if the first render-stage test still fails.

## Non-destructive test prepared

Priority update after the TD.9 report: first compare TD.9 with TD.10 under
matching playback, scene and viewer conditions. The particle system introduced
in TD.10 is now a more useful isolation target than the earlier Normal POP.
Staying open alone does not establish that all branches cooked successfully.
The Normal-bypass copy below remains an earlier diagnostic artifact, not the
preferred next test and not a verified fix.

    Backup/TD.8.normal-bypass-test.toe

This is a copy of TD.8, with only:

    .../Ch03/normal1: bypass = on

changed. No nodes were removed, no paths rewritten and no particle, material,
camera, scale or animation settings altered. Re-expansion verified exactly
one changed serialized parameter file and zero added/removed files.

The test copy has NOT been opened or rendered by this investigation. It is
not a verified fix. It is beside the source backup to preserve its project
folder context for relative asset paths.

Suggested test: save any current prep, run only one TD instance, open TD.8
and the bypass copy separately under the same scene/playback/viewer conditions.
If original TD.8 does not fail, the comparison does not isolate the later bug.
If TD.8 fails and the bypass copy remains stable, investigate Normal POP
normals/tangents and viewport interaction next. If both fail, isolate skin
deformation/rendering rather than attributing the issue to Normal POP.

## Runtime and environment limits

- Saved build: 2025.31550; saved OS: macOS 15.7.9.
- Two TD processes were observed during inspection; neither was stopped.
- The internal disk had about 14 GiB available during this investigation,
  unlike the earlier full-disk download failure. This does not measure GPU memory.
- The T7 was mounted again when checked. FBX source paths reference it.
- No matching TD crash report was found in the user's DiagnosticReports
  directory, and the old TDLogs files matching TD* did not contain this error.
- Exact VK_ERROR code, GPU memory use, repeatability and first failing save
  remain unknown. No app update, preference reset or live project change made.

## Primary documentation consulted

- https://derivative.ca/UserGuide/Toeexpand
- https://derivative.ca/UserGuide/Normal_POP
- https://derivative.ca/UserGuide/MacOS
- https://derivative.ca/UserGuide/Release_Notes/2025.30000

Derivative documents unsupported atomic-float calculations on macOS and
subsequent POP fixes in newer builds. These are background constraints,
not evidence that this particular patch selected an unsupported technique.
Do not change TD builds and patch structure simultaneously during isolation.

## Subsequent failure evidence, approximately 23:54 Amsterdam time

Moritz supplied three dialogs in order: a generic fatal Vulkan Device Error,
a Fatal Error with an attempted CrashAutoSave.TD.10.toe save, and another Vulkan
Device Error. No explicit VK_ERROR enumeration is visible. This may be one
failure and cascading shutdown errors, not three independent crashes.

Reported trigger: zooming out of geo4 while its Allow Cooking flag was OFF.
Moritz explicitly confirmed Allow Cooking, not merely Render/Display off.
Stopping both the FBX and geo4 restored 60 FPS. This isolates an affected
combined workload, but not which branch is slow, nor the exact crash cause.
Do not dismiss the report by assuming Allow Cooking was left on.

The zoom/viewport trigger makes cached GPU resources, viewer handling or
driver synchronization plausible candidates, not verified diagnoses. Earlier
screenshots also showed a long bounding-box operation and, separately,
159.790 ms in Preparing frame for presentation. The latter may include waiting
for GPU work and does not identify the operator responsible.

At the time of the follow-up filesystem checks, the announced crash autosave
was not found under the project and no TouchDesigner report was found in the
user's DiagnosticReports directory. A dialog promising an attempted save is
not proof that the save succeeded.

### More focused test copy

    Backup/TD.10.surface-sprinkle-test.toe

Saved TD.10 uses geo4/sprinkle1 with method vol (Volume), taking copy1 as its
input. The test copy changes only this method to perprim (Per Primitive).
This changes emission from interior volume sampling to surface sampling.
It avoids the volume sampling algorithm but is NOT a verified performance
or stability fix. Re-expansion confirmed one changed file with exactly that
parameter substitution; original snapshot hashes remain unchanged.

Test branches separately after a clean launch: FBX on with geo4 Allow Cooking
off, then geo4 on with the surface-sampling variant. Keep display/viewer and
playback conditions comparable. If the FBX-only case is already slow, do not
attribute the slowdown solely to the particles.

Relevant documentation:
https://derivative.ca/UserGuide/Sprinkle_POP

Later official release notes list fixes to several POP/viewer and particle
paths, so testing a copy under a newer official build is an additional option.
No update has been installed and no exact matching fixed bug was established.
