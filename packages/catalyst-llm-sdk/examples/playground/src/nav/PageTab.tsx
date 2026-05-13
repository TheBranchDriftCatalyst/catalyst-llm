/**
 * Single tab button inside the Header's nav. Renders icon + label
 * with optional streaming-indicator dot — used by Chat (chats are
 * streaming) and Compare (any compare run is streaming) tabs so the
 * operator can see live work without having to switch to that tab.
 */
import type { ElementType } from "react";

export interface PageTabProps {
  active: boolean;
  onClick: () => void;
  icon: ElementType;
  label: string;
  streaming?: boolean;
}

export function PageTab({
  active,
  onClick,
  icon: Icon,
  label,
  streaming,
}: PageTabProps) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`relative flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
      {streaming && (
        <span
          aria-label={`Stream in flight on ${label} tab`}
          title="Stream in flight on this tab"
          className="ml-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
        />
      )}
    </button>
  );
}
