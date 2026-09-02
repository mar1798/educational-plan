import { NavLink, Outlet } from 'react-router-dom'
import { navSections } from './nav'

export function AppShell() {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <h1>Расписание колледжа</h1>
        {navSections.map((section) => (
          <div className="app-nav-section" key={section.title}>
            <div className="app-nav-section-title">{section.title}</div>
            {section.items.map((item) => (
              <NavLink key={item.path} to={item.path} className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </aside>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
