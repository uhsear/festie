// Bare ownership test for crew items; routes keep their own 403 messages.
export function isCreatorOrOwner(item: { created_by?: string | null }, userId: string, role: string) {
  return item.created_by === userId || role === 'owner';
}
