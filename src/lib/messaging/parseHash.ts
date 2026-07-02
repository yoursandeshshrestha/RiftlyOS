export type ParsedMessageHash =
  | { kind: 'channel'; channelId: string }
  | { kind: 'dm'; otherUserId: string }

export function parseMessageHash(hash: string): ParsedMessageHash | null {
  const value = hash.replace(/^#/, '')
  if (!value) return null

  if (value.startsWith('dm-')) {
    const otherUserId = value.slice(3)
    return otherUserId ? { kind: 'dm', otherUserId } : null
  }

  if (value.startsWith('channel-')) {
    const channelId = value.slice(8)
    return channelId ? { kind: 'channel', channelId } : null
  }

  return null
}

export function channelHash(channelId: string) {
  return `channel-${channelId}`
}
