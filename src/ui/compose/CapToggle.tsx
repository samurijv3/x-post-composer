export function CapToggle({
  charCap,
  setCharCap,
}: {
  charCap: boolean;
  setCharCap: (v: boolean) => void;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={charCap} onChange={(e) => setCharCap(e.target.checked)} />
      <span className="track" />
      <span>Keep under 280</span>
    </label>
  );
}
