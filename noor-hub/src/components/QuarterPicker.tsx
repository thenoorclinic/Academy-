import Link from "next/link";
import { currentQuarter, previousQuarter } from "@/lib/quarter";

export function quarterFromParams(sp: { q?: string }): string {
  return sp.q && /^\d{4}-T[1-4]$/.test(sp.q) ? sp.q : currentQuarter();
}

export function QuarterPicker({ value, path }: { value: string; path: string }) {
  const options: string[] = [];
  let q: string = currentQuarter();
  for (let i = 0; i < 6; i++) {
    options.push(q);
    q = previousQuarter(q);
  }
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <Link key={o} href={`${path}?q=${o}`} className={`badge ${o === value ? "bg-[var(--noor-ink)] text-white" : "bg-white ring-1 ring-black/10"}`}>
          {o}
        </Link>
      ))}
    </div>
  );
}
