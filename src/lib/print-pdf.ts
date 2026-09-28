/**
 * Replaces the unreliable PDF viewer (new tab approach) with browser print dialog.
 * Fetches the PDF from the API, creates a blob URL, loads it in a hidden iframe, and triggers print.
 * If iframe printing is blocked or restricted, gracefully falls back to opening the generated PDF.
 */
export async function printDocumentPdf(url: string): Promise<void> {
  // Remove any ?download=true since we are printing, not downloading
  const printUrl = url.replace(/[?&]download=true/g, "").replace(/&&/g, "&").replace(/\?&/, "?");

  const res = await fetch(printUrl, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to load document (${res.status})`);
  }

  const blob = await res.blob();
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
          } catch {}
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
            } catch {}
            resolve();
          }, 2500);
        }, 300);
      };
    });
  } catch (err) {
    window.open(objectUrl, "_blank");
  }
}
