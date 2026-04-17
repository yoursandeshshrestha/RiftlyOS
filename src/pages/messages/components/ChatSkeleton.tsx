import { Skeleton } from '@/components/ui/skeleton';

export function ChatSkeleton() {
  return (
    <div className="h-full flex flex-col">
      {/* Header Skeleton - matches ChatArea header exactly */}
      <div className="flex items-center justify-between px-6 py-4 border-b min-h-[57px]">
        <div className="flex items-center gap-2">
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>

      {/* Messages Area Skeleton */}
      <div className="flex-1 px-6 py-4 space-y-4 overflow-hidden min-h-0">
        {/* Message 1 - Left */}
        <div className="flex items-start gap-3">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="space-y-2 flex-1 max-w-md">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>

        {/* Message 2 - Right */}
        <div className="flex items-start gap-3 justify-end">
          <div className="space-y-2 flex-1 max-w-md flex flex-col items-end">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-12 w-3/4 rounded-lg" />
          </div>
          <Skeleton className="size-8 rounded-full shrink-0" />
        </div>

        {/* Message 3 - Left */}
        <div className="flex items-start gap-3">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="space-y-2 flex-1 max-w-md">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </div>

        {/* Message 4 - Right */}
        <div className="flex items-start gap-3 justify-end">
          <div className="space-y-2 flex-1 max-w-md flex flex-col items-end">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-10 w-2/3 rounded-lg" />
          </div>
          <Skeleton className="size-8 rounded-full shrink-0" />
        </div>

        {/* Message 5 - Left */}
        <div className="flex items-start gap-3">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="space-y-2 flex-1 max-w-md">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        </div>
      </div>

      {/* Input Area Skeleton */}
      <div className="px-6 py-4 border-t">
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}
