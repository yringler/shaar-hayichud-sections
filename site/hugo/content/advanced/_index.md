---
title: "Study guides"
# The advanced tier of the study guides (data/v1/study/index-advanced.json):
# published unlisted. /advanced/ is an index of the advanced series (like
# /study/), and nothing on the site links in (every link-in goes through partials/study/index.html, the
# public tier). The pages (content/advanced/_content.gotmpl) are rendered but
# never listed (no RSS, no page collection), left out of the sitemap, and
# marked noindex (baseof.html's robots meta; X-Robots-Tag in static/_headers;
# robots.txt disallows /advanced/). The search index never reads them.
url: /advanced/
outputs: [html]
type: study
build:
  render: always
  list: never
sitemap:
  disable: true
params:
  noindex: true
  studyTier: advanced
cascade:
  - build:
      render: always
      list: never
    sitemap:
      disable: true
    type: study
    params:
      noindex: true
      studyTier: advanced
---
