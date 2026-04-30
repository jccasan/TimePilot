import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { reportError } from "./lib/errorReporter";

window.addEventListener("vite:preloadError", () => {
  window.dispatchEvent(new Event("app:update-available"));
});

window.onerror = function (message, _source, _lineno, _colno, error) {
  if (String(message).includes("Unable to preload")) return;
  reportError(error?.message || String(message), error?.stack, "js");
};

window.onunhandledrejection = function (event) {
  const reason = event.reason;
  const message =
    reason instanceof Error ? reason.message : String(reason ?? "Unhandled promise rejection");
  if (message.includes("Unable to preload")) return;
  const stack = reason instanceof Error ? reason.stack : undefined;
  reportError(message, stack, "js");
};

createRoot(document.getElementById("root")!).render(<App />);
