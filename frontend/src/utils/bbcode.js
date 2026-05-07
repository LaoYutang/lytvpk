/**
 * BBCode to HTML converter (full replica of old frontend)
 */
export function formatBBCode(text) {
  if (!text) return ''

  // 1. Escape HTML special chars to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

  // 2. Basic BBCode replacements
  const tags = [
    { regex: /\[h1\](.*?)\[\/h1\]/gi, replace: '<h3>$1</h3>' },
    { regex: /\[h2\](.*?)\[\/h2\]/gi, replace: '<h4>$1</h4>' },
    { regex: /\[h3\](.*?)\[\/h3\]/gi, replace: '<h5>$1</h5>' },
    { regex: /\[b\](.*?)\[\/b\]/gi, replace: '<strong>$1</strong>' },
    { regex: /\[u\](.*?)\[\/u\]/gi, replace: '<u>$1</u>' },
    { regex: /\[i\](.*?)\[\/i\]/gi, replace: '<em>$1</em>' },
    { regex: /\[strike\](.*?)\[\/strike\]/gi, replace: '<del>$1</del>' },
    {
      regex: /\[spoiler\](.*?)\[\/spoiler\]/gi,
      replace: '<span class="bbcode-spoiler">$1</span>',
    },
    { regex: /\[hr\]/gi, replace: '<hr class="bbcode-hr">'},
    {
      regex: /\[code\](.*?)\[\/code\]/gis,
      replace: '<pre class="bbcode-pre"><code>$1</code></pre>',
    },
    {
      regex: /\[quote\](.*?)\[\/quote\]/gis,
      replace: '<blockquote class="bbcode-blockquote">$1</blockquote>',
    },
    { regex: /\[noparse\](.*?)\[\/noparse\]/gis, replace: '$1' },
    // Tables
    {
      regex: /\[table\](.*?)\[\/table\]/gis,
      replace: '<table class="bbcode-table">$1</table>',
    },
    { regex: /\[tr\](.*?)\[\/tr\]/gis, replace: '<tr>$1</tr>' },
    { regex: /\[td\](.*?)\[\/td\]/gis, replace: '<td>$1</td>' },
    { regex: /\[th\](.*?)\[\/th\]/gis, replace: '<th>$1</th>' },
    // Styles
    {
      regex: /\[size=(\d+)\](.*?)\[\/size\]/gi,
      replace: '<span style="font-size:$1pt">$2</span>',
    },
    {
      regex: /\[color=([^\]]+)\](.*?)\[\/color\]/gi,
      replace: '<span style="color:$1">$2</span>',
    },
    {
      regex: /\[font=([^\]]+)\](.*?)\[\/font\]/gi,
      replace: '<span style="font-family:$1">$2</span>',
    },
    // Alignment
    {
      regex: /\[center\](.*?)\[\/center\]/gis,
      replace: '<div style="text-align:center">$1</div>',
    },
    {
      regex: /\[left\](.*?)\[\/left\]/gis,
      replace: '<div style="text-align:left">$1</div>',
    },
    {
      regex: /\[right\](.*?)\[\/right\]/gis,
      replace: '<div style="text-align:right">$1</div>',
    },
    {
      regex: /\[indent\](.*?)\[\/indent\]/gis,
      replace: '<div style="margin-left:2em">$1</div>',
    },
  ]

  tags.forEach((tag) => {
    html = html.replace(tag.regex, tag.replace)
  })

  // 3. Links: [url=...]text[/url]
  html = html.replace(
    /\[url=(.*?)\](.*?)\[\/url\]/gi,
    (match, url, content) => {
      return `<a href="${url}" class="bbcode-link" target="_blank" rel="noopener">${content}</a>`
    }
  )
  // [url]...[/url]
  html = html.replace(/\[url\](.*?)\[\/url\]/gi, (match, url) => {
    return `<a href="${url}" class="bbcode-link" target="_blank" rel="noopener">${url}</a>`
  })

  // 4. Images
  html = html.replace(
    /\[img\](.*?)\[\/img\]/gi,
    '<img src="$1" class="bbcode-img" loading="lazy" />'
  )

  // 5. Lists
  // [list]...[/list]
  html = html.replace(/\[list\](.*?)\[\/list\]/gis, (match, content) => {
    const items = content.split('[*]').filter((s) => s.trim().length > 0)
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join('')
    return `<ul class="bbcode-list">${listItems}</ul>`
  })
  // [olist]...[/olist]
  html = html.replace(/\[olist\](.*?)\[\/olist\]/gis, (match, content) => {
    const items = content.split('[*]').filter((s) => s.trim().length > 0)
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join('')
    return `<ol class="bbcode-list">${listItems}</ol>`
  })
  // [list=1]...[/list]
  html = html.replace(/\[list=1\](.*?)\[\/list\]/gis, (match, content) => {
    const items = content.split('[*]').filter((s) => s.trim().length > 0)
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join('')
    return `<ol class="bbcode-list">${listItems}</ol>`
  })
  // [list=a]...[/list]
  html = html.replace(/\[list=a\](.*?)\[\/list\]/gis, (match, content) => {
    const items = content.split('[*]').filter((s) => s.trim().length > 0)
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join('')
    return `<ol type="a" class="bbcode-list">${listItems}</ol>`
  })

  // 6. Cleanup: remove unmatched BBCode tags (keep content)
  html = html.replace(/\[\/?[a-zA-Z]+(?:=[^\]]*)?\]/g, '')

  // 7. Handle line breaks and compress excessive empty lines
  html = html.replace(/\n/g, '<br>')
  html = html.replace(/(<br>){3,}/g, '<br><br>')
  html = html.replace(/^(<br>)+|(<br>)+$/g, '')

  return html
}
