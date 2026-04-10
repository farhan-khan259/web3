export default function RouteLoading({ label }: { label: string }) {
  return (
    <section className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Loading {label}...</h1>
      <div className="mt-4 animate-pulse rounded-lg border p-4">
        <div className="h-4 w-1/3 rounded bg-slate-300/40" />
        <div className="mt-3 h-4 w-2/3 rounded bg-slate-300/30" />
        <div className="mt-3 h-4 w-1/2 rounded bg-slate-300/20" />
      </div>
    </section>
  );
}
