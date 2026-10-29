"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Shown when a page fails in a way the app didn't expect. The side menu
 * stays, and there is always a way back. Business errors (not enough stock,
 * a missing field) are shown on the form itself and never get here.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="card error-page" role="alert">
      <h1>Something went wrong</h1>
      <p>This page couldn&apos;t be shown. What was saved before is safe.</p>
      <p className="small muted">If you had just pressed a button, check the page it was for before doing it again: it may have been saved.</p>
      <div className="row">
        <button type="button" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="btn secondary">
          Back to Today
        </Link>
      </div>
      {error.digest && <p className="small muted">Reference: {error.digest}</p>}
    </section>
  );
}
