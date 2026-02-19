<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html>
      <head>
        <meta charset="UTF-8"/>
        <style>
          body {
            max-width: 70ch;
            margin: 2em auto;
            font-family: serif;
            line-height: 1.7;
            direction: rtl;
          }

          div[class^="depth-"] {
            display: flex;
            gap: 0.75em;
            margin-block: 0.75em;
          }

          .depth-1 { padding-inline-start: 1em; }
          .depth-2 { padding-inline-start: 2em; }
          .depth-3 { padding-inline-start: 3em; }
          .depth-4 { padding-inline-start: 4em; }
          .depth-5 { padding-inline-start: 5em; }

          .label {
            font-weight: bold;
            flex-shrink: 0;
          }

          .content {
            color: #222;
          }
        </style>
      </head>
      <body>
        <xsl:apply-templates select="section">
          <xsl:with-param name="depth" select="1"/>
        </xsl:apply-templates>
      </body>
    </html>
  </xsl:template>

  <xsl:template match="section">
    <xsl:param name="depth" select="1"/>
    <!-- Emit a flat div for this section's own text content -->
    <xsl:variable name="text" select="normalize-space(string(text()))"/>
    <xsl:if test="$text != ''">
      <div class="depth-{$depth}">
        <xsl:if test="@label">
          <div class="label"><xsl:value-of select="@label"/></div>
        </xsl:if>
        <div class="content"><xsl:value-of select="$text"/></div>
      </div>
    </xsl:if>
    <!-- Recurse into child sections (flat, not nested) -->
    <xsl:apply-templates select="section">
      <xsl:with-param name="depth" select="$depth + 1"/>
    </xsl:apply-templates>
  </xsl:template>

</xsl:stylesheet>
