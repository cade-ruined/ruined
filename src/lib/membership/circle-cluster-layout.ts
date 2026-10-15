export type CircleClusterPosition = {
  left: number;
  top: number;
  size: number;
};

/** Keep the viewer in the center, independently of roster order or selection. */
export function circleClusterPositions(memberCount: number, viewerIndex: number): CircleClusterPosition[] {
  if (memberCount === 0) return [];
  const centerIndex = viewerIndex >= 0 && viewerIndex < memberCount ? viewerIndex : 0;
  const peers = memberCount - 1;
  const twoRings = memberCount > 13;
  const radius = peers <= 6 ? 33 : 35;
  // Neighboring portraits nearly touch. More members use the same centered
  // space, with smaller portraits instead of spilling into a second grid.
  const peerSize = peers <= 1 ? 32 : Math.min(31, 2 * radius * Math.sin(Math.PI / peers) * 0.96);
  const centerSize = twoRings ? 24 : peers === 0 ? 44 : Math.min(44, 2 * radius - peerSize - 2);
  const startAngle = peers === 1 ? 0 : peers === 2 ? 180 : peers === 4 ? -135 : -90;
  let peerIndex = 0;

  return Array.from({ length: memberCount }, (_, index) => {
    if (index === centerIndex) return { left: 50, top: 50, size: centerSize };
    const slot = peerIndex++;
    // A second ring keeps larger Circles usable on a phone without moving the
    // viewer or hiding members behind a "more" button.
    const innerRing = twoRings && slot < 6;
    const ringCount = twoRings ? innerRing ? 6 : peers - 6 : peers;
    const ringIndex = twoRings && !innerRing ? slot - 6 : slot;
    const ringRadius = twoRings ? innerRing ? 22.5 : 40 : radius;
    const ringStart = twoRings ? innerRing ? -90 : -60 : startAngle;
    const size = twoRings ? innerRing ? 20.5 : Math.min(18, 2 * ringRadius * Math.sin(Math.PI / ringCount) * 0.96) : peerSize;
    const angle = (ringStart + (360 * ringIndex) / ringCount) * Math.PI / 180;
    return {
      left: 50 + ringRadius * Math.cos(angle),
      top: 50 + ringRadius * Math.sin(angle),
      size,
    };
  });
}
