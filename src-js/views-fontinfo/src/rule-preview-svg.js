import { SVGPath2D } from "@fontra/core/glyph-svg.js";
import * as svg from "@fontra/core/svg-utils.js";
import { Transform } from "@fontra/core/transform.js";

/**
 * Render glyph previews for the feature editor, sized the way the font
 * overview's glyph cells are.
 *
 * The important detail is that every preview uses the *same vertical box* --
 * ascender to descender -- so a row of previews shares one baseline and lines
 * up, no matter how tall or deep an individual glyph is. Horizontally the
 * viewBox follows the glyph's advance width, exactly like glyph-cell.js does.
 * A fixed font size would instead make an "f" and an Arabic final form look
 * unrelated in size.
 */

const DEFAULT_ASCENDER = 0.8; // fraction of upem
const DEFAULT_DESCENDER = -0.2;

function getVerticalMetrics(upem, fontSource) {
  const ascender =
    fontSource?.lineMetricsHorizontalLayout?.["ascender"]?.value ??
    DEFAULT_ASCENDER * upem;
  const descender =
    fontSource?.lineMetricsHorizontalLayout?.["descender"]?.value ??
    DEFAULT_DESCENDER * upem;
  return { ascender, descender };
}

/**
 * The glyph's outline as an SVG path element, in a viewBox that spans the
 * vertical metrics and exactly as wide as the advance.
 */
function glyphPathElement(glyph, instance, metrics) {
  if (!instance?.flattenedPath) {
    return null;
  }
  const svgPath = new SVGPath2D();
  instance.flattenedPath.drawToPath2d(svgPath);
  return svg.path({
    d: svgPath.getPath(),
    transform: new Transform(1, 0, 0, -1, 0, 0),
  });
}

/**
 * One side of a rule: a run of glyphs laid out on a shared baseline.
 *
 * @param {Array} glyphs       shaped glyphs {glyphname, xAdvance, xOffset, yOffset}
 * @param {Map}   instances   glyphName -> {instance}
 * @param {object} options
 *   upem, ascender, descender, boxHeight (px), color
 * @returns {SVGElement} width scales with the run; height is fixed
 */
export function glyphRunToSVG(glyphs, instances, options = {}) {
  const {
    upem = 1000,
    ascender = DEFAULT_ASCENDER * upem,
    descender = DEFAULT_DESCENDER * upem,
    boxHeight = 60,
    color = "currentColor",
  } = options;

  // The viewBox is in font units, matching glyph-cell.js.
  const runWidth = Math.max(
    (glyphs ?? []).reduce((sum, g) => sum + (g.xAdvance || 0), 0),
    1
  );
  // viewBox y: from ascender down to descender, with the y-flip handled by the
  // path transform, so the box is (descender..ascender) in flipped space.
  const viewY = -ascender;
  const viewHeight = Math.max(ascender - descender, 1);

  const children = [];
  let x = 0;
  for (const glyph of glyphs ?? []) {
    const obj = instances.get(glyph.glyphname);
    const pathEl = glyphPathElement(glyph, obj?.instance, { ascender, descender });
    if (pathEl) {
      // Place the glyph at its pen position, then apply the y-flip.
      const place = new Transform(
        1,
        0,
        0,
        1,
        x + (glyph.xOffset || 0),
        -(glyph.yOffset || 0)
      );
      pathEl.setAttribute(
        "transform",
        `matrix(${place.xx} ${place.xy} ${place.yx} ${place.yy} ${place.dx} ${place.dy}) matrix(1 0 0 -1 0 0)`
      );
      children.push(pathEl);
    }
    x += glyph.xAdvance || 0;
  }

  return svg.svg(
    {
      viewBox: svg.viewBox(0, viewY, runWidth, viewHeight),
      // Height is fixed for every preview; width follows the content, so the
      // aspect ratio is preserved and all previews share a scale.
      height: `${boxHeight}px`,
      preserveAspectRatio: "xMidYMid meet",
      class: "ot-svg-run",
    },
    [svg.g({ fill: color }, children)]
  );
}

/**
 * A single glyph on its own, drawn at the same scale as the run next to it.
 *
 * Uses the glyph's own advance width for the viewBox (so a narrow glyph is
 * not blown up to fill the box) and the same ascender-to-descender height.
 */
export function glyphToSVG(glyphName, entry, options = {}) {
  const {
    upem = 1000,
    ascender = DEFAULT_ASCENDER * upem,
    descender = DEFAULT_DESCENDER * upem,
    boxHeight = 60,
    color = "currentColor",
  } = options;

  const instance = entry?.instance ?? entry;
  const advance = instance?.xAdvance ?? upem * 0.5;
  const viewY = -ascender;
  const viewHeight = Math.max(ascender - descender, 1);

  const pathEl = glyphPathElement(glyphName, instance, { ascender, descender });

  return svg.svg(
    {
      viewBox: svg.viewBox(0, viewY, Math.max(advance, 1), viewHeight),
      height: `${boxHeight}px`,
      preserveAspectRatio: "xMidYMid meet",
      class: "ot-svg-glyph",
    },
    [svg.g({ fill: color }, pathEl ? [pathEl] : [])]
  );
}

export { getVerticalMetrics };
