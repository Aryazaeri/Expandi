import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth";

async function UserEmail() {
  const { email } = await requireUser();
  return <>{email}</>;
}

/** The nav shell is static (instant navigations); only the user's e-mail streams in. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell
      account={
        <Suspense fallback={null}>
          <UserEmail />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
