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
    <nav className="mirror-nav">
      <div className="mirror-nav-inner">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="mirror-nav-link"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
