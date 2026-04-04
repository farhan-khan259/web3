import Link from "next/link";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/vault", label: "Vault" },
  { href: "/borrow", label: "Borrow" },
  { href: "/revenue", label: "Revenue" },
  { href: "/oracle-admin", label: "Oracle Admin" },
];

export default function AppNav() {
  return (
    <nav className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-6 py-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-cyan-400 hover:text-cyan-300"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
