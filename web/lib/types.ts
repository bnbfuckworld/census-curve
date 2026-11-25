export const WHO = ["lin", "blank", "none", "broke"] as const;
export type Who = (typeof WHO)[number];

export const ACTIONS = ["mint", "sell", "swap", "add", "remove"] as const;
export type Action = (typeof ACTIONS)[number] | "seat";

export type Failure = {
  code: string;
  title: string;
  body: string;
  next: string;
  audit?: string;
};

export type Published = {
  slope: string;
  base: string;
  quota0: string;
  scale: number;
  marginalAtZero: string;
  marginalAt100: string;
  integralFirst100: string;
  feeNumerator: number;
  feeDenominator: number;
};

export type Book = {
  supply: string;
  reserve: string;
  n: string;
  marginal: string;
  redeemWei: string | null;
  redeemAmount: string | null;
  nextQuota: string;
  remaining: string;
  mintedOf: string;
  quotaOf: string;
  started: boolean;
  tokenReserve: string;
  bnbReserve: string;
  poolPrice: string;
  poolOpen: boolean;
  tokenBal: string;
  lp: string;
  bnb: string;
  agentBalance: string;
  handle: string;
  eligible: boolean;
};

export type Identity = {
  id: Who;
  title: string;
  address: string;
  handle: string;
  agentBalance: string;
  bnb: string;
  eligible: boolean;
};

export type LocalMarket = {
  factory: string;
  token: string;
  curve: string;
  pool: string;
  name: string;
  symbol: string;
  createTx: string;
  createTxFound: boolean;
  registryCodeBytes: number;
  economicsMatch: boolean;
  chainSlope: string;
  chainBase: string;
  chainQuota0: string;
};

export type DeskPayload = {
  live: false;
  chainId: 56;
  rpc: string;
  attached: boolean;
  personal: boolean;
  reason?: "unopened" | "offline" | "stale" | "wrong-chain" | "refused-file";
  registry: string;
  published: Published;
  local: LocalMarket | null;
  identities: Identity[];
  who: Who;
  book: Book | null;
  failure?: Failure;
  probes: { label: string; title: string; next: string }[];
};

export type QuoteDTO = {
  action: Action;
  who: Who;
  from: string;
  to: string;
  calldata: string;
  valueWei: string;
  tokenWei: string;
  bnbWei: string;
  minOutWei: string | null;
  outUnit: "token" | "bnb" | "share" | null;
  needApprove: boolean;
  approveTo: string | null;
  approveCalldata: string | null;
  notes: string[];
  blocked: Failure | null;
  feeLabel?: string;
  slipNote?: string;
  marginal: string;
  poolPrice: string | null;
  poolOpen: boolean;
  remaining: string;
  mintedOf: string;
  n: string;
  supply: string;
  baw: string;
  fn: string;
};

export type ReceiptDTO = {
  action: Action;
  who: Who;
  hash: string;
  approveHash?: string;
  blockNumber: string;
  gasUsed: string;
  status: "success";
  before: Book;
  after: Book;
  quotaNote: string | null;
};

export type RevertDTO = {
  hash: string;
  approveHash?: string;
  blockNumber: string;
  gasUsed: string;
  status: "reverted";
  before: Book;
  after: Book;
  stateHeld: boolean;
};

export type QuoteResponse = { ok: true; quote: QuoteDTO } | { ok: false; failure: Failure };

export type SendResponse =
  | { ok: true; receipt: ReceiptDTO }
  | { ok: false; failure: Failure; reverted?: RevertDTO };


export type ReceiptCheckOk = {
  ok: true;
  hash: string;
  from: string;
  to: string;
  action: Action | "approve";
  title: string;
  body: string;
  tokenWei: string | null;
  bnbWei: string | null;
  remaining: string | null;
  mintedOf: string | null;
  scan: string;
};

export type ReceiptCheck = ReceiptCheckOk | { ok: false; failure: Failure };
