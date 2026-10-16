// The pages the file preview shows images and media in. Each is written next
// to the downloaded file and loaded from there, so the WebView reads the
// file by a relative URL and nothing else on the device. They post 'error'
// when the WebView can't decode the file, so the preview can offer another
// app instead of a blank page or a dead player.

export interface ViewerColors {
  /** The app's theme, so the WebView draws its own controls to match. */
  scheme: 'light' | 'dark';
  background: string;
  text: string;
  textMuted: string;
  surface: string;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** A file name as a relative URL: every reserved character encoded. */
export function relativeFileUrl(fileName: string): string {
  return encodeURIComponent(fileName).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

const REPORT = `function report(m){try{window.ReactNativeWebView.postMessage(m)}catch(e){}}`;

function page(title: string, colors: ViewerColors, viewport: string, style: string, body: string): string {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta name="viewport" content="${viewport}">`
    + `<title>${escapeHtml(title)}</title>`
    + `<style>:root{color-scheme:${colors.scheme}}html,body{margin:0;height:100%;background:${colors.background};color:${colors.text};`
    + `font-family:-apple-system,system-ui,Roboto,sans-serif;-webkit-user-select:none;user-select:none}${style}</style>`
    + `</head><body>${body}</body></html>`;
}

/**
 * An image fitted to the screen, with the WebView's own pinch zoom. Used on
 * Android, where React Native's Image can't zoom, and for SVG and ICO, which
 * it can't draw. SVG is shown through <img>, so its scripts never run and it
 * loads nothing from the network.
 */
export function imageViewerHtml(fileName: string, colors: ViewerColors): string {
  // Raster icons scaled up stay crisp instead of blurring.
  const fillClass = /\.(ico|bmp|gif|png)$/i.test(fileName) ? 'fill pixel' : 'fill';
  return page(
    fileName,
    colors,
    'width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=10,user-scalable=yes',
    'body{display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:16px}'
    + 'img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}'
    // A vector or a tiny icon has no useful natural size; fill the screen.
    + 'img.fill{width:100%;height:100%}'
    + 'img.pixel{image-rendering:pixelated}',
    `<img id="i" alt="${escapeHtml(fileName)}" src="${relativeFileUrl(fileName)}">`
    + `<script>${REPORT}var i=document.getElementById('i');`
    + `i.addEventListener('error',function(){report('error')});`
    + `i.addEventListener('load',function(){var s=Math.min(innerWidth,innerHeight)/3;`
    + `if(!i.naturalWidth||i.naturalWidth<s&&i.naturalHeight<s){i.className='${fillClass}'}`
    + `report('loaded')});</script>`,
  );
}

/**
 * The platform's own player for a video or a sound. A video fills the
 * screen on black, with fullscreen and picture in picture where the WebView
 * offers them; a sound gets a card with its name. Playback starts at once.
 */
export function mediaViewerHtml(kind: 'video' | 'audio', fileName: string, colors: ViewerColors): string {
  const src = relativeFileUrl(fileName);
  const script = `<script>${REPORT}var m=document.getElementById('m');`
    + `function failed(){if(!m.currentSrc||m.error||m.networkState===3)report('error')}`
    + `m.addEventListener('error',failed,true);`
    // A file whose container plays but has no track the WebView decodes
    // reports a 0x0 video; offer another app for that too.
    + `m.addEventListener('loadedmetadata',function(){if(m.tagName==='VIDEO'&&!m.videoWidth&&!m.duration)report('error');else report('loaded')});`
    + `</script>`;
  if (kind === 'video') {
    return page(
      fileName,
      { ...colors, scheme: 'dark', background: '#000' },
      'width=device-width,initial-scale=1',
      'body{display:flex;align-items:center;justify-content:center}video{width:100%;height:100%;object-fit:contain;background:#000}',
      `<video id="m" src="${src}" controls autoplay playsinline preload="auto"></video>${script}`,
    );
  }
  const note = '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="6" cy="17" r="3"/><circle cx="16" cy="15" r="3"/><path d="M9 17V5l10-2v12"/><path d="M9 9l10-2"/></svg>';
  return page(
    fileName,
    colors,
    'width=device-width,initial-scale=1',
    'body{display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px}'
    + `.card{width:100%;max-width:480px;display:flex;flex-direction:column;align-items:center;gap:20px}`
    + `.art{width:160px;height:160px;border-radius:24px;background:${colors.surface};color:${colors.textMuted};`
    + 'display:flex;align-items:center;justify-content:center}'
    + '.name{font-size:17px;font-weight:600;text-align:center;word-break:break-word}'
    + 'audio{width:100%}',
    `<div class="card"><div class="art">${note}</div><div class="name">${escapeHtml(fileName)}</div>`
    + `<audio id="m" src="${src}" controls autoplay preload="auto"></audio></div>${script}`,
  );
}
