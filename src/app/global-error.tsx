"use client";

/**
 * Last resort: the app's frame itself (menu and all) couldn't be shown, for
 * example when the database can't be reached. Kept plain on purpose.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, maxWidth: 560, lineHeight: 1.5 }}>
        <h1 style={{ fontSize: "1.4rem" }}>Versaa couldn&apos;t open this page</h1>
        <p>Something failed before the page could be shown. What was saved before is safe.</p>
        <p>
          <button type="button" onClick={reset} style={{ padding: "8px 14px", marginRight: 8 }}>
            Try again
          </button>
          <a href="/">Back to Today</a>
        </p>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          If it keeps happening in the desktop app, quit it and open it again.{error.digest ? ` Reference: ${error.digest}` : ""}
        </p>
      </body>
    </html>
  );
}
