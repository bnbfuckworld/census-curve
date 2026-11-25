import { failure as named } from "@/lib/copy";
import { loadPlanAndBook } from "@/lib/server/plan";
import { DeployClient } from "./DeployClient";

export const dynamic = "force-dynamic";

export default function DeployPage() {
  const loaded = loadPlanAndBook();
  if (!loaded) {
    const failure = named("page-broke");
    return (
      <main className="frame">
        <section className="trade">
          <div className="panel">
            <h1>{failure.title}</h1>
            <p>{failure.body}</p>
            <p className="next">{failure.next}</p>
          </div>
        </section>
      </main>
    );
  }
  return <DeployClient initialPlan={loaded.plan} initialBook={loaded.book} />;
}
