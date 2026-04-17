import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircleIcon, PlusIcon, CloseIcon } from '@/components/icons'

interface FlagsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (flags: string) => Promise<void>
  isSaving: boolean
  error: string
  currentFlags?: string
}

export function FlagsDialog({
  open,
  onOpenChange,
  onSubmit,
  isSaving,
  error,
  currentFlags = '',
}: FlagsDialogProps) {
  const [bulletPoints, setBulletPoints] = useState<string[]>([''])

  useEffect(() => {
    if (open) {
      if (currentFlags) {
        setBulletPoints(currentFlags.split('\n').filter(line => line.trim()))
      } else {
        setBulletPoints([''])
      }
    }
  }, [open, currentFlags])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const filteredPoints = bulletPoints.filter(point => point.trim())
    await onSubmit(filteredPoints.join('\n'))
  }

  const handleCancel = () => {
    if (currentFlags) {
      setBulletPoints(currentFlags.split('\n').filter(line => line.trim()))
    } else {
      setBulletPoints([''])
    }
    onOpenChange(false)
  }

  const addBulletPoint = () => {
    setBulletPoints([...bulletPoints, ''])
  }

  const removeBulletPoint = (index: number) => {
    setBulletPoints(bulletPoints.filter((_, i) => i !== index))
  }

  const updateBulletPoint = (index: number, value: string) => {
    const newPoints = [...bulletPoints]
    newPoints[index] = value
    setBulletPoints(newPoints)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircleIcon className="size-5 text-orange-500" />
            Notes & Flags
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label>Add notes, warnings, or important information</Label>
            <div className="space-y-2">
              {bulletPoints.map((point, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-muted-foreground">•</span>
                  <Input
                    value={point}
                    onChange={(e) => updateBulletPoint(index, e.target.value)}
                    placeholder="e.g., Client prefers email communication"
                    className="cursor-text flex-1"
                  />
                  {bulletPoints.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeBulletPoint(index)}
                      className="cursor-pointer shrink-0"
                    >
                      <CloseIcon className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addBulletPoint}
                className="cursor-pointer w-full"
              >
                <PlusIcon className="mr-2 size-4" />
                Add Point
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSaving}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving} className="cursor-pointer">
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
