import ProgressiveBlur from 'react-progressive-blur'

/**
 * The same MIT react-progressive-blur stack as the phone chrome.
 * Height comes from the measured top bar / bottom dock plus a feather.
 * No clip-path: Chromium drops backdrop-filter on a clipped box.
 */
export function ChatEdgeFade({ showTop = true }: { showTop?: boolean }) {
  return (
    <>
      {showTop ? (
        <div className="chat-edge-fade chat-edge-fade-top" aria-hidden="true">
          <ProgressiveBlur className="chat-edge-fade-progressive" position="top" intensity={100} />
        </div>
      ) : null}
      <div className="chat-edge-fade chat-edge-fade-bottom" aria-hidden="true">
        <ProgressiveBlur className="chat-edge-fade-progressive" position="bottom" intensity={100} />
      </div>
    </>
  )
}
