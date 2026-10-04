import { importPKCS8, SignJWT } from "jose";
import { toCents } from "@/lib/money";
import { maskIban, type NormalizedAccount, type NormalizedTransaction } from "./types";

/**
 * Cliente de Enable Banking (agregador PSD2 con licencia AISP, cubre la gran
 * mayoría de bancos españoles). Acceso de SOLO LECTURA a movimientos.
 * Referencia: https://enablebanking.com/docs/api/reference/
 *
 * Flujo:
 *  1. startAuthorization() → URL del banco; el usuario autoriza en su banca online (SCA).
 *  2. El banco redirige a /api/integrations/bank/callback?code=…
 *  3. createSession(code) → session_id + cuentas. Guardamos session_id CIFRADO.
 *  4. fetchTransactions() periódicamente. El consentimiento PSD2 caduca (máx. 180 días)
 *     y hay que renovarlo: la app avisa antes de que expire.
 */
const API = "https://api.enablebanking.com";

async function token(): Promise<string> {
  const appId = process.env.ENABLEBANKING_APP_ID;
  const pem = process.env.ENABLEBANKING_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !pem) throw new Error("Enable Banking no configurado (ENABLEBANKING_APP_ID / ENABLEBANKING_PRIVATE_KEY)");
  const key = await importPKCS8(pem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: appId })
    .setIssuer("enablebanking.com")
    .setAudience("api.enablebanking.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Enable Banking ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export async function listBanks(country = "ES") {
  const data = await call<{ aspsps: { name: string; country: string; logo?: string }[] }>(`/aspsps?country=${country}&psu_type=business`);
  return data.aspsps;
}

export async function startAuthorization(opts: { bankName: string; country?: string; state: string; redirectUrl: string; days?: number }) {
  const validUntil = new Date(Date.now() + (opts.days ?? 180) * 86_400_000).toISOString();
  return call<{ url: string; authorization_id: string }>("/auth", {
    method: "POST",
    body: JSON.stringify({
      access: { valid_until: validUntil },
      aspsp: { name: opts.bankName, country: opts.country ?? "ES" },
      state: opts.state,
      redirect_url: opts.redirectUrl,
      psu_type: "business",
    }),
  });
}

type EBAccount = {
  uid: string;
  account_id?: { iban?: string };
  name?: string;
  currency?: string;
};

export async function createSession(code: string) {
  const data = await call<{ session_id: string; accounts: EBAccount[]; access?: { valid_until?: string } }>("/sessions", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  const accounts: NormalizedAccount[] = data.accounts.map((a) => ({
    externalId: a.uid,
    name: a.name ?? `Cuenta ${a.account_id?.iban?.slice(-4) ?? ""}`.trim(),
    ibanMasked: maskIban(a.account_id?.iban),
    currency: a.currency ?? "EUR",
  }));
  return { sessionId: data.session_id, validUntil: data.access?.valid_until, accounts };
}

type EBTransaction = {
  entry_reference?: string;
  transaction_id?: string;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "DBIT" | "CRDT";
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  remittance_information?: string[];
  creditor?: { name?: string };
  debtor?: { name?: string };
  status?: string;
};

export async function fetchTransactions(accountUid: string, dateFrom: string): Promise<NormalizedTransaction[]> {
  const out: NormalizedTransaction[] = [];
  let continuationKey: string | undefined;
  do {
    const params = new URLSearchParams({ date_from: dateFrom });
    if (continuationKey) params.set("continuation_key", continuationKey);
    const data = await call<{ transactions: EBTransaction[]; continuation_key?: string }>(
      `/accounts/${encodeURIComponent(accountUid)}/transactions?${params}`,
    );
    for (const t of data.transactions) {
      if (t.status && t.status !== "BOOK") continue; // ignoramos pendientes
      const bookingDate = t.booking_date ?? t.value_date ?? t.transaction_date;
      if (!bookingDate) continue;
      const abs = Math.abs(toCents(t.transaction_amount.amount));
      const isDebit = t.credit_debit_indicator === "DBIT";
      out.push({
        externalId: t.entry_reference ?? t.transaction_id ?? `${bookingDate}_${t.transaction_amount.amount}_${(t.remittance_information ?? []).join("")}`,
        bookingDate,
        valueDate: t.value_date,
        amountCents: isDebit ? -abs : abs,
        currency: t.transaction_amount.currency,
        description: (t.remittance_information ?? []).join(" ").trim() || (isDebit ? t.creditor?.name : t.debtor?.name) || "",
        counterparty: isDebit ? t.creditor?.name : t.debtor?.name,
        raw: t as unknown as Record<string, unknown>,
      });
    }
    continuationKey = data.continuation_key || undefined;
  } while (continuationKey);
  return out;
}
