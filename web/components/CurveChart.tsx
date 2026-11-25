import { BASE, SLOPE } from "@/lib/economics";

const W = 640;
const H = 448;
const L = 64;
const R = 16;
const T = 28;
const B = 28;

function priceAt(u: number): number {
  return (Number(SLOPE) * u + Number(BASE)) / 1e18;
}

function point(u: number): [number, number] {
  const bnb = priceAt(u);
  const x = L + (u / 100) * (W - L - R);
  const y = T + (1 - (bnb - 0.001) / 0.1) * (H - T - B);
  return [x, y];
}

export function CurveChart({ supplyWei }: { supplyWei?: string | null }) {
  const steps = 48;
  const pts = Array.from({ length: steps + 1 }, (_, i) => point((100 * i) / steps));
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const plotBottom = H - B;
  const fill = `${line} ${W - R},${plotBottom} ${L},${plotBottom}`;
  const rawSupply = supplyWei ? Number(supplyWei) / 1e18 : 0;
  const u = Math.min(100, Math.max(0, rawSupply));
  const [mx, my] = point(u);
  const livePrice = priceAt(u);
  const grids = [0.001, 0.026, 0.051, 0.076, 0.101];

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="边际价格从 0.001 升到 0.101 BNB，供给 0 到 100 枚">
        <title>{`slope 1e15 · base 1e15 · quota0 100e18 · 现价 ${livePrice.toFixed(3)} BNB`}</title>
        <defs>
          <linearGradient id="curve-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F0B90B" stopOpacity="0.08" />
            <stop offset="1" stopColor="#F0B90B" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grids.map((price) => {
          const y = T + (1 - (price - 0.001) / 0.1) * (H - T - B);
          return <line key={price} className="grid-line" x1={L} x2={W - R} y1={y} y2={y} />;
        })}
        <polygon className="curve-fill" points={fill} />
        <polyline className="curve-line" points={line} />
        <circle className="curve-dot" cx={mx} cy={my} r="3.5" />
        <text className="chart-label" x={L - 8} y={point(0)[1] + 4} textAnchor="end">
          0.001
        </text>
        <text className="chart-label" x={L - 8} y={point(50)[1] + 4} textAnchor="end">
          0.051
        </text>
        <text className="chart-label" x={L - 8} y={point(100)[1] + 4} textAnchor="end">
          0.101
        </text>
        <text className="chart-label" x={point(0)[0]} y={H - 8} textAnchor="start">
          0
        </text>
        <text className="chart-label" x={point(100)[0]} y={H - 8} textAnchor="end">
          100
        </text>
        <text className="chart-label now" x={u < 20 ? mx + 56 : mx + 10} y={Math.max(18, my - 18)} textAnchor="start">
          {`${livePrice.toFixed(3)} BNB`}
        </text>
      </svg>
      <p className="raw num">slope 1e15 · base 1e15 · quota0 100e18</p>
    </figure>
  );
}
