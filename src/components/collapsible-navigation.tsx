"use client";

import { useId, useState, type ReactNode } from "react";

/** Always visible on desktop, user-controlled compact navigation on small screens. */
export function CollapsibleNavigation({ label, children }: { label: string; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <>
    <button type="button" className="nav-toggle" aria-controls={id} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{label}<span aria-hidden="true">{expanded ? "−" : "+"}</span></button>
    <nav id={id} className="collapsible-nav" data-expanded={expanded} aria-label={label} onClick={event => { if ((event.target as HTMLElement).closest("a")) setExpanded(false); }}>{children}</nav>
  </>;
}
