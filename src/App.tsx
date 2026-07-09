import { useBookStore } from './state/bookStore'
import { Bookshelf } from './ui/Bookshelf'
import { Workspace } from './ui/Workspace'

export function App() {
  const shell = useBookStore((s) => s.shell)
  return shell === 'shelf' ? <Bookshelf /> : <Workspace />
}
