'use client'

import { deleteAccountAction } from '@/app/actions'
import { useTransition } from 'react'

export default function DeleteAccountButton() {
  const [isPending, startTransition] = useTransition()

  return (
    <button
      className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
      disabled={isPending}
      onClick={() => {
        if (confirm("Are you sure? This action is irreversible.")) {
          startTransition(async () => {
            await deleteAccountAction()
          })
        }
      }}
    >
      {isPending ? "Deleting..." : "Delete Account"}
    </button>
  )
}