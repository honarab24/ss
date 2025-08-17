import express from "express";
import fetch from "node-fetch";
import xslt from "xslt-processor";

const app = express();
const PORT = process.env.PORT || 3000;

// Inline XSL as a string
const mpd2hlsXSL = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:m="urn:mpeg:dash:schema:mpd:2011"
    version="1.0">

  <xsl:output method="text" encoding="UTF-8" omit-xml-declaration="yes" />

  <xsl:param name="run_id" />

  <xsl:template match="/">
    <xsl:text>#EXTM3U&#xa;</xsl:text>
    <xsl:apply-templates select="//m:Representation" />
  </xsl:template>

  <xsl:template match="m:Representation">
    <xsl:text>#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=</xsl:text>
    <xsl:value-of select="@bandwidth" />
    <xsl:if test="@width and @height">
      <xsl:text>,RESOLUTION=</xsl:text>
      <xsl:value-of select="@width" />
      <xsl:text>x</xsl:text>
      <xsl:value-of select="@height" />
    </xsl:if>
    <xsl:if test="@codecs">
      <xsl:text>,CODECS="</xsl:text>
      <xsl:value-of select="@codecs" />
      <xsl:text>"</xsl:text>
    </xsl:if>
    <xsl:text>&#xa;</xsl:text>
    <xsl:value-of select="$run_id" />
    <xsl:text>_</xsl:text>
    <xsl:value-of select="@id" />
    <xsl:text>.m3u8&#xa;</xsl:text>
  </xsl:template>

</xsl:stylesheet>`;

// Proxy endpoint
app.get("/proxy", async (req, res) => {
  try {
    const url = req.query.u;
    if (!url) return res.status(400).send("Missing ?u=MPD_URL");

    // Fetch MPD from source
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch MPD");
    const mpdXml = await response.text();

    // Transform MPD → M3U8 using inline XSL
    const doc = xslt.xmlParse(mpdXml);
    const stylesheet = xslt.xmlParse(mpd2hlsXSL);
    const result = xslt.xsltProcess(doc, stylesheet, ["run_id", "proxy"]);

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
