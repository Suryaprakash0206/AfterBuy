import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
const privileged = vi.hoisted(() => ({ db: null as any }));
vi.mock("../backend/src/lib/db.js", async (load) => ({
  ...(await load<any>()),
  adminClient: () => privileged.db,
}));
import { documentRoutes } from "../backend/src/modules/documents/routes";
import { errorHandler } from "../backend/src/lib/errors";
const id = "00000000-0000-4000-8000-000000000001";
function chain(data: any) {
  const value: any = {
    then: (resolve: any) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
  };
  for (const method of ["select", "eq", "in", "delete"])
    value[method] = vi.fn().mockReturnValue(value);
  value.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  return value;
}
function fixture(storageFails = false, role = "editor") {
  const document = chain({ accepted_product_ids: ["created-product"] });
  const products = chain(null);
  const db = {
    from: vi.fn((table: string) =>
      table === "products" ? products : document,
    ),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const removed = chain({ id, storage_path: `workspace/${id}` });
  const storageRemove = vi
    .fn()
    .mockResolvedValue({ error: storageFails ? { message: "offline" } : null });
  privileged.db = {
    from: vi.fn().mockReturnValue(removed),
    storage: { from: vi.fn().mockReturnValue({ remove: storageRemove }) },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      db,
      role,
      workspaceId: "workspace",
      userId: "user",
      requestId: "test",
    });
    next();
  });
  app.use(documentRoutes);
  app.use(errorHandler);
  return { app, db, products, removed, storageRemove };
}
describe("document deletion API", () => {
  it("finishes file and row deletion immediately while keeping products by default", async () => {
    const f = fixture();
    const response = await request(f.app).delete(`/documents/${id}`);
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("deleted");
    expect(f.products.delete).not.toHaveBeenCalled();
    expect(f.storageRemove).toHaveBeenCalledWith([`workspace/${id}`]);
    expect(f.removed.delete).toHaveBeenCalledOnce();
    expect(f.removed.eq).toHaveBeenCalledWith("status", "deleting");
  });
  it("deletes only original created products in the same workspace after explicit selection", async () => {
    const f = fixture();
    expect(
      (
        await request(f.app)
          .delete(`/documents/${id}`)
          .send({ delete_created_products: true })
      ).status,
    ).toBe(200);
    expect(f.products.delete).toHaveBeenCalledOnce();
    expect(f.products.eq).toHaveBeenCalledWith("workspace_id", "workspace");
    expect(f.products.in).toHaveBeenCalledWith("id", ["created-product"]);
  });
  it("keeps a tombstone for automatic retry when storage is unavailable", async () => {
    const f = fixture(true);
    const response = await request(f.app).delete(`/documents/${id}`);
    expect(response.status).toBe(202);
    expect(response.body.status).toBe("deleting");
    expect(f.removed.delete).not.toHaveBeenCalled();
  });
  it("denies deletion to viewers", async () => {
    const f = fixture(false, "viewer");
    expect(
      (
        await request(f.app)
          .delete(`/documents/${id}`)
          .send({ delete_created_products: true })
      ).status,
    ).toBe(403);
    expect(f.db.from).not.toHaveBeenCalled();
    expect(f.storageRemove).not.toHaveBeenCalled();
  });
  it("rejects nonboolean deletion options without deleting anything", async () => {
    const f = fixture();
    expect(
      (
        await request(f.app)
          .delete(`/documents/${id}`)
          .send({ delete_created_products: "true" })
      ).status,
    ).toBe(400);
    expect(f.db.from).not.toHaveBeenCalled();
  });
});
