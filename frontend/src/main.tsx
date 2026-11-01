import React, { Component, type ReactNode, lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
  Link,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProvider, useApp } from "./lib/context";
import { Shell } from "./components/Shell";
import { Loading, ErrorNotice, Button } from "./components/ui";
import { supabase } from "./lib/api";
const Auth = lazy(() =>
  import("./pages/Auth").then((m) => ({ default: m.Auth })),
);
const AuthCallback = lazy(() =>
  import("./pages/Auth").then((m) => ({ default: m.AuthCallback })),
);
const ResetPassword = lazy(() =>
  import("./pages/Auth").then((m) => ({ default: m.ResetPassword })),
);
const Onboarding = lazy(() =>
  import("./pages/Auth").then((m) => ({ default: m.Onboarding })),
);
const Dashboard = lazy(() =>
  import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Products = lazy(() =>
  import("./pages/Products").then((m) => ({ default: m.Products })),
);
const ProductEditor = lazy(() =>
  import("./pages/Products").then((m) => ({ default: m.ProductEditor })),
);
const ProductDetail = lazy(() =>
  import("./pages/Products").then((m) => ({ default: m.ProductDetail })),
);
const Documents = lazy(() =>
  import("./pages/Documents").then((m) => ({ default: m.Documents })),
);
const UploadDocument = lazy(() =>
  import("./pages/Documents").then((m) => ({ default: m.UploadDocument })),
);
const DocumentReview = lazy(() =>
  import("./pages/Documents").then((m) => ({ default: m.DocumentReview })),
);
const Coverage = lazy(() =>
  import("./pages/Coverage").then((m) => ({ default: m.Coverage })),
);
const Cases = lazy(() =>
  import("./pages/Cases").then((m) => ({ default: m.Cases })),
);
const CaseEditor = lazy(() =>
  import("./pages/Cases").then((m) => ({ default: m.CaseEditor })),
);
const CaseDetail = lazy(() =>
  import("./pages/Cases").then((m) => ({ default: m.CaseDetail })),
);
const SupportPackage = lazy(() =>
  import("./pages/Cases").then((m) => ({ default: m.SupportPackage })),
);
const Notifications = lazy(() =>
  import("./pages/Notifications").then((m) => ({ default: m.Notifications })),
);
const Household = lazy(() =>
  import("./pages/Household").then((m) => ({ default: m.Household })),
);
const Invitation = lazy(() =>
  import("./pages/Household").then((m) => ({ default: m.Invitation })),
);
const Analytics = lazy(() =>
  import("./pages/Analytics").then((m) => ({ default: m.Analytics })),
);
const Settings = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.Settings })),
);
import "./styles.css";
import "./glass.css";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15000, retry: 1, refetchOnWindowFocus: true },
  },
});
function Protected() {
  const { authLoading, session, meLoading, meError, me, refresh } = useApp();
  const location = useLocation();
  if (authLoading || (session && meLoading))
    return <Loading label="Checking your session…" />;
  if (!session)
    return <Navigate to="/auth" state={{ from: location.pathname }} replace />;
  if (meError)
    return (
      <div className="center-page">
        <ErrorNotice error={meError} retry={refresh} />
        <Button onClick={() => void supabase?.auth.signOut()}>Sign out</Button>
      </div>
    );
  const invitation = sessionStorage.getItem("afterbuy.invite");
  if (invitation) return <Navigate to={`/invite/${invitation}`} replace />;
  if (!me?.memberships?.length) return <Onboarding />;
  return <Outlet />;
}
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="center-page">
        <h1>Let’s try that again.</h1>
        <ErrorNotice error={this.state.error} />
        <Button onClick={() => window.location.reload()}>
          Reload AfterBuy
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppProvider>
            <Suspense fallback={<Loading label="Opening AfterBuy…" />}>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/auth/reset" element={<ResetPassword />} />
                <Route path="/invite/:token" element={<Invitation />} />
                <Route element={<Protected />}>
                  <Route element={<Shell />}>
                    <Route index element={<Dashboard />} />
                    <Route path="products" element={<Products />} />
                    <Route path="products/new" element={<ProductEditor />} />
                    <Route path="products/:id" element={<ProductDetail />} />
                    <Route
                      path="products/:id/edit"
                      element={<ProductEditor />}
                    />
                    <Route path="documents" element={<Documents />} />
                    <Route
                      path="documents/upload"
                      element={<UploadDocument />}
                    />
                    <Route
                      path="documents/:id/review"
                      element={<DocumentReview />}
                    />
                    <Route path="coverage" element={<Coverage />} />
                    <Route path="cases" element={<Cases />} />
                    <Route path="cases/new" element={<CaseEditor />} />
                    <Route path="cases/:id" element={<CaseDetail />} />
                    <Route
                      path="cases/:id/package"
                      element={<SupportPackage />}
                    />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="household" element={<Household />} />
                    <Route path="analytics" element={<Analytics />} />
                    <Route path="settings" element={<Settings />} />
                    <Route
                      path="*"
                      element={
                        <div className="center-page">
                          <h1>That page is not here.</h1>
                          <Link to="/">Back to your overview</Link>
                        </div>
                      }
                    />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </AppProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
if (import.meta.env.PROD && "serviceWorker" in navigator)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* App stays usable when service workers are unavailable. */
    });
  });
