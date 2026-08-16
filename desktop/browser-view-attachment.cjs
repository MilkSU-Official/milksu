'use strict'

function attachBrowserView(contentView, current) {
  if (current.attached) return
  contentView.addChildView(current.view)
  current.attached = true
}

function detachBrowserView(contentView, current) {
  current.view.setVisible(false)
  if (!current.attached) return
  contentView.removeChildView(current.view)
  current.attached = false
}

module.exports = {
  attachBrowserView,
  detachBrowserView,
}
