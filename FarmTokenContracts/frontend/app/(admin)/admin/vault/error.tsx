"use client";

import RouteError from "../../../../components/routes/RouteError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError label="Admin Vault" error={error} reset={reset} />;
}
