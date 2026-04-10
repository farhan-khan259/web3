export default function RouteScreen({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <section className="mx-auto max-w-5xl p-6">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm opacity-80">{subtitle}</p>
    </section>
  );
}
