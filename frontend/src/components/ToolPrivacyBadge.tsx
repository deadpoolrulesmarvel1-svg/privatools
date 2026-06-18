import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type ToolPrivacyBadgeProps = {
  clientOnly?: boolean;
  className?: string;
};

export function ToolPrivacyBadge({ clientOnly = false, className }: ToolPrivacyBadgeProps) {
  const label = clientOnly ? "Never uploaded" : "No third-party upload";
  const detail = clientOnly
    ? "This tool runs in your browser, so file contents are never uploaded."
    : "Files are processed only by the PrivaTools server and deleted after the response.";

  return (
    <span
      className={cn(
        "section-flag inline-flex items-center gap-1.5",
        "text-accent border-accent/40 bg-accent/[0.08]",
        className,
      )}
      title={detail}
      aria-label={`${label}: ${detail}`}
    >
      <ShieldCheck size={11} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
