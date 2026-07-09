import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { UploadIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { TaskActivityFeed } from './TaskActivityFeed'
import {
  TaskAttachmentsSection,
  type TaskAttachmentsSectionHandle,
} from './TaskAttachmentsSection'
import { taskPanelSubsectionClass } from './taskPanelStyles'

type TabId = 'activity' | 'files'

const TABS: { id: TabId; label: string }[] = [
  { id: 'activity', label: 'Activity' },
  { id: 'files', label: 'Files' },
]

interface TaskDetailTabsProps {
  taskId: string
  workspaceId: string
  reloadKey: number
  onActivityChange: () => void
}

export function TaskDetailTabs({
  taskId,
  workspaceId,
  reloadKey,
  onActivityChange,
}: TaskDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('activity')
  const [filesReloadKey, setFilesReloadKey] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const attachmentsRef = useRef<TaskAttachmentsSectionHandle>(null)

  const handleFilesChange = () => {
    setFilesReloadKey((k) => k + 1)
    onActivityChange()
  }

  return (
    <div className={cn('flex min-h-[200px] flex-1 flex-col', taskPanelSubsectionClass)}>
      <div
        role="tablist"
        aria-label="Task discussion"
        className="flex items-center justify-between gap-3 border-b border-border-table/60 px-4"
      >
        <div className="flex gap-6">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative -mb-px cursor-pointer py-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground/80',
                )}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-px bg-foreground" />
                )}
              </button>
            )
          })}
        </div>

        {activeTab === 'files' && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isUploading}
            onClick={() => attachmentsRef.current?.openUpload()}
            className="h-8 shrink-0 cursor-pointer gap-1.5 px-2.5 text-xs"
          >
            <UploadIcon className="size-3.5" />
            {isUploading ? 'Uploading…' : 'Upload'}
          </Button>
        )}
      </div>

      <div role="tabpanel" className="pb-4 pt-1">
        {activeTab === 'activity' ? (
          <TaskActivityFeed taskId={taskId} reloadKey={reloadKey} />
        ) : (
          <div className="px-4 pt-3">
            <TaskAttachmentsSection
              ref={attachmentsRef}
              taskId={taskId}
              workspaceId={workspaceId}
              reloadKey={filesReloadKey}
              onActivityChange={handleFilesChange}
              onUploadingChange={setIsUploading}
              embedded
              hideUploadButton
            />
          </div>
        )}
      </div>
    </div>
  )
}
