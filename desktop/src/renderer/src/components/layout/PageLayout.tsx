import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export const PageSurface = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { accessibleName: string }
>(({ accessibleName, className, children, ...props }, ref) => (
  <div
    ref={ref}
    role="region"
    aria-label={accessibleName}
    className={joinClasses(
      'flex flex-1 flex-col overflow-hidden bg-[var(--shell-workspace)]',
      className
    )}
    {...props}>
    {children}
  </div>
))

PageSurface.displayName = 'PageSurface'

export function PageHeader({
  children,
  compact = false,
  divided = true,
  className,
}: {
  children: ReactNode
  compact?: boolean
  divided?: boolean
  className?: string
}) {
  const narrowInset = window.electronAPI?.platform === 'darwin' ? 'pl-32' : 'pl-16'

  return (
    <header
      className={joinClasses(
        'shrink-0 md:pl-6',
        narrowInset,
        compact ? 'py-3 pr-4 md:pl-4' : 'py-5 pr-6',
        divided ? 'border-b border-[var(--shell-border)]' : undefined,
        className
      )}>
      {children}
    </header>
  )
}

export const PageContentColumn = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={joinClasses('mx-auto w-full max-w-[840px]', className)} {...props}>
      {children}
    </div>
  )
)

PageContentColumn.displayName = 'PageContentColumn'

export function PageScrollBody({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <div className={joinClasses('flex-1 overflow-y-auto px-6 py-5', className)}>
      <PageContentColumn className={contentClassName}>{children}</PageContentColumn>
    </div>
  )
}
