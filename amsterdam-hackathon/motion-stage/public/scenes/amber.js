// Edit only this file to curate this scene. Save & reload in the preview editor.
// Coordinates: meters, Y up. ctx.group is removed automatically when switching scenes.
// update receives authoritative deck.time, deck.beat, deck.bpm and pose.worldPositions.
export default function createScene({ THREE, group, camera }) {
  const color = "#efb77f";
  // Example: add your objects to group. The character and five anchors are supplied.
  // const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicMaterial({ color }));
  // group.add(orb);
  return {
    color,
    wireframe: false,
    update(deck, deltaSeconds) {
      // const hand = deck.pose?.worldPositions.rightHand;
      // if (hand) orb.position.fromArray(hand);
      // orb.scale.setScalar(1 + 0.1 * Math.sin(deck.beat * Math.PI * 2));
    },
    dispose() { /* Dispose custom resources not attached to group here. */ }
  };
}
