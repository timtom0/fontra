import { SVGPath2D } from "@fontra/core/glyph-svg.js";
import * as svg from "@fontra/core/svg-utils.js";
import { Transform } from "@fontra/core/transform.js";

/**
 * Render a run of shaped glyphs as an inline SVG element.
 *
 * The glyphs are laid out on a common baseline, horizontally centred in a
 * fixed box, and flipped into SVG's y-down coordinate space with a transform
 * (the same trick glyph-cell.js uses).
 *
 * @param {Array} glyphs       shaped glyphs: {glyphname, xAdvance, xOffset, yOffset}
 * @param {Map} glyphInstances glyphName -> {instance} with a flattenedPath
 * @param {object} options
 *   fontSize   cap-ish size in px (default 34)
 *   boxWidth   width of the returned SVG in px (default 200)
 *   boxHeight  height of the returned SVG in px (default 56)
 *   color      fill colour for the outlines
 * @returns {SVGElement}
 */
export function glyphRunToSVG(glyphs, glyphInstances, options = {}) {
  const {
    fontSize = 34,
    boxWidth = 200,
    boxHeight = 56,
    color = "currentColor",
  } = options;

  const upem = options.unitsPerEm || 1000;
  const scale = fontSize / upem;

  // Lay the run out: total advance width, and the vertical extent.
  let advance = 0;
  for (const glyph of glyphs ?? []) {
    advance += (glyph.xAdvance || 0) * scale;
  }

  // Centre horizontally: shift so the run's midpoint lands in the middle of
  // the box. This is what made the old canvas version look off-centre.
  const shiftX = (boxWidth - advance) / 2;
  // Sit the baseline a little above the bottom, leaving room for descenders.
  const baseline = boxHeight * 0.78;

  const pathElements = [];
  let x = 0;

  for (const glyph of glyphs ?? []) {
    const obj = glyphInstances.get(glyph.glyphname);
    const glyphController = obj?.instance;
    if (glyphController?.flattenedPath) {
      const svgPath = new SVGPath2D();
      glyphController.flattenedPath.drawToPath2d(svgPath);

      // A glyph's path is in font units with y up; the run is laid out in px
      // with y down, so scale and flip in one transform.
      const base = new Transform(scale, 0, 0, -scale, shiftX + x, baseline);
      const transform =
        glyph.xOffset || glyph.yOffset
          ? base.transform(
              new Transform(
                1,
                0,
                0,
                1,
                (glyph.xOffset || 0) * scale,
                -(glyph.yOffset || 0) * scale
              )
            )
          : base;

      pathElements.push(
        svg.path({
          d: svgPath.getPath(),
          transform,
        })
      );
    }
    x += (glyph.xAdvance || 0) * scale;
  }

  return svg.svg(
    {
      viewBox: svg.viewBox(0, 0, boxWidth, boxHeight),
      width: `${boxWidth}px`,
      height: `${boxHeight}px`,
      class: "ot-svg-run",
    },
    [svg.g({ fill: color }, pathElements)]
  );
}

/**
 * A small SVG that shows a single glyph, used as the "output" thumbnail.
 * The glyph is scaled to fit the box and centred both ways.
 */
export function glyphToSVG(glyphName, glyphInstance, options = {}) {
  const {
    boxWidth = 60,
    boxHeight = 56,
    color = "currentColor",
    upem = 1000,
  } = options;

  const path = glyphInstance?.flattenedPath;
  if (!path) {
    return svg.svg({
      viewBox: svg.viewBox(0, 0, boxWidth, boxHeight),
      width: `${boxWidth}px`,
      height: `${boxHeight}px`,
    });
  }

  const bounds = glyphInstance.bounds ?? { xMin: 0, xMax: upem, yMin: 0, yMax: upem };
  const glyphWidth = Math.max(bounds.xMax - bounds.xMin, 1);
  const glyphHeight = Math.max(bounds.yMax - bounds.yMin, 1);

  // Fit the glyph into the box, preserving its aspect ratio, then centre.
  const fit = Math.min((boxWidth * 0.7) / glyphWidth, (boxHeight * 0.7) / glyphHeight);
  const drawWidth = glyphWidth * fit;
  const drawHeight = glyphHeight * fit;
  const offsetX = (boxWidth - drawWidth) / 2 - bounds.xMin * fit;
  const offsetY = (boxHeight - drawHeight) / 2 + bounds.yMax * fit;

  const svgPath = new SVGPath2D();
  path.drawToPath2d(svgPath);

  return svg.svg(
    {
      viewBox: svg.viewBox(0, 0, boxWidth, boxHeight),
      width: `${boxWidth}px`,
      height: `${boxHeight}px`,
    },
    [
      svg.g({ fill: color }, [
        svg.path({
          d: svgPath.getPath(),
          transform: new Transform(fit, 0, 0, -fit, offsetX, offsetY),
        }),
      ]),
    ]
  );
}
