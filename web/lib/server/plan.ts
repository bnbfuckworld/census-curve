import fs from "fs";
import path from "path";

export type DeployPlan = {
  chainId: number;
  registry: string;
  registrySource: string;
  name: string;
  symbol: string;
  createCalldata: string;
  checks: string[];
};

export type DeployBook = {
  factory: string;
  deployTx: string;
  token: string;
  curve: string;
  pool: string;
  createTx: string;
};

function bookPath(): string {
  if (process.env.CENSUS_BOOK) return path.resolve(process.env.CENSUS_BOOK);
  return path.resolve(process.cwd(), "../deploy/book.json");
}

export function loadPlanAndBook(): { plan: DeployPlan; book: DeployBook } | null {
  const file = bookPath();
  const planFile = path.join(path.dirname(file), "unsigned.json");
  try {
    const rawPlan = JSON.parse(fs.readFileSync(planFile, "utf8")) as Record<string, unknown>;
    const plan: DeployPlan = {
      chainId: Number(rawPlan.chainId),
      registry: String(rawPlan.registry ?? ""),
      registrySource: String(rawPlan.registrySource ?? ""),
      name: String(rawPlan.name ?? ""),
      symbol: String(rawPlan.symbol ?? ""),
      createCalldata: String(rawPlan.createCalldata ?? ""),
      checks: Array.isArray(rawPlan.checks) ? rawPlan.checks.map(String) : [],
    };
    let book: DeployBook = {
      factory: "",
      deployTx: "",
      token: "",
      curve: "",
      pool: "",
      createTx: "",
    };
    try {
      const rawBook = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      book = {
        factory: typeof rawBook.factory === "string" ? rawBook.factory : "",
        deployTx: typeof rawBook.deployTx === "string" ? rawBook.deployTx : "",
        token: typeof rawBook.token === "string" ? rawBook.token : "",
        curve: typeof rawBook.curve === "string" ? rawBook.curve : "",
        pool: typeof rawBook.pool === "string" ? rawBook.pool : "",
        createTx: typeof rawBook.createTx === "string" ? rawBook.createTx : "",
      };
    } catch {
      // book may be absent in fixtures
    }
    return { plan, book };
  } catch {
    return null;
  }
}
