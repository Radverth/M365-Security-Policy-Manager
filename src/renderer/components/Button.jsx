import React from 'react'

const sizeClasses = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
}

const variantClasses = {
  primary: 'bg-navy text-white hover:bg-navy-600 focus:ring-navy border border-transparent',
  secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 focus:ring-navy',
  ghost: 'bg-transparent text-gray-600 border border-transparent hover:bg-gray-100 hover:text-gray-900 focus:ring-navy',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 border border-transparent',
  gold: 'bg-gold text-white hover:bg-gold-500 focus:ring-gold border border-transparent',
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  onClick,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all',
        'focus:outline-none focus:ring-2 focus:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed active:scale-95',
        sizeClasses[size] || sizeClasses.md,
        variantClasses[variant] || variantClasses.primary,
        className,
      ].join(' ')}
      {...props}
    >
      {loading && (
        <svg className="animate-spin -ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  )
}
