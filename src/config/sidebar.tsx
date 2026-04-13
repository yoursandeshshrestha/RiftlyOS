import type { ReactElement } from 'react'
import {
  HomeIcon,
  UsersIcon,
  PipelineIcon,
  ProjectsIcon,
  TasksIcon,
} from '@/components/icons'

interface NavItem {
  title: string
  href?: string
  icon: ReactElement
  ownerOnly?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

export const sidebarConfig: NavGroup[] = [
  {
    label: 'Main',
    items: [
      {
        title: 'Dashboard',
        href: '/dashboard',
        icon: <HomeIcon className="size-4 shrink-0" />,
      },
      {
        title: 'Pipeline',
        href: '/pipeline',
        icon: <PipelineIcon className="size-4 shrink-0" />,
        ownerOnly: true,
      },
      {
        title: 'Projects',
        href: '/projects',
        icon: <ProjectsIcon className="size-4 shrink-0" />,
      },
      {
        title: 'Tasks',
        href: '/tasks',
        icon: <TasksIcon className="size-4 shrink-0" />,
      },
      {
        title: 'Users',
        href: '/users',
        icon: <UsersIcon className="size-4 shrink-0" />,
        ownerOnly: true,
      },
    ],
  },
]
