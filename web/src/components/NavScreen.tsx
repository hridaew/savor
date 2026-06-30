import type { ReactNode } from 'react';

/** A naturally-scrolling page with an iOS large title. The floating top bar +
 *  tab bar are global chrome (rendered in App), so this is just the content. */
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
      <div className="large-title">
        {title}
        {subtitle && <span className="sub">{subtitle}</span>}
      </div>
      <div style={{ marginTop: 16 }}>{children}</div>
    </main>
  );
}
