import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Bookshelf } from './Bookshelf'
import { useBookStore } from '../state/bookStore'
import { ArticleExport } from './ArticleExport'
const book = { id: 'test', title: '测试文章', boxes: [], doc: { type: 'doc', content: [{ type: 'card', attrs: { en: ['English'] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '中文' }] }] }] } }
it('preview and copy use interleaved full text', async () => {
 const user = userEvent.setup()
 render(<ArticleExport book={book} />)
 await user.click(screen.getByRole('button', { name: '导出全文' }))
 expect((screen.getByRole('textbox', { name: '全文预览' }) as HTMLTextAreaElement).value).toBe('测试文章\n\n中文\n\nEnglish\n')
 await user.click(screen.getByRole('button', { name: '复制全文' }))
 expect(await navigator.clipboard.readText()).toBe('测试文章\n\n中文\n\nEnglish\n')
})
it('shelf export dialog survives clicking its language selector', async () => {
 useBookStore.setState({ library: { books: [book], activeBookId: null, universalBoxes: [] } })
 const user = userEvent.setup()
 render(<Bookshelf />)
 await user.click(screen.getAllByRole('button', { name: /更多/ })[0])
 await user.click(screen.getByRole('button', { name: '导出全文' }))
 fireEvent.mouseDown(screen.getByRole('combobox'))
 await user.selectOptions(screen.getByRole('combobox'), 'en')
 expect(screen.getByRole('dialog')).toBeTruthy()
 expect((screen.getByRole('textbox', { name: '全文预览' }) as HTMLTextAreaElement).value).toBe('测试文章\n\nEnglish\n')
})
