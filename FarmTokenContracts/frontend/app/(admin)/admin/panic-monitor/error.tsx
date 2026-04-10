"use client";

import RouteError from "../../../../components/routes/RouteError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError label="Admin Panic Monitor" error={error} reset={reset} />;
}
