import { useEffect, useState } from "react";
import { useLLM } from "../../react/hooks.js";
import { cn } from "../utils.js";

export interface ConnectionStatusProps {
  /** Polling interval in ms; 0 disables polling. Defaults to 30s. */
  pollIntervalMs?: number;
  className?: string;
  /** Show the base URL next to the dot. */
  showUrl?: boolean;
}

export function ConnectionStatus({
  pollIntervalMs = 30000,
  className,
  showUrl = true,
}: ConnectionStatusProps) {
  const client = useLLM();
  const [status, setStatus] = useState<"unknown" | "ok" | "error">("unknown");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const ok = await client.verifyConnection(5000);
      if (!cancelled) setStatus(ok ? "ok" : "error");
    };
    void check();
    if (pollIntervalMs > 0) {
      const id = setInterval(check, pollIntervalMs);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [client, pollIntervalMs]);

  const dotColor =
    status === "ok"
      ? "bg-green-500"
      : status === "error"
        ? "bg-red-500"
        : "bg-yellow-500";

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground",
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", dotColor)} />
      {showUrl && (
        <span className="hidden sm:inline">{client.config.baseUrl}</span>
      )}
    </div>
  );
}
