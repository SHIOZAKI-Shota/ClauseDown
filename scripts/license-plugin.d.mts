import type { Plugin } from 'vite'

export const RECORD_DIR: string
export function packageDirOf(id: string): string | null
export function recordLicenses(name: string): Plugin
