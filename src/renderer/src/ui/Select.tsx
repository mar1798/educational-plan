import {
  Children,
  useCallback,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * Замена нативному `<select>`.
 *
 * Нативный список в Electron на macOS раскрывается системным меню: его ширина повторяет
 * ширину поля (на «Импорте» это было 1094 px), высота не ограничена, и в справочниках на
 * 140 преподавателей меню занимало почти весь экран. Плюс нативное поле не поддавалось
 * стилям: 21 px против 36 px у соседних кнопок в тех же панелях.
 *
 * Здесь список рисуется сами: ширина ограничена MAX_MENU_WIDTH, высота — MAX_MENU_HEIGHT со
 * своей прокруткой, при длинном списке сверху появляется строка поиска.
 *
 * API намеренно повторяет нативное поле: внутрь кладутся те же `<option>`, поэтому списки
 * опций на страницах не переписывались. Отличие одно — `onChange` отдаёт сразу строковое
 * значение, а не событие.
 */

const MAX_MENU_HEIGHT = 288
const MAX_MENU_WIDTH = 420
const MIN_MENU_WIDTH = 180
/** С этого числа опций листать глазами уже дольше, чем набрать пару букв. */
const SEARCH_THRESHOLD = 12
const MENU_GAP = 4
const VIEWPORT_MARGIN = 8

interface SelectOption {
  value: string
  label: ReactNode
  text: string
  disabled: boolean
}

export interface SelectProps {
  value: string | number | null | undefined
  onChange: (value: string) => void
  children?: ReactNode
  disabled?: boolean
  id?: string
  className?: string
  /** Подпись, когда значения нет и среди опций нет пустой. */
  placeholder?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  title?: string
}

/** Собирает текст из произвольного узла: нужен для поиска и для набора с клавиатуры. */
function nodeText(node: ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children)
  return ''
}

/** Разворачивает `<option>` из детей: массивы из .map(), фрагменты и `cond && <option/>`. */
function collectOptions(node: ReactNode, out: SelectOption[]): void {
  Children.forEach(node, (child) => {
    if (child == null || typeof child === 'boolean') return
    if (Array.isArray(child)) {
      collectOptions(child, out)
      return
    }
    if (!isValidElement(child)) return
    const props = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean }
    if (child.type === 'option') {
      out.push({
        value: props.value == null ? '' : String(props.value),
        label: props.children,
        text: nodeText(props.children),
        disabled: props.disabled === true,
      })
      return
    }
    collectOptions(props.children, out)
  })
}

