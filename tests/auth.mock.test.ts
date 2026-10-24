import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
const mocked = vi.hoisted(() => ({ getUser: vi.fn(), userClient: vi.fn() }));
vi.mock("../backend/src/lib/db.js", () => ({
  userClient: mocked.userClient,
  result: vi.fn(),
}));
import { authenticate } from "../backend/src/lib/auth.js";

// Mock only Supabase's server verification response, never production authentication.
describe("email confirmation is optional; verified sessions remain required", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.userClient.mockReturnValue({ auth: { getUser: mocked.getUser } });
  });
  it("accepts a Supabase-authenticated user without email_confirmed_at", async () => {
    mocked.getUser.mockResolvedValue({
      data: { user: { id: "signed-in-user", email_confirmed_at: null } },
      error: null,
    });
    const req: any = { headers: { authorization: "Bearer test-session" } };
    const next = vi.fn();
    await authenticate(req, {} as any, next);
    expect(mocked.getUser).toHaveBeenCalledWith("test-session");
    expect(req.userId).toBe("signed-in-user");
    expect(next).toHaveBeenCalledOnce();
  });
  it("still rejects a token that Supabase does not authenticate", async () => {
    mocked.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid token" },
    });
    const next = vi.fn();
    await expect(
      authenticate(
        { headers: { authorization: "Bearer invalid" } } as any,
        {} as any,
        next,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(next).not.toHaveBeenCalled();
  });
  it("reports an auth outage without treating the session as expired", async () => {
    mocked.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("fetch failed", 0),
    });
    await expect(
      authenticate(
        { headers: { authorization: "Bearer test-session" } } as any,
        {} as any,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 503, code: "AUTH_UNAVAILABLE" });
  });
});
