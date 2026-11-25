import { Desk } from "@/components/Desk";
import { loadDesk } from "@/lib/server/chain";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initialDesk = await loadDesk("lin", null);
  return <Desk initialDesk={initialDesk} />;
}