export function Select({
  value,
  onChange,
  children,
  disabled,
  id,
  className,
  placeholder,
  title,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SelectProps): React.JSX.Element {
  const options = useMemo(() => {
    const acc: SelectOption[] = []
    collectOptions(children, acc)
    return acc
  }, [children])

  const current = value == null ? '' : String(value)
  const selected = options.find((o) => o.value === current)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ buffer: '', at: 0 })
  const listId = useId()

  const withSearch = options.length >= SEARCH_THRESHOLD
  const visible = useMemo(() => {
    if (!withSearch || query.trim() === '') return options
    const q = query.trim().toLowerCase()
    return options.filter((o) => o.text.toLowerCase().includes(q))
  }, [options, query, withSearch])

  // Сеттеры перечислены в зависимостях явно: без них React Compiler считает, что ручная
  // мемоизация не совпадает с выведенной, и отказывается оптимизировать весь компонент.
  const close = useCallback(
    (focusTrigger: boolean): void => {
      setOpen(false)
      setQuery('')
      if (focusTrigger) triggerRef.current?.focus()
    },
    [setOpen, setQuery],
  )

  const pick = (option: SelectOption | undefined, focusTrigger = true): void => {
    if (!option || option.disabled) return
    if (option.value !== current) onChange(option.value)
    close(focusTrigger)
  }

  // Активный пункт выставляется в момент открытия, а не эффектом на `open`:
  // иначе список успевал отрисоваться с подсветкой первой строки и дёргался.
  const openMenu = (): void => {
    const start = options.findIndex((o) => o.value === current)
    setActiveIndex(start >= 0 ? start : 0)
    // Внутри модального диалога меню обязано жить в его поддереве: Radix гасит
    // `pointer-events` на <body> и держит ловушку фокуса, поэтому портал в body давал
    // список, сквозь который клик проваливался, а строка поиска теряла фокус.
    setPortalRoot(triggerRef.current?.closest<HTMLElement>('[data-select-portal-root]') ?? document.body)
    setOpen(true)
  }

  // Позиция считается в координатах вьюпорта (position: fixed): меню живёт в портале,
  // иначе его обрезали бы прокручиваемые контейнеры — таблицы и тело диалога.
  const place = useCallback((): void => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN
    const above = rect.top - MENU_GAP - VIEWPORT_MARGIN
    const dropUp = below < Math.min(MAX_MENU_HEIGHT, 160) && above > below
    const height = Math.min(MAX_MENU_HEIGHT, Math.max(dropUp ? above : below, 120))
    // Ширина — по содержимому, но не уже поля и не шире MAX_MENU_WIDTH: длинные ФИО
    // читаются целиком, а список из коротких вариантов не растягивается на пол-экрана.
    const minWidth = Math.max(rect.width, MIN_MENU_WIDTH)
    const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), Math.max(window.innerWidth - minWidth - VIEWPORT_MARGIN, VIEWPORT_MARGIN))
    setMenuStyle({
      position: 'fixed',
      left: Math.round(left),
      minWidth: Math.round(minWidth),
      maxWidth: Math.round(Math.min(MAX_MENU_WIDTH, window.innerWidth - left - VIEWPORT_MARGIN)),
      width: 'max-content',
      maxHeight: height,
      ...(dropUp
        ? { bottom: Math.round(window.innerHeight - rect.top + MENU_GAP) }
        : { top: Math.round(rect.bottom + MENU_GAP) }),
    })
  }, [setMenuStyle])

  useLayoutEffect(() => {
    if (!open) return
    place()
  }, [open, place, visible.length])

  useEffect(() => {
    if (!open) return
    const onScrollOrResize = (): void => place()
    // capture: список может лежать внутри прокручиваемой таблицы или диалога.
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, close])

  // Escape перехватывается на window: Radix вешает свой обработчик на document, а фаза
  // перехвата на window идёт раньше — иначе один Escape закрывал бы и список, и диалог,
  // внутри которого список открыт.
  useEffect(() => {
    if (!open) return
    const onEscape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      close(true)
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [open, close])

  useEffect(() => {
    if (open && withSearch) searchRef.current?.focus()
  }, [open, withSearch])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const step = (delta: number): void => {
    if (visible.length === 0) return
    setActiveIndex((prev) => {
      let next = prev
      for (let i = 0; i < visible.length; i += 1) {
        next = (next + delta + visible.length) % visible.length
        if (visible[next]?.disabled === false) return next
      }
      return prev
    })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openMenu()
      }
      return
    }
    // Escape сюда не доходит: он перехвачен обработчиком на window (см. эффект выше).
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        step(1)
        return
      case 'ArrowUp':
        e.preventDefault()
        step(-1)
        return
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        return
      case 'End':
        e.preventDefault()
        setActiveIndex(Math.max(visible.length - 1, 0))
        return
      case 'Enter':
        e.preventDefault()
        pick(visible[activeIndex])
        return
      // Tab подтверждает подсвеченный вариант и уходит дальше по форме — фокус не перехватываем.
      case 'Tab':
        pick(visible[activeIndex], false)
        return
      default:
        break
    }
    // Набор первых букв работает только без строки поиска — иначе буквы уходят в неё.
    if (!withSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now()
      const buffer = now - typeahead.current.at > 800 ? e.key : typeahead.current.buffer + e.key
      typeahead.current = { buffer, at: now }
      const hit = visible.findIndex((o) => !o.disabled && o.text.toLowerCase().startsWith(buffer.toLowerCase()))
      if (hit >= 0) setActiveIndex(hit)
    }
  }

  const label = selected ? selected.label : (placeholder ?? '')
  const empty = selected == null || selected.text.trim() === ''

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`select-trigger${open ? ' select-trigger-open' : ''}${className ? ` ${className}` : ''}`}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={`select-value${empty ? ' select-value-empty' : ''}`}>
          {empty && placeholder ? placeholder : label}
        </span>
        <span className="select-caret" aria-hidden="true" />
      </button>
      {open &&
        portalRoot != null &&
        createPortal(
          <div className="select-menu" ref={menuRef} style={menuStyle} onKeyDown={onKeyDown}>
            {withSearch && (
              <div className="select-search">
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  placeholder="Поиск…"
                  aria-label="Поиск по списку"
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setActiveIndex(0)
                  }}
                />
              </div>
            )}
            <div className="select-list" role="listbox" id={listId} ref={listRef} tabIndex={-1}>
              {visible.length === 0 && <div className="select-empty">Ничего не найдено</div>}
              {visible.map((o, i) => (
                <div
                  key={o.value}
                  data-index={i}
                  role="option"
                  aria-selected={o.value === current}
                  aria-disabled={o.disabled || undefined}
                  className={`select-option${i === activeIndex ? ' select-option-active' : ''}${
                    o.value === current ? ' select-option-selected' : ''
                  }${o.disabled ? ' select-option-disabled' : ''}`}
                  onPointerEnter={() => setActiveIndex(i)}
                  onClick={() => pick(o)}
                >
                  <span className="select-option-label">{o.text === '' ? (placeholder ?? '—') : o.label}</span>
                </div>
              ))}
            </div>
          </div>,
          portalRoot,
        )}
    </>
  )
}
