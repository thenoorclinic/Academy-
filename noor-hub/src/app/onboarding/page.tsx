import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";

/** Alta inicial: el primer usuario autorizado crea su organización y su clínica (queda como owner). */
async function createClinic(formData: FormData) {
  "use server";
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const allowed = (process.env.ALLOWED_EMAILS ?? "").toLowerCase().split(",").map((e) => e.trim());
  if (!allowed.includes(session.user.email.toLowerCase())) throw new Error("Solo un usuario autorizado puede crear clínicas");
  const name = z.string().min(2).max(80).parse(formData.get("name"));
  const [org] = await db.insert(schema.organizations).values({ name }).returning();
  const [clinic] = await db.insert(schema.clinics).values({ organizationId: org!.id, name }).returning();
  await db.insert(schema.memberships).values({ userId: session.user.id, clinicId: clinic!.id, role: "owner" });
  await audit({ clinicId: clinic!.id, userId: session.user.id, action: "clinic.created" });
  redirect("/ajustes");
}

export default function Onboarding() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form action={createClinic} className="card w-full max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Configura tu clínica</h1>
        <input name="name" className="input" defaultValue="The NOOR Clinic" required />
        <button className="btn-primary w-full">Crear</button>
      </form>
    </main>
  );
}
