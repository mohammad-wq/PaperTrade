/**
 * Opens the system print dialog for a PDF blob. Falls back to a new tab only if print is blocked.
 */
export async function printPdfBlob(blob: Blob): Promise<void> {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;";
    iframe.src = objectUrl;
    document.body.appendChild(iframe);

    let printed = false;
    await new Promise<void>((resolve) => {
      const fallbackTimer = setTimeout(() => {
        if (!printed) {
          try {
            window.open(objectUrl, "_blank");
          } catch {
            /* ignore */
          }
          resolve();
        }
      }, 3000);

      iframe.onload = () => {
        setTimeout(() => {
          try {
            printed = true;
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } catch {
            try {
              window.focus();
              iframe.contentWindow?.print();
            } catch {
              window.open(objectUrl, "_blank");
            }
          }
          clearTimeout(fallbackTimer);
          setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
            try {
              document.body.removeChild(iframe);
            } catch {
              /* ignore */
            }
            resolve();
          }, 2500);
        }, 300);
      };
    });
  } catch {
    window.open(objectUrl, "_blank");
  }
}

/**
 * Replaces the unreliable PDF viewer (new tab approach) with browser print dialog.
 * Fetches the PDF from the API, creates a blob URL, loads it in a hidden iframe, and triggers print.
 * If iframe printing is blocked or restricted, gracefully falls back to opening the generated PDF.
 */
export async function printDocumentPdf(url: string): Promise<void> {
  const printUrl = url.replace(/[?&]download=true/g, "").replace(/&&/g, "&").replace(/\?&/, "?");

  const res = await fetch(printUrl, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to load document (${res.status})`);
  }

  await printPdfBlob(await res.blob());
}

/** Draft documents: POST /api/pdf/preview then print immediately (no in-app preview). */
export async function printDraftPdf(payload: object): Promise<void> {
  const res = await fetch("/api/pdf/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || "Failed to generate document PDF");
  }
  await printPdfBlob(await res.blob());
}

