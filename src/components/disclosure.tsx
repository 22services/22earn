"use client";

import { useState, type ReactNode } from "react";

/**
 * <details> whose open/closed state belongs to the browser after the first render.
 * The initial value is frozen, so React never re-applies (or removes) the `open`
 * attribute when a server action revalidates the page — e.g. the invite link stays
 * visible right after inviting the very first creator.
 */
export function Disclosure({ summary, summaryClassName, defaultOpen = false, children }: { summary: ReactNode; summaryClassName?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [initialOpen] = useState(defaultOpen);
  return (
    <details open={initialOpen} className="group">
      <summary className={summaryClassName}>{summary}</summary>
      {children}
    </details>
  );
}
