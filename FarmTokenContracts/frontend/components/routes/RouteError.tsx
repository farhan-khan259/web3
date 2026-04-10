"use client";

export default function RouteError({
  label,
  error,
  reset,
}: {
  label: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">{label} failed to load</h1>
      <p className="mt-2 text-sm opacity-80">{error.message || "Unexpected error"}</p>
      <button
        className="mt-4 rounded border px-3 py-2 text-sm"
        onClick={reset}
        type="button"
      >
        Retry
      </button>
    </section>
  );
}
