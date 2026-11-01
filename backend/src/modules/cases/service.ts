import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { idSchema } from "../../../../shared/domain.js";
import { result, eventFields } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { getProduct } from "../products/repository.js";
import { safeFilename } from "../documents/service.js";
export const packageSchema = z
  .object({
    document_ids: z.array(idSchema).max(15),
    include_serial: z.boolean().default(false),
    include_cost: z.boolean().default(true),
    include_contact: z.boolean().default(false),
    include_timeline: z.boolean().default(true),
    message: z.string().max(6000).optional(),
  })
  .strict();
export function assertEvidenceIsSafe(
  document: { kind: string; accepted_product_ids?: string[] | null },
  links: { product_id: string }[],
  productId: string,
) {
  if (!links.some((l) => l.product_id === productId))
    throw new AppError(
      403,
      "UNRELATED_EVIDENCE",
      "Evidence must belong to this product.",
    );
  if (
    links.some((l) => l.product_id !== productId) ||
    (document.kind === "invoice" && document.accepted_product_ids?.length !== 1)
  )
    throw new AppError(
      409,
      "SHARED_INVOICE",
      "This document is shared or its invoice items have not been confirmed. Confirm a single-product invoice, or upload a separately prepared copy as a service document for this product.",
    );
}
export async function buildPackage(
  db: SupabaseClient,
  w: string,
  caseId: string,
  options: z.infer<typeof packageSchema>,
) {
  const serviceCase = await result(
    db
      .from("service_cases")
      .select("*")
      .eq("workspace_id", w)
      .eq("id", caseId)
      .single(),
  );
  const p = await getProduct(db, w, serviceCase.product_id);
  const product = {
    id: p.id,
    name: p.name,
    brand: p.brand,
    model: p.model,
    specifications: p.specifications,
    serial_number: options.include_serial ? p.serial_number : undefined,
    seller: p.seller,
    purchase_date: p.purchase_date,
    price: options.include_cost ? p.price : undefined,
    currency: p.currency,
  };
  const coverage = await result(
    db
      .from("coverage")
      .select(
        "kind,provider,start_date,end_date,components,conditions,exclusions",
      )
      .eq("workspace_id", w)
      .eq("product_id", p.id)
      .eq("confirmed", true),
  );
  const timeline = options.include_timeline
    ? await result(
        db
          .from("case_events")
          .select(eventFields)
          .eq("workspace_id", w)
          .eq("case_id", caseId)
          .order("occurred_on")
          .order("created_at"),
      )
    : [];
  const documents: any[] = [];
  for (const id of [...new Set(options.document_ids)]) {
    const d = await result(
      db
        .from("documents")
        .select("*")
        .eq("workspace_id", w)
        .eq("id", id)
        .neq("status", "deleting")
        .single(),
    );
    const links = await result(
      db
        .from("document_links")
        .select("product_id")
        .eq("workspace_id", w)
        .eq("document_id", id),
    );
    assertEvidenceIsSafe(d, links, p.id);
    documents.push({
      id: d.id,
      name: d.name,
      mime: d.mime,
      size_bytes: d.size_bytes,
      storage_path: d.storage_path,
    });
  }
  if (documents.reduce((sum, d) => sum + d.size_bytes, 0) > 80 * 1024 * 1024)
    throw new AppError(
      413,
      "PACKAGE_LIMIT",
      "Keep selected evidence under 80 MB.",
    );
  const contact = options.include_contact
    ? {
        support_contact: serviceCase.support_contact,
        reference: serviceCase.reference,
      }
    : undefined;
  const draft =
    options.message ??
    `Hello,\n\nI am requesting assistance with ${p.name}${p.model ? ` (${p.model})` : ""}${p.purchase_date ? `, purchased on ${p.purchase_date}` : ""}.\n\n${serviceCase.description}\n\nThe issue was noticed on ${serviceCase.occurred_on}. Please advise on the next steps and the evidence you require. The attached summary includes the recorded purchase and confirmed coverage information; eligibility for this issue requires your assessment.\n\nThank you.`;
  return {
    product,
    case: {
      id: serviceCase.id,
      title: serviceCase.title,
      description: serviceCase.description,
      occurred_on: serviceCase.occurred_on,
      status: serviceCase.status,
      ...contact,
    },
    coverage,
    timeline: timeline.map((e) => ({
      ...e,
      amount: options.include_cost ? e.amount : undefined,
    })),
    documents,
    draft,
    notice:
      "Recorded coverage dates do not establish whether this issue is covered.",
  };
}
type SupportPackage = Awaited<ReturnType<typeof buildPackage>>;
export async function renderPackagePdf(pkg: SupportPackage) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("AfterBuy support summary");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  let y = 790;
  const navy = rgb(20 / 255, 45 / 255, 78 / 255);
  function line(text: string, size = 10, strong = false) {
    const face = strong ? bold : font;
    const plain = text.normalize("NFKD").replace(/[^\x20-\x7E\n]/g, "?");
    const words = plain.split(/\s+/);
    let row = "";
    const flush = () => {
      if (y < 55) {
        page = pdf.addPage([595, 842]);
        y = 790;
      }
      page.drawText(row, { x: 48, y, size, font: face, color: navy });
      y -= size + 6;
      row = "";
    };
    for (const word of words) {
      if (face.widthOfTextAtSize(`${row} ${word}`, size) > 495 && row) flush();
      if (word.length > 80) {
        for (let i = 0; i < word.length; i += 70) {
          row = word.slice(i, i + 70);
          flush();
        }
      } else row += (row ? " " : "") + word;
    }
    if (row) flush();
  }
  function section(title: string) {
    y -= 14;
    line(title, 13, true);
    y -= 3;
  }
  line("AFTERBUY", 11, true);
  line("Support summary", 24, true);
  line(`Prepared ${new Date().toISOString().slice(0, 10)}`);
  section("Product & purchase");
  for (const [key, value] of Object.entries(pkg.product))
    if (value != null && key !== "id")
      line(`${key.replaceAll("_", " ")}: ${value}`);
  section("Issue");
  line(pkg.case.title, 12, true);
  line(pkg.case.description);
  line(`First noticed: ${pkg.case.occurred_on} | Status: ${pkg.case.status}`);
  if (pkg.case.reference) line(`Reference: ${pkg.case.reference}`);
  if (pkg.case.support_contact)
    line(`Support contact: ${pkg.case.support_contact}`);
  section("Confirmed coverage");
  if (!pkg.coverage.length) line("No confirmed coverage recorded.");
  for (const c of pkg.coverage) {
    line(
      `${c.provider} (${c.kind}): ${c.start_date} to ${c.end_date}`,
      10,
      true,
    );
    if (c.components) line(`Applies to: ${c.components}`);
    if (c.conditions) line(`Conditions: ${c.conditions}`);
    if (c.exclusions) line(`Exclusions: ${c.exclusions}`);
  }
  line(pkg.notice);
  if (pkg.timeline.length) {
    section("Case timeline");
    for (const e of pkg.timeline)
      line(
        `${e.occurred_on} - ${e.kind}: ${e.note}${e.amount ? ` (${e.currency} ${e.amount})` : ""}`,
      );
  }
  section("Selected evidence");
  if (!pkg.documents.length) line("No original attachments selected.");
  for (const d of pkg.documents) line(d.name);
  section("Draft support message");
  for (const paragraph of pkg.draft.split("\n")) {
    if (paragraph) line(paragraph);
    else y -= 5;
  }
  return pdf.save();
}
export async function renderPackageZip(
  db: SupabaseClient,
  pkg: SupportPackage,
  pdf: Uint8Array,
) {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    output.on("data", (chunk) => chunks.push(chunk));
    output.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    output.on("error", reject);
  });
  archive.pipe(output);
  archive.append(Buffer.from(pdf), { name: "support-summary.pdf" });
  archive.append(pkg.draft, { name: "draft-message.txt" });
  archive.append(
    JSON.stringify(
      {
        ...pkg,
        documents: pkg.documents.map(({ storage_path: _path, ...d }) => d),
      },
      null,
      2,
    ),
    { name: "support-summary.json" },
  );
  try {
    for (let i = 0; i < pkg.documents.length; i++) {
      const d = pkg.documents[i];
      const { data, error } = await db.storage
        .from("documents")
        .download(d.storage_path);
      if (error)
        throw new AppError(
          502,
          "EVIDENCE_DOWNLOAD_FAILED",
          "An attachment could not be downloaded. Try the export again.",
        );
      archive.append(Buffer.from(await data.arrayBuffer()), {
        name: `evidence/${i + 1}-${safeFilename(d.name)}`,
      });
    }
    await archive.finalize();
    return await done;
  } catch (e) {
    archive.abort();
    output.destroy();
    throw e;
  }
}
