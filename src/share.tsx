import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { TypesetView } from './ui/TypesetView'
import './styles.css'
class ReaderBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { document.getElementById('river-share-fallback')?.removeAttribute('hidden') }
  render() { return this.state.failed ? null : this.props.children }
}
function Reader({ snapshot }: { snapshot: any }) {
  useEffect(() => { document.getElementById('river-share-fallback')?.setAttribute('hidden', '') }, [])
  return <TypesetView book={{ ...snapshot.book, boxes: [] }} shared={{ layout: snapshot.layout }} />
}
const data = document.getElementById('river-share-data')
const root = document.getElementById('river-share-reader')
if (data && root) {
  try {
    const snapshot = JSON.parse(data.textContent || '')
    createRoot(root).render(<ReaderBoundary><Reader snapshot={snapshot} /></ReaderBoundary>)
  } catch { /* The server-rendered complete article remains readable. */ }
}
