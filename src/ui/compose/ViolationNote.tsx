import type { Span } from '../../lib/exclusion';
import { describeViolations } from '../../lib/exclusion';
import { IcWarn } from '../icons';

/**
 * Explains the highlight marks: which of the user's style rules the
 * highlighted text breaks, that a repair pass already ran (true by
 * construction — residual violations only exist after it), and both
 * exits. Also the only place violations are announced to screen
 * readers — the highlight backdrop is aria-hidden. Renders nothing
 * once a hand edit clears the spans, exactly like the marks.
 */
export function ViolationNote({ violations }: { violations: Span[] }) {
  if (violations.length === 0) return null;
  return (
    <div className="callout warn violation-note">
      <IcWarn />
      <span>
        Highlighted: <strong>{describeViolations(violations)}</strong> — your style rules, left
        unresolved by the repair pass. Fix by hand (editing clears the marks) or regenerate.
      </span>
    </div>
  );
}
