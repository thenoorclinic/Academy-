"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions";

/** Botón que ejecuta una server action y muestra el resultado. */
export function ActionButton(props: {
  action: () => Promise<ActionResult>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "ghost";
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="space-y-2">
      <button
        className={props.variant === "ghost" ? "btn-ghost" : "btn-primary"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              setResult(await props.action());
            } catch (e) {
              setResult({ ok: false, message: e instanceof Error ? e.message : "Error inesperado" });
            }
          })
        }
      >
        {pending ? (props.pendingLabel ?? "Procesando…") : props.label}
      </button>
      {result && <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.message}</p>}
    </div>
  );
}

/** Formulario (con archivo) que llama a una server action y muestra el resultado. */
export function ActionForm(props: {
  action: (fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <form
      className="space-y-3"
      action={(fd) =>
        start(async () => {
          try {
            setResult(await props.action(fd));
          } catch (e) {
            setResult({ ok: false, message: e instanceof Error ? e.message : "Error inesperado" });
          }
        })
      }
    >
      {props.children}
      <button className="btn-primary" disabled={pending}>
        {pending ? "Procesando…" : props.submitLabel}
      </button>
      {result && <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.message}</p>}
    </form>
  );
}
