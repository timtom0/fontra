"""Recover OpenType layout feature code (FEA) from a compiled binary font.

A .ttf/.otf stores its features compiled into the GSUB/GPOS tables, which is a
binary form that cannot be shown or edited as text. `fontFeatures` can read
those tables back into a feature-file representation, which is what the editor
needs in order to display and edit them.

The TTF backend is read-only (it implements ReadableFontBackend only), so this
is purely a read path: whatever we produce here is shown in the Feature Code /
feature-editor panels, and it is never written back to the font.

Reading is best effort. fontFeatures cannot represent every construct that
appears in real-world fonts, and one unreadable lookup makes it fail for the
whole table. A font that cannot be read in full is therefore read table by
table, and whatever we could recover is returned, with a note about what was
dropped -- the user is told rather than silently shown incomplete features.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

otFeaturesReadWarning = """\
#
# FONTRA WARNING! These features were read from the binary GSUB/GPOS tables of
# the font, as this .ttf/.otf is opened for editing.
#
# Fontra does not write .ttf/.otf files: this code is shown for inspection and
# editing, but any edits you make are not saved back into the font. To keep your
# edits, save the font as a .designspace/.ufo project instead.
#
# Because the features were recovered from compiled binary tables, they may not
# be a literal copy of the font's original feature code:
# - Feature and lookup names come from the binary tables, so they may be
#   auto-generated (for example 'SingleSubstitution7').
# - Variable font feature values are read at their default instance location.
# - Constructs that have no feature-file equivalent are not represented.
"""

otFeaturesPartialWarning = """\
#
# FONTRA WARNING! Part of this font's layout features could not be read: %s.
# The features below are incomplete.
#
"""


def _getFontFeatures() -> Any:
    """Return fontFeatures.ttLib, or None if fontFeatures is not installed."""
    try:
        from fontFeatures import ttLib
    except ImportError:
        return None
    return ttLib


def _asFeaText(ttLib: Any, font: Any, tableTag: str) -> str:
    """Unparse only one layout table of `font`, and return it as feature code.

    fontFeatures reads GSUB and GPOS together, and raises if either cannot be
    read. Hiding the other table on a shallow copy lets us read the tables one at
    a time, so a font whose GPOS we can't handle still shows its GSUB.
    """
    otherTag = "GPOS" if tableTag == "GSUB" else "GSUB"
    # Check font.tables rather than `in font`: a lazily loaded font reports no
    # tables until they have been read, and popping a key that is not there yet
    # would raise.
    hadOther = otherTag in font.tables
    if hadOther:
        hidden = font.tables.pop(otherTag)
    try:
        features = ttLib.unparse(font, do_gdef="GDEF" in font.tables)
        return features.asFea()
    finally:
        if hadOther:
            font.tables[otherTag] = hidden


def unparseOpenTypeFeatures(font: Any) -> str:
    """Return feature code (FEA) recovered from `font`'s GSUB/GPOS/GDEF tables.

    Returns an empty string if the font has no layout features, or if none of
    its features could be recovered (in which case a warning is logged).
    """
    presentTags = [t for t in ("GSUB", "GPOS") if t in font]
    if not presentTags:
        # Nothing to recover. Not an error: plenty of fonts have no features.
        return ""

    ttLib = _getFontFeatures()
    if ttLib is None:
        logger.warning(
            "fontFeatures is not installed: can't display the OpenType features "
            "of this font. Install it with: pip install fontFeatures"
        )
        return ""

    # Try both tables at once: this is the common case and gives the best result.
    try:
        features = ttLib.unparse(font, do_gdef=True).asFea()
        if features.strip():
            return otFeaturesReadWarning + features
    except Exception as e:
        logger.info(f"can't read all layout features of this font at once: {e!r}")

    # Fall back to reading each table separately, so that one unreadable table
    # doesn't cost us the other one.
    recovered: dict[str, str] = {}
    failed: list[str] = []
    for tableTag in presentTags:
        try:
            text = _asFeaText(ttLib, font, tableTag)
        except Exception as e:
            logger.info(f"can't read {tableTag} of this font: {e!r}")
            failed.append(tableTag)
            continue
        if text.strip():
            recovered[tableTag] = text

    if not recovered:
        logger.warning(
            f"can't recover any OpenType features from this font: {', '.join(failed)}"
        )
        return ""

    featuresText = otFeaturesReadWarning
    if failed:
        featuresText += otFeaturesPartialWarning % ", ".join(failed)
    featuresText += "\n".join(recovered.values())
    return featuresText