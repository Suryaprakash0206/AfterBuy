import { useState } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Files,
  ShieldCheck,
  Wrench,
  Bell,
  Users,
  ChartNoAxesCombined,
  Settings,
  Menu,
  ArrowUpRight,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { useApp } from "../lib/context";
import { supabase } from "../lib/api";
import { Modal } from "./ui";
import { VisualEffects } from "./VisualEffects";
import { QuickSearch } from "./QuickSearch";
const navigation = [
  ["/", "Overview", LayoutDashboard],
  ["/products", "My products", Package],
  ["/documents", "Documents", Files],
  ["/coverage", "Coverage & deadlines", ShieldCheck],
  ["/cases", "Service cases", Wrench],
  ["/notifications", "Notifications", Bell],
] as const;
const secondary = [
  ["/household", "Household", Users],
  ["/analytics", "Insights", ChartNoAxesCombined],
  ["/settings", "Settings", Settings],
] as const;
export function Logo() {
  return (
    <Link className="logo" to="/" aria-label="AfterBuy home">
      <img src="/icon.svg" alt="" />
      AfterBuy<span className="logo-dot">.</span>
    </Link>
  );
}
export function Shell() {
  const [menu, setMenu] = useState(false);
  const { workspace, workspaceId, setWorkspaceId, me, session } = useApp();
  const location = useLocation();
  const current =
    [...navigation, ...secondary].find(([url]) =>
      url === "/"
        ? location.pathname === "/"
        : location.pathname.startsWith(url),
    )?.[1] || "Your workspace";
  const nav = (
    <>
      <Logo />
      <div className="workspace-switch">
        <label htmlFor="workspace-switch">WORKSPACE</label>
        <select
          id="workspace-switch"
          aria-label="Switch workspace"
          value={workspaceId}
          onChange={(e) => {
            setWorkspaceId(e.target.value);
            setMenu(false);
          }}
        >
          {me.memberships.map((m: any) => (
            <option key={m.workspace.id} value={m.workspace.id}>
              {m.workspace.name}
            </option>
          ))}
        </select>
      </div>
      <nav aria-label="Main navigation">
        {navigation.map(([path, label, Icon]) => (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            onClick={() => setMenu(false)}
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
        <div className="nav-separator" />
        {secondary.map(([path, label, Icon]) => (
          <NavLink key={path} to={path} onClick={() => setMenu(false)}>
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <span className="mini-mark">
          <ShieldCheck size={17} />
        </span>
        <div>
          <strong>A home for what you own.</strong>
          <small>Your records, kept together.</small>
        </div>
      </div>
    </>
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">{nav}</aside>
      <div className="shell-body">
        <div className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMenu(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumbs">
            <span>{workspace.name}</span>
            <ChevronRight size={14} />
            <strong>{current}</strong>
          </div>
          <div className="topbar-actions">
            <QuickSearch />
            <VisualEffects />
            <Link
              to="/notifications"
              className="icon-button"
              aria-label="Notifications"
            >
              <Bell size={19} />
            </Link>
            <Link
              className="avatar"
              to="/settings"
              aria-label="Account settings"
            >
              {(me.profile.display_name || session?.user.email || "A")
                .slice(0, 1)
                .toUpperCase()}
            </Link>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() => void supabase?.auth.signOut()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>AfterBuy · Everything after the purchase.</span>
          <Link to="/settings">
            Your preferences <ArrowUpRight size={13} />
          </Link>
        </footer>
      </div>
      <Modal
        title="Your workspace"
        description="Navigate AfterBuy"
        open={menu}
        onOpenChange={setMenu}
      >
        <div className="mobile-nav">{nav}</div>
      </Modal>
    </div>
  );
}
