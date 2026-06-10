#!/usr/bin/env python3
"""Generate the extension icons (public/icon/{16,32,48,128}.png).

Draws the Margin brand mark — a rounded square in the panel's muted-blue
accent with a vertical "ruled margin" line and two horizontal text
lines — matching src/ui/BrandMark.tsx. Colors are the sRGB equivalents
of the oklch tokens in src/ui/styles.css (accent: oklch(0.56 0.12 250),
on-accent: oklch(0.99 0.005 250)).

Run from the repo root:  python3 scripts/generate-icons.py
Requires Pillow (pip install pillow). Committed so the icons are
reproducible rather than opaque binaries.
"""

from PIL import Image, ImageDraw

ACCENT = (53, 120, 184, 255)  # oklch(0.56 0.12 250) → sRGB
ON_ACCENT = (250, 251, 253, 255)  # oklch(0.99 0.005 250) → sRGB
RULE = (250, 251, 253, 210)  # the margin rule, slightly translucent

# Draw at 8x and downsample for clean anti-aliasing at every size.
BASE = 1024


def draw_mark() -> Image.Image:
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Rounded-square plate.
    d.rounded_rectangle([0, 0, BASE - 1, BASE - 1], radius=BASE * 0.22, fill=ACCENT)
    # Vertical ruled-margin line.
    rule_x = BASE * 0.32
    d.rounded_rectangle(
        [rule_x - BASE * 0.015, BASE * 0.24, rule_x + BASE * 0.015, BASE * 0.76],
        radius=BASE * 0.015,
        fill=RULE,
    )
    # Two text lines to the right of the rule.
    line_h = BASE * 0.045
    x0, x1 = BASE * 0.42, BASE * 0.74
    for y in (BASE * 0.40, BASE * 0.56):
        d.rounded_rectangle([x0, y, x1, y + line_h], radius=line_h / 2, fill=ON_ACCENT)
    return img


def main() -> None:
    mark = draw_mark()
    for size in (16, 32, 48, 128):
        mark.resize((size, size), Image.LANCZOS).save(f"public/icon/{size}.png")
        print(f"wrote public/icon/{size}.png")


if __name__ == "__main__":
    main()
