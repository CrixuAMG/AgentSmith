import { ref } from 'vue'

export interface PermissionResponse { allowed: boolean; path?: string }
export interface PermRequest { path: string; tool?: string; callback?: (res: PermissionResponse) => void }

export const pendingPermRequest = ref<PermRequest | null>(null)
export const sessionAllowedPaths = ref<Set<string>>(new Set())

export function requestPermission(req: Omit<PermRequest, 'callback'>, cb: (res: PermissionResponse) => void) {
  pendingPermRequest.value = { ...req, callback: cb }
}
