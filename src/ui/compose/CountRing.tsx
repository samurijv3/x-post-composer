/**
 * The X-style character count ring (22×22, r=9 → circumference ≈56.5).
 * The dial ALWAYS measures against 280 — the only number with shared
 * meaning. Blue arc within it; solid red when over the active limit;
 * full-but-neutral once an UNCAPPED draft passes 280 (maxed dial, no
 * alarm — long-form was chosen); solid green once the draft commits.
 */
const CIRCUMFERENCE = 56.5;

export function CountRing({
  count,
  limit,
  over,
  beyond,
  committed,
}: {
  count: number;
  /** The dial's scale — X_HARD_LIMIT in practice. */
  limit: number;
  /** Red: past the limit that's actually enforced right now. */
  over: boolean;
  /** Neutral-full: uncapped and past 280 but inside the soft cap. */
  beyond: boolean;
  committed: boolean;
}) {
  const progress = Math.min(count / Math.max(limit, 1), 1) * CIRCUMFERENCE;
  const tone = committed ? 'is-committed' : over ? 'is-over' : beyond ? 'is-beyond' : '';
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
