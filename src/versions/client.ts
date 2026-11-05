import { useAuthStore } from '../state/authStore'
import { supabase } from '../lib/supabase'
import { useBookStore, type Book } from '../state/bookStore'
import { validVersionBook, versionContent, type ArticleVersion, type VersionDetail, type VersionKind } from './model'

export async function versionApi(path = '', options: RequestInit = {}, expectedOwner = useAuthStore.getState().session?.user.id) {
  const session = await supabase?.auth.getSession()
  const token = session?.data.session?.access_token
  if (expectedOwner && session?.data.session?.user.id !== expectedOwner) throw new Error('登录身份已改变，请重新打开文章。')
  if (!token) throw new Error('请先登录 River，再使用云端版本历史。')
  const response = await fetch(`/api/versions${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '版本操作失败，请重试')
  return result
}
export async function saveVersion(book: Book, kind: VersionKind, name: string, expectedOwner = useAuthStore.getState().session?.user.id): Promise<ArticleVersion> {
  return versionApi('', { method: 'POST', body: JSON.stringify({ book, kind, name }) }, expectedOwner)
}
export async function loadVersion(id: string, bookId: string): Promise<VersionDetail> {
  const version = await versionApi(`/${id}`) as VersionDetail
  if (!validVersionBook(version.book) || version.book.id !== bookId) throw new Error('版本内容不完整或不属于这篇文章，无法恢复。')
  return version
}
export async function restoreVersion(version: VersionDetail, stillAuthorized: () => boolean = () => true) {
  if (!validVersionBook(version.book)) throw new Error('版本内容不完整，无法恢复。')
  if (!stillAuthorized()) throw new Error('登录身份或当前文章已改变，已取消恢复。')
  const current = useBookStore.getState().library.books.find(b => b.id === version.book.id)
  if (!current) throw new Error('当前文章已不存在，请将旧版另存为副本。')
  const content = versionContent(current)
  // Never replace the current article until its complete safeguard is durably saved.
  await saveVersion(current, 'safety', `恢复「${version.name}」前`.slice(0, 100))
  if (!stillAuthorized()) throw new Error('登录身份或当前文章已改变，已取消恢复。')
  const state = useBookStore.getState()
  const latest = state.library.books.find(b => b.id === current.id)
  if (!latest || versionContent(latest) !== content) throw new Error('保存期间文章发生变化，请重新恢复。')
  state.setLibrary({ ...state.library, books: state.library.books.map(b => b.id === current.id ? { ...structuredClone(version.book), id: current.id, updatedAt: new Date().toISOString() } : b) })
  state.openBook(current.id)
}
export function copyVersion(version: VersionDetail) {
  if (!validVersionBook(version.book)) throw new Error('版本内容不完整，无法另存。')
  const state = useBookStore.getState()
  const copy = { ...structuredClone(version.book), id: crypto.randomUUID(), title: `${version.book.title} · ${version.name}`, updatedAt: new Date().toISOString() }
  state.setLibrary({ ...state.library, books: [...state.library.books, copy] })
  return copy.id
}
