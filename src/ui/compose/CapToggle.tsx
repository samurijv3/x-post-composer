/** The ≤ 280 cap as an X-style switch row item. Flipping it over an
 *  active over-cap draft fires the refit (ComposeScreen owns that). */
export function CapToggle({
  charCap,
  setCharCap,
}: {
  charCap: boolean;
  setCharCap: (v: boolean) => void;
}) {
  return (
    <label className="captoggle" title="Cap every post at X's 280-character limit">
      <span className="switch sm">
        <input type="checkbox" checked={charCap} onChange={(e) => setCharCap(e.target.checked)} />
        <span className="track" />
      </span>
      ≤ 280
    </label>
  );
}
