'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConceptCategory, ConceptTag } from '@/lib/types'
import {
  useConceptCategories, useCreateConceptCategory, useUpdateConceptCategory, useDeleteConceptCategory,
  useConceptTags, useCreateConceptTag, useUpdateConceptTag, useDeleteConceptTag,
} from '@/hooks/use-concept-tags'

function TagRow({ tag, onEdit, onDelete }: { tag: ConceptTag; onEdit: (t: ConceptTag) => void; onDelete: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2 py-1.5 pl-8 pr-2 hover:bg-gray-50 rounded">
      <span className="flex-1 text-sm text-gray-700">{tag.name}</span>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onEdit(tag)}>
        <Pencil className="h-3 w-3 text-gray-400" />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onDelete(tag.id)}>
        <Trash2 className="h-3 w-3 text-red-400" />
      </Button>
    </div>
  )
}

export function ConceptTagManager() {
  const { data: categories = [], isLoading: catLoading } = useConceptCategories()
  const { data: allTags = [], isLoading: tagLoading } = useConceptTags()
  const createCategory = useCreateConceptCategory()
  const updateCategory = useUpdateConceptCategory()
  const deleteCategory = useDeleteConceptCategory()
  const createTag = useCreateConceptTag()
  const updateTag = useUpdateConceptTag()
  const deleteTag = useDeleteConceptTag()

  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [newCatName, setNewCatName] = useState('')
  const [editCatId, setEditCatId] = useState<string | null>(null)
  const [editCatName, setEditCatName] = useState('')

  // 태그 추가 상태: categoryId별 입력값
  const [newTagNames, setNewTagNames] = useState<Record<string, string>>({})
  const [editTagId, setEditTagId] = useState<string | null>(null)
  const [editTagName, setEditTagName] = useState('')

  function toggleCat(id: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleCreateCategory() {
    if (!newCatName.trim()) return
    await createCategory.mutateAsync({ name: newCatName.trim(), sort_order: categories.length })
    setNewCatName('')
  }

  async function handleUpdateCategory(cat: ConceptCategory) {
    if (!editCatName.trim()) return
    await updateCategory.mutateAsync({ id: cat.id, name: editCatName.trim(), sort_order: cat.sort_order })
    setEditCatId(null)
  }

  async function handleCreateTag(categoryId: string, categoryTags: ConceptTag[]) {
    const name = newTagNames[categoryId]?.trim()
    if (!name) return
    await createTag.mutateAsync({ name, concept_category_id: categoryId, sort_order: categoryTags.length })
    setNewTagNames((prev) => ({ ...prev, [categoryId]: '' }))
  }

  async function handleUpdateTag(tag: ConceptTag) {
    if (!editTagName.trim()) return
    await updateTag.mutateAsync({ id: tag.id, name: editTagName.trim(), concept_category_id: tag.concept_category_id, sort_order: tag.sort_order })
    setEditTagId(null)
  }

  if (catLoading || tagLoading) return <div className="h-40 animate-pulse rounded-xl bg-gray-100" />

  return (
    <div className="space-y-1">
      {categories.map((cat) => {
        const isExpanded = expandedCats.has(cat.id)
        const tags = allTags.filter((t) => t.concept_category_id === cat.id)

        return (
          <div key={cat.id} className="rounded-lg border bg-white">
            {/* 대분류 행 */}
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={() => toggleCat(cat.id)} className="flex items-center gap-1.5 flex-1 text-left">
                {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                {editCatId === cat.id ? null : (
                  <span className="font-medium text-sm">{cat.name}</span>
                )}
                {editCatId !== cat.id && (
                  <span className="text-xs text-gray-400">({tags.length}개)</span>
                )}
              </button>

              {editCatId === cat.id ? (
                <div className="flex flex-1 items-center gap-1">
                  <Input
                    value={editCatName}
                    onChange={(e) => setEditCatName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUpdateCategory(cat)}
                    className="h-7 flex-1"
                    autoFocus
                  />
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleUpdateCategory(cat)}>
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditCatId(null)}>
                    <X className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                </div>
              ) : (
                <>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditCatId(cat.id); setEditCatName(cat.name) }}>
                    <Pencil className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm('대분류를 삭제하면 소속 태그도 삭제됩니다. 삭제할까요?')) deleteCategory.mutate(cat.id) }}>
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </Button>
                </>
              )}
            </div>

            {/* 소분류 목록 */}
            {isExpanded && (
              <div className="border-t pb-2">
                {tags.map((tag) => (
                  editTagId === tag.id ? (
                    <div key={tag.id} className="flex items-center gap-1 py-1 pl-8 pr-2">
                      <Input
                        value={editTagName}
                        onChange={(e) => setEditTagName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleUpdateTag(tag)}
                        className="h-7 flex-1"
                        autoFocus
                      />
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleUpdateTag(tag)}>
                        <Check className="h-3 w-3 text-green-600" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditTagId(null)}>
                        <X className="h-3 w-3 text-gray-400" />
                      </Button>
                    </div>
                  ) : (
                    <TagRow
                      key={tag.id}
                      tag={tag}
                      onEdit={(t) => { setEditTagId(t.id); setEditTagName(t.name) }}
                      onDelete={(id) => { if (confirm('태그를 삭제할까요?')) deleteTag.mutate(id) }}
                    />
                  )
                ))}

                {/* 새 태그 추가 */}
                <div className="flex items-center gap-1 pl-8 pr-2 pt-1">
                  <Input
                    placeholder="새 태그 이름"
                    value={newTagNames[cat.id] ?? ''}
                    onChange={(e) => setNewTagNames((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateTag(cat.id, tags)}
                    className="h-7 flex-1"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => handleCreateTag(cat.id, tags)}
                    disabled={!newTagNames[cat.id]?.trim()}
                  >
                    <Plus className="h-3.5 w-3.5 text-gray-500" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* 새 대분류 추가 */}
      <div className="flex gap-2 pt-2">
        <Input
          placeholder="새 대분류 이름 (예: 문법, 어휘)"
          value={newCatName}
          onChange={(e) => setNewCatName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
        />
        <Button onClick={handleCreateCategory} disabled={createCategory.isPending || !newCatName.trim()}>
          <Plus className="mr-1 h-4 w-4" />
          추가
        </Button>
      </div>
    </div>
  )
}
