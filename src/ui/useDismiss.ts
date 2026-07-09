import { useEffect, useId, useRef } from 'react'

// Global "only one popover open at a time" registry. Opening a popover whose
// `open` flips to true closes whichever other popover (menu or settings
// panel) currently holds the slot — a single shared mechanism used by every
// popover in the app (thread/box/role menus + the reading-settings panel).
let activeId: string | null = null
let activeClose: (() => void) | null = null

/**
 * Attach to a popover's outer wrapper (the element that contains BOTH the
 * trigger button and the popover panel). While `open`, a mousedown outside
 * that wrapper calls `onClose`, and opening this popover closes any other
 * popover that was open elsewhere in the app.
 */
export function useDismiss<T extends HTMLElement = HTMLElement>(
  open: boolean,
  onClose: () => void
) {
  const id = useId()
  const ref = useRef<T>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return

    if (activeId !== null && activeId !== id && activeClose) {
      activeClose()
    }
    activeId = id
    activeClose = () => closeRef.current()

    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        closeRef.current()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      if (activeId === id) {
        activeId = null
        activeClose = null
      }
    }
  }, [open, id])

  return ref
}
