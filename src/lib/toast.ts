"use client";

// Universal lightweight notification utility for CPA-grade UI feedback
export const toast = {
  success: (message: string) => {
    if (typeof window !== "undefined") {
      const container = getOrCreateToastContainer();
      renderToast(container, message, "success");
    }
  },
  error: (message: string) => {
    if (typeof window !== "undefined") {
      const container = getOrCreateToastContainer();
      renderToast(container, message, "error");
    }
  },
  info: (message: string) => {
    if (typeof window !== "undefined") {
      const container = getOrCreateToastContainer();
      renderToast(container, message, "info");
    }
  },
};

function getOrCreateToastContainer(): HTMLElement {
  let container = document.getElementById("universal-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "universal-toast-container";
    container.style.position = "fixed";
    container.style.bottom = "20px";
    container.style.right = "20px";
    container.style.zIndex = "9999";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.pointerEvents = "none";
    document.body.appendChild(container);
  }
  return container;
}

function renderToast(container: HTMLElement, message: string, type: "success" | "error" | "info") {
  const toastEl = document.createElement("div");
  toastEl.style.padding = "10px 16px";
  toastEl.style.borderRadius = "8px";
  toastEl.style.fontSize = "13px";
  toastEl.style.fontWeight = "600";
  toastEl.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)";
  toastEl.style.pointerEvents = "auto";
  toastEl.style.transition = "all 0.2s ease-in-out";
  toastEl.style.display = "flex";
  toastEl.style.alignItems = "center";
  toastEl.style.gap = "8px";

  if (type === "success") {
    toastEl.style.backgroundColor = "#065f46";
    toastEl.style.color = "#ffffff";
  } else if (type === "error") {
    toastEl.style.backgroundColor = "#991b1b";
    toastEl.style.color = "#ffffff";
  } else {
    toastEl.style.backgroundColor = "#1e293b";
    toastEl.style.color = "#ffffff";
  }

  toastEl.textContent = message;
  container.appendChild(toastEl);

  setTimeout(() => {
    toastEl.style.opacity = "0";
    toastEl.style.transform = "translateY(8px)";
    setTimeout(() => {
      if (toastEl.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
      }
    }, 200);
  }, 3500);
}
