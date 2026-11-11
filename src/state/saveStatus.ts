import { create } from 'zustand'
export type CloudSaveState = 'idle' | 'saving' | 'saved' | 'error'
export const useSaveStatus = create<{
  cloud: CloudSaveState; cloudError: string; localError: string; retry: (() => Promise<unknown>) | null
}>(() => ({ cloud: 'idle', cloudError: '', localError: '', retry: null }))
