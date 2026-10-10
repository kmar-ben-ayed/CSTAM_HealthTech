/** Decorative specimen-label barcode derived from the claim ID (not a real symbology). */
export function Barcode({ value, height = 34 }: { value: string; height?: number }) {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  const push = (w: number, ink: boolean) => {
    if (ink) bars.push({ x, w });
    x += w;
  };
  push(2, true); push(1, false); push(1, true); push(2, false); // start guard
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    for (let b = 0; b < 3; b++) {
      push(((c >> (b * 2)) & 3) % 3 + 1, true);
      push(((c >> (b + 1)) & 1) + 1, false);
    }
  }
  push(2, true); push(1, false); push(1, true); // end guard
  return (
    <svg viewBox={`0 0 ${x} ${height}`} height={height} width={x * 1.15} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="currentColor" />
      ))}
    </svg>
  );
}
