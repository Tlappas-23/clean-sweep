// Monogram: the "CS" film-frame mark.
//
// Lifted out of the old landing page when the home screen became the Six
// Degrees board. It is the only piece of that page worth keeping: a small
// drawn mark rather than an image, so it is crisp at any size, inherits
// `currentColor`, and costs nothing to load.

export function Monogram() {
  const holes = [8, 18, 28, 38, 48];
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 56 44"
      width="56"
      height="44"
      className="text-accent"
    >
      <rect
        x="0.7"
        y="0.7"
        width="54.6"
        height="42.6"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.55"
      />
      <g fill="currentColor" opacity="0.4">
        {holes.map((x) => (
          <rect key={`t${x}`} x={x - 2} y="4.5" width="4" height="3" rx="1" />
        ))}
        {holes.map((x) => (
          <rect key={`b${x}`} x={x - 2} y="36.5" width="4" height="3" rx="1" />
        ))}
      </g>
      <text
        x="28"
        y="28"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontSize="17"
        letterSpacing="1.5"
        fill="currentColor"
      >
        CS
      </text>
    </svg>
  );
}
