import { canEncode128, code128Bars } from "@/domain/barcode";

/** A Code 128 barcode as SVG that stretches to its box. Quiet zones (10 modules) are included on both sides. */
export function Barcode({ value, height = "100%", className }: { value: string; height?: string | number; className?: string }) {
  if (!canEncode128(value)) return null;
  const { bars, modules } = code128Bars(value);
  const q = 10;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${modules + 2 * q} 40`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="img"
      aria-label={`Barcode ${value}`}
      shapeRendering="crispEdges"
    >
      <rect width={modules + 2 * q} height={40} fill="#fff" />
      {bars.map(([x, w]) => (
        <rect key={x} x={x + q} width={w} height={40} fill="#000" />
      ))}
    </svg>
  );
}
