import { SeatDesk } from "@/components/SeatDesk";
import { checkSeatReceipt, loadSeat, quoteSeat } from "@/lib/server/seat";
import type { TicketModel } from "@/components/Ticket";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "第二册 · 轮次席位",
  description: "一轮一席",
};

function one(value: string | string[] | undefined): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  const trimmed = text?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export default async function SeatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const account = one(query.account);
  const agentId = one(query.agentId);
  const hash = one(query.hash);
  const sign = one(query.sign);
  const snap = await loadSeat(account, agentId);

  let initialTicket: TicketModel | undefined;
  let initialReceipt = null;
  if (hash) {
    const checked = await checkSeatReceipt(hash);
    initialReceipt = checked;
    initialTicket = checked.ok ? { kind: "receipt", receipt: checked } : { kind: "failure", failure: checked.failure };
  } else if (sign === "1") {
    const quoted = await quoteSeat({
      action: "seat",
      account: account ?? undefined,
      agentId: agentId ?? undefined,
    });
    initialTicket = quoted.ok ? { kind: "quote", quote: quoted.quote } : { kind: "failure", failure: quoted.failure };
  }

  return (
    <SeatDesk
      initial={snap}
      initialTicket={initialTicket}
      initialReceipt={initialReceipt}
      initialAccount={account ?? ""}
      initialAgentId={agentId ?? ""}
      initialHash={hash ?? ""}
    />
  );
}
