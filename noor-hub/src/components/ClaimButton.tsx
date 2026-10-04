"use client";

import { useState, useTransition } from "react";
import { claimInvoiceAction } from "@/app/actions";

export function ClaimButton({ transactionId }: { transactionId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string>();
  return (
    <span>
      <button
        className="btn-ghost !px-2 !py-1 text-xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("transactionId", transactionId);
            try {
              setMsg((await claimInvoiceAction(fd)).message);
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Error");
            }
          })
        }
      >
        {pending ? "…" : "✉︎ Reclamar factura"}
      </button>
      {msg && <span className="ml-2 text-xs text-black/60">{msg}</span>}
    </span>
  );
}
