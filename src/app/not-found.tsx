import Link from "next/link";

/** An address that doesn't lead anywhere: an old link, or a record that no longer exists. */
export default function NotFound() {
  return (
    <section className="card error-page">
      <h1>Page not found</h1>
      <p>There&apos;s nothing at this address. The link may be old, or what it pointed to may not exist.</p>
      <div className="row">
        <Link href="/" className="btn">
          Back to Today
        </Link>
        <Link href="/history" className="btn secondary">
          Look it up in History
        </Link>
      </div>
    </section>
  );
}
