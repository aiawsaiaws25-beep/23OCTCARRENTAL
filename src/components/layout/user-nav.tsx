import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { getCurrentUser } from "@/server/session";

/** Session-dependent part of the header. Must be rendered inside <Suspense>. */
export async function UserNav({ variant }: { variant: "desktop" | "mobile" }) {
  const user = await getCurrentUser();
  const mobile = variant === "mobile";
  const full = mobile ? "w-full" : undefined;

  if (!user) {
    return (
      <div className={mobile ? "flex flex-col gap-2" : "flex items-center gap-2"}>
        <ButtonLink href="/login" variant="secondary" size="sm" className={full}>
          Log in
        </ButtonLink>
        <ButtonLink href="/register" size="sm" className={full}>
          Sign up
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className={mobile ? "flex flex-col gap-2" : "flex items-center gap-2"}>
      {user.role === "ADMIN" ? (
        <Link href="/admin" className={buttonClass("ghost", "sm", full)}>
          Admin
        </Link>
      ) : null}
      <Link
        href="/profile"
        className={buttonClass("ghost", "sm", full)}
        aria-label={`Profile (${user.name})`}
        data-testid="user-menu-name"
      >
        <span className="max-w-32 truncate">{user.name}</span>
      </Link>
      <form action={logoutAction} className={full}>
        <button type="submit" className={buttonClass("secondary", "sm", full)}>
          Log out
        </button>
      </form>
    </div>
  );
}
