import { ledgerLine, type BookMode } from "@/lib/ledgerLine";
import type { Action, DeskPayload } from "@/lib/types";

export type { BookMode };

type Props = {
  desk: DeskPayload | null;
  mode: BookMode;
  action: Action;
  tokenAmt: string;
  bnbAmt: string;
  lpAmt: string;
  tokenToBnb: boolean;
  onToken: (value: string) => void;
  onBnb: (value: string) => void;
  onLp: (value: string) => void;
  onDirection: (tokenToBnb: boolean) => void;
  onAllToken: () => void;
  onAllLp: () => void;
};

export function Ledger(props: Props) {
  const { action } = props;
  const tokenField = (
    <label>
      枚数
      <span className="inline">
        <input
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label="枚数"
          value={props.tokenAmt}
          onChange={(event) => props.onToken(event.target.value)}
        />
        <button type="button" className="linkish" onClick={props.onAllToken}>
          全额
        </button>
      </span>
    </label>
  );
  const bnbField = (
    <label>
      BNB
      <input
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label="BNB"
        value={props.bnbAmt}
        onChange={(event) => props.onBnb(event.target.value)}
      />
    </label>
  );

  let hint: string | null = null;
  if (action === "mint" || action === "sell") hint = "最少 0.001 枚";

  return (
    <div className="panel order">
      <p className="hint">{ledgerLine(props.desk, props.mode)}</p>
      <div className="form">
        {action === "mint" || action === "sell" ? tokenField : null}
        {action === "add" ? (
          <>
            {tokenField}
            {bnbField}
          </>
        ) : null}
        {action === "swap" ? (
          <label>
            {props.tokenToBnb ? "付出 · 枚" : "付出 · BNB"}
            <span className="inline">
              <input
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                aria-label={props.tokenToBnb ? "付出的枚数" : "付出的 BNB"}
                value={props.tokenToBnb ? props.tokenAmt : props.bnbAmt}
                onChange={(event) =>
                  props.tokenToBnb ? props.onToken(event.target.value) : props.onBnb(event.target.value)
                }
              />
              <button type="button" className="linkish" onClick={() => props.onDirection(!props.tokenToBnb)}>
                {props.tokenToBnb ? "改为付 BNB" : "改为付代币"}
              </button>
            </span>
          </label>
        ) : null}
        {action === "remove" ? (
          <label>
            份额
            <span className="inline">
              <input
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                aria-label="内部份额，空着表示全部"
                value={props.lpAmt}
                onChange={(event) => props.onLp(event.target.value)}
              />
              <button type="button" className="linkish" onClick={props.onAllLp}>
                全部
              </button>
            </span>
          </label>
        ) : null}
      </div>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}
