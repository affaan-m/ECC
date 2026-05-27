/**
 * StageFlow Embed Script
 * Include this on your website to auto-resize the StageFlow iframe.
 *
 * Usage:
 * <iframe id="stageflow-embed" src="https://your-org.stageflow.app/embed/your-org" style="width:100%;min-height:900px;border:0" allow="clipboard-write; payment"></iframe>
 * <script src="https://stageflow.app/embed.js"></script>
 */
;(function () {
  'use strict'

  var ORIGIN_PATTERN = /\.stageflow\.app$/

  function isStageFlowOrigin(origin) {
    try {
      var url = new URL(origin)
      return ORIGIN_PATTERN.test(url.hostname) || url.hostname === 'localhost'
    } catch (e) {
      return false
    }
  }

  function handleMessage(event) {
    if (!isStageFlowOrigin(event.origin)) return
    if (!event.data || event.data.type !== 'stageflow:resize') return

    var height = event.data.height
    if (typeof height !== 'number' || height < 0) return

    var iframes = document.querySelectorAll('iframe[src*="stageflow"], iframe[id="stageflow-embed"]')
    for (var i = 0; i < iframes.length; i++) {
      try {
        var iframeOrigin = new URL(iframes[i].src).origin
        if (iframeOrigin === event.origin) {
          iframes[i].style.height = height + 'px'
        }
      } catch (e) {
        // skip invalid src
      }
    }
  }

  window.addEventListener('message', handleMessage, false)
})()
