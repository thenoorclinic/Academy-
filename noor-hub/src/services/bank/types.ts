/** Movimiento bancario normalizado, independiente del origen (API PSD2, Norma 43, CSV). */
export type NormalizedTransaction = {
  externalId: string;
  bookingDate: string; // YYYY-MM-DD
  valueDate?: string;
  amountCents: number; // negativo = cargo
  currency: string;
  description: string;
  counterparty?: string;
  raw?: Record<string, unknown>;
};

export type NormalizedAccount = {
  externalId: string;
  name: string;
  ibanMasked?: string;
  currency: string;
};

export function maskIban(iban?: string | null): string | undefined {
  if (!iban) return undefined;
  const s = iban.replace(/\s/g, "");
  return `${s.slice(0, 4)} **** **** ${s.slice(-4)}`;
}
