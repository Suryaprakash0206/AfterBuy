import { useEffect, useState } from "react";
import {
  useNavigate,
  useSearchParams,
  Link,
  useLocation,
} from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, ShieldCheck, FileText, Clock3, Check } from "lucide-react";
import { configured, supabase, api } from "../lib/api";
import { useApp } from "../lib/context";
import { authError } from "../lib/auth-error";
import {
  Button,
  ErrorNotice,
  Field,
  Notice,
  Loading,
  RecordForm,
} from "../components/ui";
import { Logo } from "../components/Shell";
const authSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Use at least eight characters"),
});
export function Auth() {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { session } = useApp();
  const form = useForm({
    resolver: zodResolver(authSchema),
    defaultValues: { email: "", password: "" },
  });
  const [params] = useSearchParams();
  const invite = params.get("invite");
  useEffect(() => {
    if (invite) sessionStorage.setItem("afterbuy.invite", invite);
    if (session) void navigate("/");
  }, [session, navigate, invite]);
  async function submit(v: z.infer<typeof authSchema>) {
    if (!supabase) return;
    setBusy(true);
    setError(undefined);
    try {
      const result =
        mode === "signup"
          ? await supabase.auth.signUp(v)
          : await supabase.auth.signInWithPassword(v);
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session)
        throw new Error(
          'Supabase still requires email confirmation. Turn off "Confirm email" in the project’s Authentication → Sign In / Providers settings, then sign in.',
        );
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    if (!supabase) return;
    setBusy(true);
    setError(undefined);
    try {
      const email = z.email().parse(form.getValues("email"));
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/auth/reset`,
      });
      if (error) throw error;
      setMessage(
        "If an account exists for this address, a reset link has been requested. Check your inbox.",
      );
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Logo />
        <div className="auth-copy">
          <p className="eyebrow">A LITTLE ORDER. A LOT LESS WORRY.</p>
          <h1>
            Everything after
            <br />
            the purchase.
          </h1>
          <p>
            Keep the things you own—and everything that comes with them—in one
            thoughtful place.
          </p>
          <div className="auth-benefits">
            <span>
              <FileText />
              Every receipt, easy to find.
            </span>
            <span>
              <ShieldCheck />
              Coverage you can understand.
            </span>
            <span>
              <Clock3 />
              The right reminder, on time.
            </span>
          </div>
        </div>
        <small>Made for the life of your things.</small>
      </section>
      <section className="auth-form">
        <div className="auth-form-inner">
          <p className="eyebrow">YOUR PERSONAL OWNERSHIP SPACE</p>
          <h2>
            {mode === "signup"
              ? "Make yourself at home."
              : mode === "forgot"
                ? "Let’s get you back in."
                : "Welcome back."}
          </h2>
          <p className="muted">
            {mode === "signup"
              ? "A clear home for purchases, documents and peace of mind."
              : mode === "forgot"
                ? "Enter the email address associated with your account."
                : "A little less searching. A little more knowing."}
          </p>
          {!configured && (
            <Notice>
              <strong>Connect your Supabase project to begin.</strong>
              <p>
                Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in
                frontend/.env, then restart the frontend. See the root README
                for local setup.
              </p>
            </Notice>
          )}
          {message && (
            <div className="notice" role="status">
              <Check size={18} />
              {message}
            </div>
          )}
          <form onSubmit={form.handleSubmit(submit)}>
            <Field label="Email address">
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <small role="alert">
                  {form.formState.errors.email.message}
                </small>
              )}
            </Field>
            {mode !== "forgot" && (
              <Field label="Password">
                <input
                  type="password"
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  placeholder="At least 8 characters"
                  {...form.register("password")}
                />
                {form.formState.errors.password && (
                  <small role="alert">
                    {form.formState.errors.password.message}
                  </small>
                )}
              </Field>
            )}
            <ErrorNotice error={error} />
            <Button
              className="w-full"
              type={mode === "forgot" ? "button" : "submit"}
              onClick={mode === "forgot" ? reset : undefined}
              disabled={!configured}
              busy={busy}
            >
              {mode === "signup"
                ? "Create account"
                : mode === "forgot"
                  ? "Request reset link"
                  : "Sign in"}
              <ArrowRight size={16} />
            </Button>
          </form>
          <div className="auth-links">
            <button
              onClick={() => {
                setMode(mode === "signup" ? "signin" : "signup");
                setMessage("");
                setError(undefined);
              }}
            >
              {mode === "signup"
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
            <button
              onClick={() => {
                setMode(mode === "forgot" ? "signin" : "forgot");
                setMessage("");
                setError(undefined);
              }}
            >
              {mode === "forgot" ? "Back to sign in" : "Forgot password?"}
            </button>
          </div>
          <p className="privacy-note">
            <ShieldCheck size={15} />
            Your documents stay in private storage.
          </p>
        </div>
      </section>
    </div>
  );
}
export function AuthCallback() {
  const [error, setError] = useState<unknown>();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!supabase) {
      setError(new Error("Supabase is not configured."));
      return;
    }
    // detectSessionInUrl performs the PKCE exchange during client initialization.
    // getSession waits for that initialization; a second exchange would reuse a single-use code.
    void supabase.auth
      .getSession()
      .then(({ data }) =>
        data.session
          ? navigate("/")
          : setError(
              new Error(
                "This sign-in link is invalid or expired. Return to sign in with your email and password.",
              ),
            ),
      )
      .catch((e) => setError(authError(e)));
  }, [navigate, location.search]);
  return (
    <div className="center-page">
      {error ? (
        <>
          <ErrorNotice error={error} />
          <Link className="btn btn-primary" to="/auth">
            Back to sign in
          </Link>
        </>
      ) : (
        <Loading label="Signing you in…" />
      )}
    </div>
  );
}
export function ResetPassword() {
  const { session, authLoading } = useApp();
  const navigate = useNavigate();
  if (authLoading) return <Loading />;
  return (
    <div className="center-page">
      <Logo />
      <h1>Choose a new password.</h1>
      {session ? (
        <RecordForm
          schema={z.object({ password: z.string().min(8) })}
          fields={[
            {
              name: "password",
              label: "New password (at least 8 characters)",
              type: "password",
            },
          ]}
          onSubmit={async (v) => {
            const { error } = await supabase!.auth.updateUser({
              password: v.password,
            });
            if (error) throw authError(error);
            navigate("/");
          }}
          submitLabel="Update password"
        />
      ) : (
        <Notice>
          Open a valid reset link from your email.{" "}
          <Link to="/auth">Return to sign in</Link>.
        </Notice>
      )}
    </div>
  );
}
export function Onboarding() {
  const { refresh, setWorkspaceId, me } = useApp();
  const navigate = useNavigate();
  const token = sessionStorage.getItem("afterbuy.invite");
  return (
    <div className="onboarding">
      <Logo />
      <p className="eyebrow">ONE SMALL STEP</p>
      <h1>A home for your things.</h1>
      <p className="muted">
        Start with your personal workspace. You can create a shared household
        later.
      </p>
      <RecordForm
        schema={z.object({ name: z.string().trim().min(1).max(100) })}
        fields={[{ name: "name", label: "Workspace name" }]}
        values={{
          name: me?.profile?.display_name
            ? `${me.profile.display_name}’s workspace`
            : "My personal workspace",
        }}
        onSubmit={async (v) => {
          const { id } = await api("/workspaces", {
            method: "POST",
            body: { ...v, kind: "personal" },
          });
          setWorkspaceId(id);
          if (token) {
            const accepted = await api("/invitations/accept", {
              method: "POST",
              body: { token },
            });
            sessionStorage.removeItem("afterbuy.invite");
            setWorkspaceId(accepted.workspace_id);
          }
          refresh();
          navigate("/");
        }}
        submitLabel="Create my workspace"
      />
    </div>
  );
}
