'use client'

import { useState } from 'react'
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { QuestionType } from '@/lib/types'
import { useQuestionTypes, useCreateQuestionType, useUpdateQuestionType, useDeleteQuestionType } from '@/hooks/use-question-types'

export function QuestionTypeManager() {
  const { data: types, isLoading } = useQuestionTypes()
  const createType = useCreateQuestionType()
  const updateType = useUpdateQuestionType()
  const deleteType = useDeleteQuestionType()

  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  async function handleCreate() {
    if (!newName.trim()) return
    await createType.mutateAsync({ name: newName.trim(), sort_order: types?.length ?? 0 })
    setNewName('')
  }

  async function handleUpdate(type: QuestionType) {
    if (!editName.trim()) return
    await updateType.mutateAsync({ id: type.id, name: editName.trim(), sort_order: type.sort_order })
    setEditId(null)
  }

  function handleDelete(id: string) {
    if (confirm('삭제하시겠습니까?')) deleteType.mutate(id)
  }

  if (isLoading) return <div className="h-40 rounded-xl bg-gray-100 animate-pulse" />

  return (
    <div className="space-y-2">
      {types?.map((type) => (
        <div key={type.id} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2">
          {editId === type.id ? (
            <>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUpdate(type)}
                className="h-7 flex-1"
                autoFocus
              />
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleUpdate(type)}>
                <Check className="h-3.5 w-3.5 text-green-600" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditId(null)}>
                <X className="h-3.5 w-3.5 text-gray-400" />
              </Button>
            </>
          ) : (
            <>
              <span className="flex-1 text-sm">{type.name}</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditId(type.id); setEditName(type.name) }}>
                <Pencil className="h-3.5 w-3.5 text-gray-400" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(type.id)}>
                <Trash2 className="h-3.5 w-3.5 text-red-400" />
              </Button>
            </>
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <Input
          placeholder="새 유형 이름 (예: 독해, 문법)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <Button onClick={handleCreate} disabled={createType.isPending || !newName.trim()}>
          <Plus className="mr-1 h-4 w-4" />
          추가
        </Button>
      </div>
    </div>
  )
}
