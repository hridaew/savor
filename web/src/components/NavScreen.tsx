import type { ReactNode } from 'react';

/** A naturally-scrolling page with a large title. The floating top bar +
 *  tab bar are global chrome (rendered in App), so this is just the content.
 *  The `.page` class carries the view-transition-name for tab switches. */
export function NavScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="page">
      <h1 className="large-title">
        {title}
        {subtitle && <span className="sub">{subtitle}</span>}
      </h1>
      <div style={{ marginTop: 'var(--space-4)' }}>{children}</div>
    </main>
  );
}
