interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** A `text-*` class; the stroke is currentColor. */
  colorClass: string;
}

export function Sparkline({
  data,
  width = 56,
  height = 18,
  colorClass,
}: SparklineProps) {
  if (data.length === 0) return null;

  if (data.length === 1) {
    // Flat line at the single data point's y value
    const y = height - (Math.max(0, Math.min(100, data[0])) / 100) * height;
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={`inline-block align-middle ${colorClass}`}
        aria-hidden="true"
      >
        <line
          x1={0}
          y1={y}
          x2={width}
          y2={y}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const points = data
    .map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (Math.max(0, Math.min(100, val)) / 100) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block align-middle ${colorClass}`}
      aria-hidden="true"
    >
      <polyline
        points={points}
        stroke="currentColor"
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
