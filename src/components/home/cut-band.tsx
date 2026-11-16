import styles from "./home.module.css";

// The logo's idea at page width: three timeline tracks cut once by a leaning razor cut. Like the mark, each track's
// cut sits a little further left than the one above, and everything after the cut takes the blue. Plain blocks with
// clip-path, so the cut keeps its angle at any width.
export function CutBand({ tracks = 3, className }: { tracks?: number; className?: string }) {
  return (
    <div className={`${styles.cutBand} ${className ?? ""}`} aria-hidden="true">
      {Array.from({ length: tracks }, (_, i) => (
        <div key={i} className={styles.cutTrack} style={{ "--i": i } as React.CSSProperties}>
          <span className={styles.cutBefore} />
          <span className={styles.cutAfter} />
        </div>
      ))}
    </div>
  );
}
