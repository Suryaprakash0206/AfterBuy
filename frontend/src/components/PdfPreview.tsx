import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ErrorNotice, Loading } from "./ui";
GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({
  url,
  page: requestedPage,
  name,
}: {
  url: string;
  page: number;
  name: string;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(requestedPage);
  const [width, setWidth] = useState(400);
  const [error, setError] = useState<unknown>();
  const [rendering, setRendering] = useState(true);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    setPage(requestedPage);
  }, [requestedPage]);
  useEffect(() => {
    let active = true;
    setError(undefined);
    setPdf(undefined);
    const task = getDocument({ url });
    void task.promise
      .then((doc) => {
        if (active) setPdf(doc);
      })
      .catch((e) => {
        if (active) setError(e);
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [url]);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(160, entry.contentRect.width - 24)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true;
    let cancel: (() => void) | undefined;
    setRendering(true);
    void (async () => {
      try {
        const actual = Math.max(1, Math.min(page, pdf.numPages));
        const p = await pdf.getPage(actual);
        if (!active || !canvas.current) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = p.getViewport({
          scale: (width / p.getViewport({ scale: 1 }).width) * ratio,
        });
        const element = canvas.current;
        element.width = viewport.width;
        element.height = viewport.height;
        element.style.width = `${width}px`;
        element.style.height = `${viewport.height / ratio}px`;
        const task = p.render({ canvas: element, viewport });
        cancel = () => task.cancel();
        await task.promise;
      } catch (e) {
        if (active) setError(e);
      } finally {
        if (active) setRendering(false);
      }
    })();
    return () => {
      active = false;
      cancel?.();
    };
  }, [pdf, page, width]);
  const current = Math.max(1, Math.min(page, pdf?.numPages || 1));
  return (
    <div className="pdf-viewer" ref={frame}>
      <div className="pdf-controls">
        <Button
          variant="ghost"
          aria-label="Previous document page"
          disabled={!pdf || current <= 1}
          onClick={() => setPage(current - 1)}
        >
          <ChevronLeft size={17} />
        </Button>
        <span aria-live="polite">
          Page {current} of {pdf?.numPages ?? "…"}
        </span>
        <Button
          variant="ghost"
          aria-label="Next document page"
          disabled={!pdf || current >= pdf.numPages}
          onClick={() => setPage(current + 1)}
        >
          <ChevronRight size={17} />
        </Button>
      </div>
      <ErrorNotice error={error} />
      {(!pdf || rendering) && !error && (
        <Loading label="Rendering original document…" />
      )}
      <div className="pdf-page" aria-busy={rendering}>
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${name}, original page ${current}. Open the original document for selectable text.`}
        />
      </div>
    </div>
  );
}
