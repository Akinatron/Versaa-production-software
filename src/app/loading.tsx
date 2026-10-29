/** While a page is on its way. It only appears if loading takes a moment, so quick pages don't flicker. */
export default function Loading() {
  return (
    <div>
      <p className="page-loading muted" role="status">
        Loading…
      </p>
    </div>
  );
}
