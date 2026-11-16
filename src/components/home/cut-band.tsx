// The logo's idea at page width: three timeline tracks cut once by a leaning razor cut. Like the mark, each track's
// cut sits a little further left than the one above, and everything after the cut takes the blue. Plain blocks with
// clip-path, so the cut keeps its angle at any width.
export function CutBand({ tracks = 3, className }: { tracks?: number; className?: string }) {
  return (
    <div className={`h-cutBand ${className ?? ""}`} aria-hidden="true">
      {Array.from({ length: tracks }, (_, i) => (
        <div key={i} className="h-cutTrack" style={{ "--i": i } as React.CSSProperties}>
          <span className="h-cutBefore" />
          <span className="h-cutAfter" />
        </div>
      ))}
    </div>
  );
}
