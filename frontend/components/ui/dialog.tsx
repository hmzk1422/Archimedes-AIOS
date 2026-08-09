'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

const DialogContext = React.createContext<{
  onClose: () => void
} | null>(null)

function Dialog({ open, onOpenChange, children }: DialogProps) {
  const onClose = React.useCallback(() => onOpenChange(false), [onOpenChange])

  if (!open) return null

  return createPortal(
    <DialogContext.Provider value={{ onClose }}>
      <div className="fixed inset-0 z-50 flex">
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative ml-auto flex h-full w-full max-w-sm flex-col bg-background shadow-lg">
          {children}
        </div>
      </div>
    </DialogContext.Provider>,
    document.body,
  )
}

function useDialog() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) throw new Error('Dialog components must be used within Dialog')
  return ctx
}

function DialogTrigger({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  )
}

function DialogContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex h-full flex-col overflow-auto p-6', className)}>{children}</div>
}

function DialogHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mb-4', className)}>{children}</div>
}

function DialogTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn('text-lg font-semibold', className)}>{children}</h2>
}

function DialogClose({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  const { onClose } = useDialog()
  return (
    <button onClick={onClose} className={cn('', className)} {...props}>
      {children}
    </button>
  )
}

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(' ')
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogTrigger }
