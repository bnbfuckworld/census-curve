import { withBase } from "@/lib/basePath";
import { REGISTRY } from "@/lib/economics";
import { TRADE_RISK } from "@/lib/sign";

function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function Cell({ label, address }: { label: string; address?: string }) {
  if (!address) {
    return (
      <span>
        <span className="kicker">{label}</span>
        待部署
      </span>
    );
  }
  return (
    <a href={`https://bscscan.com/address/${address}`} target="_blank" rel="noreferrer">
      <span className="kicker">{label}</span>
      <span className="num">{short(address)}</span>
    </a>
  );
}

export function Foot({
  factory,
  token,
  curve,
  pool,
  curveLabel = "曲线",
  risk = TRADE_RISK,
}: {
  factory?: string;
  token?: string;
  curve?: string;
  pool?: string;
  curveLabel?: string;
  risk?: string;
}) {
  return (
    <footer className="site-foot">
      <div className="bar">
        <Cell label="工厂" address={factory || undefined} />
        <Cell label="代币" address={token || undefined} />
        <Cell label={curveLabel} address={curve || undefined} />
        <Cell label="池" address={pool || undefined} />
        <a href={`https://bscscan.com/address/${REGISTRY}`} target="_blank" rel="noreferrer">
          <span className="kicker">AGENT ID</span>
          <span className="num">{short(REGISTRY)}</span>
        </a>
        <a href="https://x.com/censuscurve" target="_blank" rel="noreferrer">
          <span className="kicker">X</span>
          @censuscurve
        </a>
      </div>
      <p className="foot-risk">
        {risk}{" "}
        <a href={withBase("/rights")}>权限说明</a>
      </p>
    </footer>
  );
}
