import React, { useEffect, useRef } from 'react'
import Button from './Button'

export default function Modal({
  open,
  onClose,
  title,
  children,
  variant = 'info',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  loading = false,
  size = 'md',
}) {
  const overlayRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  if (!open) return null

  const sizeClass = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' }[size] || 'max-w-md'
  const iconColor = { info: 'text-blue-600', danger: 'text-red-600', success: 'text-green-600', warning: 'text-amber-600' }[variant] || 'text-blue-600'
  const confirmVariant = variant === 'danger' ? 'danger' : 'primary'

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose?.() }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={['bg-white rounded-xl shadow-xl w-full outline-none', sizeClass].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex items-start gap-4 px-6 pt-6 pb-4">
          {variant === 'danger' && (
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <svg className={`w-5 h-5 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
          )}
          {variant === 'success' && (
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <svg className={`w-5 h-5 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          <div className="flex-1">
            <h2 id="modal-title" className="text-lg font-semibold text-gray-900">{title}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 pb-2 text-sm text-gray-600 overflow-y-auto max-h-[70vh]">{children}</div>
        {onConfirm && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
            <Button variant="secondary" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
            <Button variant={confirmVariant} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
