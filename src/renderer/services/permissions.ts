import { ref } from 'vue'

export interface PermRequest { path: string; tool?: string; callback?: (res:any)=>void }

export const pendingPermRequest = ref<PermRequest | null>(null)
export const sessionAllowedPaths = ref<Set<string>>(new Set())

export function requestPermission(req: Omit<PermRequest,'callback'>, cb: (res:any)=>void) {
  pendingPermRequest.value = { ...req, callback: cb }
}
