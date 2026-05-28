import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './staffPages.css';

export function StaffLayout({
  title,
  backTo = '/app',
  children,
}: {
  title: string;
  backTo?: string;
  children: ReactNode;
}) {
  return (
    <div className="staff-area">
      <header className="staff-area__bar">
        <Link className="staff-area__back" to={backTo}>
          ←
        </Link>
        <h1 className="staff-area__title">{title}</h1>
        <span className="staff-area__spacer" aria-hidden />
      </header>
      <main className="staff-area__main">{children}</main>
    </div>
  );
}
