import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerUpload } from "../backend/src/modules/documents/registration";
const params = {
  w: "workspace",
  p_name: "invoice.pdf",
  p_mime: "application/pdf",
  p_size: 100,
  p_pages: 1,
  p_hash: "hash",
  p_kind: "invoice",
  p_product: null,
};
const deleted = {
  id: "old",
  workspace_id: "workspace",
  status: "deleting",
  upload_complete: true,
};
const fresh = {
  document: { id: "new", workspace_id: "workspace", status: "uploading" },
  duplicate: false,
};
function setup(
  document = deleted,
  options: { missing?: boolean; storageError?: boolean } = {},
) {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: { document, duplicate: true }, error: null })
    .mockResolvedValueOnce({ data: fresh, error: null });
  const eq = vi.fn();
  const remove = vi
    .fn()
    .mockResolvedValue({
      error: options.storageError ? { message: "offline" } : null,
    });
  const deletion = vi.fn();
  const query: any = {
    select: vi.fn().mockReturnThis(),
    eq,
    maybeSingle: vi
      .fn()
      .mockResolvedValue({
        data: options.missing
          ? null
          : { id: "old", storage_path: "workspace/old" },
        error: null,
      }),
    delete: deletion,
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
  };
  eq.mockReturnValue(query);
  deletion.mockReturnValue(query);
  const admin = {
    from: vi.fn().mockReturnValue(query),
    storage: { from: vi.fn().mockReturnValue({ remove }) },
  };
  const privileged = vi.fn(() => admin as unknown as SupabaseClient);
  return {
    rpc,
    remove,
    deletion,
    eq,
    privileged,
    db: { rpc } as unknown as SupabaseClient,
  };
}
describe("re-uploading a deleted invoice", () => {
  it("removes only the tombstoned object then registers a fresh document", async () => {
    const mock = setup();
    expect(await registerUpload(mock.db, params, mock.privileged)).toEqual(
      fresh,
    );
    expect(mock.remove).toHaveBeenCalledWith(["workspace/old"]);
    expect(mock.eq).toHaveBeenCalledWith("workspace_id", "workspace");
    expect(mock.eq).toHaveBeenCalledWith("status", "deleting");
    expect(mock.deletion).toHaveBeenCalledOnce();
    expect(mock.rpc).toHaveBeenCalledTimes(2);
    expect(mock.rpc.mock.calls[0][1].p_id).not.toBe(
      mock.rpc.mock.calls[1][1].p_id,
    );
  });
  it("returns an ordinary duplicate without touching its stored file", async () => {
    const mock = setup({ ...deleted, status: "completed" });
    expect(
      (await registerUpload(mock.db, params, mock.privileged)).document.status,
    ).toBe("completed");
    expect(mock.privileged).not.toHaveBeenCalled();
  });
  it("retains the database row if private storage cleanup fails", async () => {
    const mock = setup(deleted, { storageError: true });
    await expect(
      registerUpload(mock.db, params, mock.privileged),
    ).rejects.toMatchObject({ code: "DOCUMENT_DELETION_PENDING", status: 409 });
    expect(mock.deletion).not.toHaveBeenCalled();
    expect(mock.rpc).toHaveBeenCalledOnce();
  });
  it("handles another worker finishing deletion first", async () => {
    const mock = setup(deleted, { missing: true });
    expect(await registerUpload(mock.db, params, mock.privileged)).toEqual(
      fresh,
    );
    expect(mock.remove).not.toHaveBeenCalled();
  });
  it("never cleans up a row from another workspace", async () => {
    const mock = setup({ ...deleted, workspace_id: "other" });
    await expect(
      registerUpload(mock.db, params, mock.privileged),
    ).rejects.toMatchObject({ status: 403 });
    expect(mock.privileged).not.toHaveBeenCalled();
  });
  it("does not bypass failed user authorization using the service credential", async () => {
    const mock = setup();
    mock.rpc
      .mockReset()
      .mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(
      registerUpload(mock.db, params, mock.privileged),
    ).rejects.toMatchObject({ status: 403 });
    expect(mock.privileged).not.toHaveBeenCalled();
  });
});
