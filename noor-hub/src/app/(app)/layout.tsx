import Link from "next/link";
import { requireContext } from "@/lib/context";

// Las acciones largas (leer facturas con IA) necesitan hasta 5 min de ejecución.
export const maxDuration = 300;

const NAV = [
  { href: "/", label: "Panel" },
  { href: "/facturas", label: "Facturas" },
  { href: "/banco", label: "Banco" },
  { href: "/conciliacion", label: "Conciliación" },
  { href: "/proveedores", label: "Proveedores" },
  { href: "/gestoria", label: "Gestoría" },
  { href: "/ajustes", label: "Ajustes" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:flex-row md:p-8">
      <aside className="md:w-52 md:shrink-0">
        <div className="mb-4">
          <p className="font-serif text-2xl">NOOR Hub</p>
          <p className="text-xs text-black/50">{ctx.clinicName}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm hover:bg-black/5">
              {n.label}
            </Link>
          ))}
        </nav>
        <p className="mt-6 hidden text-xs text-black/40 md:block">
          {ctx.userEmail}
          <br />
          Rol: {ctx.role}
        </p>
      </aside>
      <main className="min-w-0 flex-1 space-y-6">{children}</main>
    </div>
  );
}
