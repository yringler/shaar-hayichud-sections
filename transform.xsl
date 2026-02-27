<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" indent="yes" omit-xml-declaration="yes"/>

  <!-- Output only the body fragment; the HTML wrapper is provided by the Eleventy base layout -->
  <xsl:template match="/">
    <xsl:apply-templates select="section/section">
      <xsl:with-param name="depth" select="1"/>
    </xsl:apply-templates>
  </xsl:template>


  <xsl:template match="section">
    <xsl:param name="depth" select="1"/>
    <xsl:param name="prefix" select="''"/>
    <xsl:variable name="pos" select="count(preceding-sibling::section) + 1"/>
    <xsl:variable name="number">
      <xsl:choose>
        <xsl:when test="$prefix = ''"><xsl:value-of select="$pos"/></xsl:when>
        <xsl:otherwise><xsl:value-of select="concat($prefix, '.', $pos)"/></xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <!-- Emit a flat div for this section's own text content -->
    <xsl:variable name="text" select="normalize-space(string(text()))"/>
    <xsl:if test="$text != ''">
      <div class="depth-{$depth}">
        <div class="label">
          <span class="number"><xsl:value-of select="$number"/></span>
          <xsl:if test="@label">
            <xsl:text> </xsl:text><xsl:value-of select="@label"/>
          </xsl:if>
        </div>
        <div class="content"><xsl:value-of select="replace($text, '\d+', '')"/></div>
      </div>
    </xsl:if>
    <!-- Recurse into child sections (flat, not nested) -->
    <xsl:apply-templates select="section">
      <xsl:with-param name="depth" select="$depth + 1"/>
      <xsl:with-param name="prefix" select="$number"/>
    </xsl:apply-templates>
  </xsl:template>

</xsl:stylesheet>
