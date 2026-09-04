import { useEffect, useRef } from 'react'

/**
 * Разовый автовыбор значения фильтра в момент, когда список приехал из main.
 *
 * Раньше это считалось на каждый рендер (`value !== '' ? value : list[0]?.id ?? ''`), и
 * пустой пункт («Выберите семестр», «Все») выбрать было нельзя: состояние обнулялось, а на
 * экране тут же снова оказывался первый элемент списка. Здесь подстановка срабатывает ровно
 * один раз — дальше значение принадлежит пользователю, включая пустое.
 */
export function useInitialSelection<T>(items: T[], hasSelection: boolean, select: (items: T[]) => void): void {
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current || hasSelection || items.length === 0) return
    applied.current = true
    select(items)
    // select пересоздаётся на каждый рендер вызывающей стороной: эффект должен реагировать
    // на приезд списка, а не на новую ссылку колбэка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hasSelection])
}
