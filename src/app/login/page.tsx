import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand text-2xl font-bold text-brand-foreground">₺</span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Expandi</h1>
            <p className="text-sm text-muted-foreground">Know what you can spend today.</p>
          </div>
        </div>
        <LoginForm next={next} error={typeof sp.error === "string" ? sp.error : null} />
      </div>
    </div>
  );
}
