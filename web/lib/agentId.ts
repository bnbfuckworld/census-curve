import { keccak256, toBytes } from "viem";

/** Same derivation as SPACE ID: tokenId = uint256(keccak256(bytes(handle))). */
export function tokenIdOfHandle(handle: string): bigint {
  return BigInt(keccak256(toBytes(handle)));
}

export function parseTokenId(input: string | null | undefined): bigint | null {
  const text = (input ?? "").trim();
  if (!text) return null;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(text)) return BigInt(text);
  if (/^\d+$/.test(text) && text.length <= 78) return BigInt(text);
  return null;
}

export function tokenIdHex(id: bigint): string {
  return `0x${id.toString(16).padStart(64, "0")}`;
}
