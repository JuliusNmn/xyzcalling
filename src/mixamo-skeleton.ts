/** Body bones shared by the original character and the neutral mannequin.
 * Finger and end bones vary between otherwise compatible Mixamo rigs.
 */
export const MIXAMO_BODY = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  ...['Left', 'Right'].flatMap(side => ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase'].map(bone => side + bone))]
  .map(name => `mixamorig${name}`);

export function assertMixamoBody(names: Set<string>) {
  const missing = MIXAMO_BODY.filter(name => !names.has(name));
  if (missing.length) throw new Error(`Missing Mixamo bones: ${missing.join(', ')}`);
}
