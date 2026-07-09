import '@testing-library/dom'

// jsdom doesn't do real layout, so Range/Element client-rect measurement is
// unimplemented (throws "getClientRects is not a function"). ProseMirror's
// coordsAtPos — used by tiptap's BubbleMenu/floating-ui to position the
// selection toolbar — calls target.getClientRects() on a Range. Stub both
// with zero rects so those code paths run without layout info in tests.
const zeroRect = (): DOMRect => ({
  top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON() { return this },
})
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = zeroRect
}
