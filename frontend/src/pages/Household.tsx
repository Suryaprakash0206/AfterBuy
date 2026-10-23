import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { z } from "zod";
import { Users, Plus, Copy, UserPlus, ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { useApp, useWorkspaceApi, useWorkspaceQuery } from "../lib/context";
import { date } from "../lib/api";
import {
  Button,
  PageHeader,
  QueryState,
  Notice,
  Empty,
  RecordForm,
  Modal,
  ErrorNotice,
  ConfirmButton,
  Status,
} from "../components/ui";
export function Household() {
  const { workspace, isOwner, session, refresh, toast, setWorkspaceId } =
    useApp();
  const members = useWorkspaceQuery("/members");
  const invitations = useWorkspaceQuery("/invitations", { enabled: isOwner });
  const call = useWorkspaceApi();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState<unknown>();
  return (
    <>
      <PageHeader
        eyebrow="BETTER TOGETHER"
        title="Your household"
        description="Share the responsibility, with the right access for everyone."
        action={
          <Button onClick={() => setCreateOpen(true)} variant="secondary">
            <Plus size={16} />
            New household
          </Button>
        }
      />
      {workspace.kind === "personal" && (
        <Notice>
          This is your personal workspace. Create a household to share
          purchases, documents and cases with others.
        </Notice>
      )}
      <ErrorNotice error={error} />
      <section className="section-panel">
        <div className="section-heading">
          <h2>Members of {workspace.name}</h2>
          {isOwner && workspace.kind === "household" && (
            <Button
              onClick={() => {
                setLink("");
                setInviteOpen(true);
              }}
            >
              <UserPlus size={16} />
              Invite member
            </Button>
          )}
        </div>
        <QueryState query={members}>
          {members.data?.map((m: any) => (
            <div className="member-row" key={m.user_id}>
              <span className="avatar">
                {(m.display_name || "M")[0].toUpperCase()}
              </span>
              <div className="row-body">
                <strong>
                  {m.display_name || "Household member"}
                  {m.user_id === session?.user.id ? " (you)" : ""}
                </strong>
                <small>{m.email || "Workspace member"}</small>
              </div>
              {isOwner && m.role !== "owner" ? (
                <>
                  <select
                    aria-label={`Role for ${m.display_name || m.email}`}
                    value={m.role}
                    onChange={async (e) => {
                      try {
                        await call(`/members/${m.user_id}`, {
                          method: "PATCH",
                          body: { role: e.target.value },
                        });
                        refresh();
                        toast("Member role updated.");
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <ConfirmButton
                    title="Remove member?"
                    description="This immediately revokes their access to this workspace and removes their workspace reminders."
                    onConfirm={async () => {
                      await call(`/members/${m.user_id}`, {
                        method: "PATCH",
                        body: { role: null },
                      });
                      refresh();
                    }}
                  >
                    Remove
                  </ConfirmButton>
                </>
              ) : (
                <Status>{m.role}</Status>
              )}
            </div>
          ))}
        </QueryState>
      </section>
      <div className="role-guide">
        <div>
          <h3>Owner</h3>
          <p>Manage records, invitations and member roles.</p>
        </div>
        <div>
          <h3>Editor</h3>
          <p>Add and manage purchases, documents, coverage and cases.</p>
        </div>
        <div>
          <h3>Viewer</h3>
          <p>Read workspace records and manage personal reminders.</p>
        </div>
      </div>
      {isOwner && (
        <section className="section-panel">
          <div className="section-heading">
            <h2>Invitations</h2>
          </div>
          <QueryState query={invitations}>
            {invitations.data?.length ? (
              invitations.data.map((i: any) => (
                <div className="row-link" key={i.id}>
                  <div className="row-body">
                    <strong>{i.email}</strong>
                    <small>
                      {i.role} · Expires {date(i.expires_at)}
                    </small>
                  </div>
                  <Status>
                    {i.accepted_at
                      ? "Accepted"
                      : i.revoked_at
                        ? "Revoked"
                        : new Date(i.expires_at) < new Date()
                          ? "Expired"
                          : "Pending"}
                  </Status>
                  {!i.accepted_at && !i.revoked_at && (
                    <ConfirmButton
                      title="Revoke invitation?"
                      description="This link will stop working immediately."
                      onConfirm={async () => {
                        await call(`/invitations/${i.id}`, {
                          method: "DELETE",
                        });
                        refresh();
                      }}
                    >
                      Revoke
                    </ConfirmButton>
                  )}
                </div>
              ))
            ) : (
              <Empty
                icon={<Users size={25} />}
                title="No invitations yet."
                description="Invitation links expire in seven days and work only for the intended verified email address."
              />
            )}
          </QueryState>
        </section>
      )}
      <Modal
        title="Invite someone home"
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      >
        {link ? (
          <>
            <Notice>
              Invitation created. No email was sent. Copy this link and share it
              with the intended person.
            </Notice>
            <input
              aria-label="Invitation link"
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
            />
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  toast("Invitation link copied.");
                } catch {
                  toast("Select and copy the invitation link above.");
                }
              }}
            >
              <Copy size={16} />
              Copy invitation link
            </Button>
          </>
        ) : (
          <RecordForm
            schema={z.object({
              email: z.email(),
              role: z.enum(["editor", "viewer"]),
            })}
            fields={[
              {
                name: "email",
                label: "Their email address",
                type: "email",
                full: true,
              },
              {
                name: "role",
                label: "Access level",
                type: "select",
                options: [
                  { value: "editor", label: "Editor" },
                  { value: "viewer", label: "Viewer" },
                ],
              },
            ]}
            values={{ email: "", role: "viewer" }}
            onSubmit={async (v) => {
              const r = await call("/invitations", { method: "POST", body: v });
              setLink(`${location.origin}/invite/${r.token}`);
              refresh();
            }}
            submitLabel="Create invitation link"
          />
        )}
      </Modal>
      <Modal
        title="Create a household"
        open={createOpen}
        onOpenChange={setCreateOpen}
      >
        <RecordForm
          schema={z.object({ name: z.string().min(1).max(100) })}
          fields={[{ name: "name", label: "Household name", full: true }]}
          onSubmit={async (v) => {
            const r = await api("/workspaces", {
              method: "POST",
              body: { ...v, kind: "household" },
            });
            refresh();
            setWorkspaceId(r.id);
            setCreateOpen(false);
            toast("Household created. You can now invite members.");
          }}
          submitLabel="Create household"
        />
      </Modal>
    </>
  );
}
export function Invitation() {
  const { token } = useParams();
  const { session, refresh, setWorkspaceId } = useApp();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (token) sessionStorage.setItem("afterbuy.invite", token);
  }, [token]);
  return (
    <div className="center-page">
      <Users size={36} />
      <h1>You’ve been invited.</h1>
      <p>
        Join a household to manage purchases and their aftercare together. Use
        the verified account this invitation was sent to.
      </p>
      <ErrorNotice error={error} />
      {!session ? (
        <Link className="btn btn-primary" to={`/auth?invite=${token}`}>
          Sign in to continue <ArrowRight size={16} />
        </Link>
      ) : (
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api("/invitations/accept", {
                method: "POST",
                body: { token },
              });
              sessionStorage.removeItem("afterbuy.invite");
              setWorkspaceId(r.workspace_id);
              refresh();
              navigate("/");
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Accept invitation
        </Button>
      )}
      <div className="mt-6">
        <Link
          className="text-link"
          to="/"
          onClick={() => sessionStorage.removeItem("afterbuy.invite")}
        >
          Continue without joining
        </Link>
      </div>
    </div>
  );
}
