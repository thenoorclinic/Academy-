import { LoginButton } from "./LoginButton";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="font-serif text-3xl tracking-wide">NOOR Hub</h1>
          <p className="mt-1 text-sm text-black/60">The NOOR Clinic · Gestión interna</p>
        </div>
        <LoginButton />
        <p className="text-xs text-black/40">Acceso restringido a personal autorizado.</p>
      </div>
    </main>
  );
}
