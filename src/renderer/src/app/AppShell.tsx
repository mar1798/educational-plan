import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { navSections } from './nav'

export function AppShell() {
  const location = useLocation()
  const content = useRef<HTMLElement>(null)

  // Прокрутка сбрасывается при переходе в другой раздел: иначе после длинного календаря
  // короткая страница («Сетка звонков», «Генерация») открывалась прокрученной ниже
  // заголовка и выглядела пустой.
  useEffect(() => {
    content.current?.scrollTo(0, 0)
  }, [location.pathname])

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
      <main className="app-content" ref={content}>
        <Outlet />
      </main>
    </div>
  )
}
