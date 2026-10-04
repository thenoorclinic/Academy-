"use client";

import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient();

export function LoginButton() {
  return (
    <button className="btn-primary w-full" onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/" })}>
      Entrar con Google
    </button>
  );
}
