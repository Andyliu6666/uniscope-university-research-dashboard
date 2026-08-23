import { BookOpen, GitBranch, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';

export function Layout() {
  const [open, setOpen] = useState(false);
  const links = [
    ['/', 'Explore'],
    ['/compare', 'Compare'],
    ['/contribute', 'Contribute'],
  ] as const;
  return (
    <div className="site-shell">
      <header className="header">
        <Link to="/" className="brand" aria-label="UniScope home">
          <span className="brand-mark">
            <BookOpen size={19} />
          </span>{' '}
          UniScope
        </Link>
        <button
          className="menu-button"
          onClick={() => setOpen(!open)}
          aria-label="Toggle navigation"
        >
          {open ? <X /> : <Menu />}
        </button>
        <nav className={open ? 'nav open' : 'nav'}>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} onClick={() => setOpen(false)}>
              {label}
            </NavLink>
          ))}
          <a
            href="https://github.com/Andyliu6666/uniscope-university-research-dashboard"
            target="_blank"
            rel="noreferrer"
          >
            <GitBranch size={16} /> GitHub
          </a>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        <div>
          <span className="brand">UniScope</span>
          <p>Open university research, built by students.</p>
        </div>
        <div>
          <p>Information changes. Always confirm details on the linked official source.</p>
          <p>Open source · Non-profit · MIT licensed</p>
        </div>
      </footer>
    </div>
  );
}
