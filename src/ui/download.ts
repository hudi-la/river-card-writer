// 共享的"下载一段文本为文件"工具：Blob + URL.createObjectURL + 临时 <a> + revoke，
// 三处导出入口（全库备份/单本书/通用盒子）都走这同一条路径，行为保持一致。
export function downloadTextFile(filename: string, text: string, mime: string = 'application/json') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function todayStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
