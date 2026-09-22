import ProgressiveBlur from 'react-progressive-blur'

/**
 * Frosts the same band the scroll-edge mask fades. Opacity is driven by
 * `--chat-edge-top` / `--chat-edge-bottom` so a resting edge stays sharp.
 * No clip-path: Chromium drops backdrop-filter on a clipped box.
 */
export function ChatEdgeFade({ showTop = true }: { showTop?: boolean }) {
  return (
    <>
      {showTop ? (
        <div className="chat-edge-fade chat-edge-fade-top" aria-hidden="true">
          <ProgressiveBlur className="chat-edge-fade-progressive" position="top" intensity={80} />
        </div>
      ) : null}
      <div className="chat-edge-fade chat-edge-fade-bottom" aria-hidden="true">
        <ProgressiveBlur className="chat-edge-fade-progressive" position="bottom" intensity={80} />
      </div>
    </>
  )
}
