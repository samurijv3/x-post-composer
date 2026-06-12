/**
 * The X-style character count ring (22×22, r=9 → circumference ≈56.5).
 * Blue arc tracking count/limit; solid red when over; solid green once
 * the draft commits — green as status, never a fill.
 */
const CIRCUMFERENCE = 56.5;

export function CountRing({
  count,
  limit,
  over,
  committed,
}: {
  count: number;
  limit: number;
  over: boolean;
  committed: boolean;
}) {
  const progress = Math.min(count / Math.max(limit, 1), 1) * CIRCUMFERENCE;
  const tone = committed ? 'is-committed' : over ? 'is-over' : '';
  return (
    <svg className={`ring ${tone}`} viewBox="0 0 22 22" aria-hidden="true">
      <circle className="ring-track" cx="11" cy="11" r="9" />
      <circle
        className="ring-bar"
        cx="11"
        cy="11"
        r="9"
        strokeDasharray={`${String(progress)} ${String(CIRCUMFERENCE)}`}
      />
    </svg>
  );
}
