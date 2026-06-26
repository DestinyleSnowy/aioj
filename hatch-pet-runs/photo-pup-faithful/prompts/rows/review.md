Create one horizontal animation strip for Codex pet `photo-pup`, state `review`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 6 full-body frames in one left-to-right row on flat pure green #00FF00. Treat the row as 6 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: Must resemble the provided photo closely: extremely fluffy white plush dog/toy, close rounded cloud-like head, ears mostly hidden in fur not tall pointed ears, small glossy black bead eyes, small low black triangular nose, no visible mouth, large front paws/paw pads facing viewer near bottom, soft overgrown fur obscuring body, cozy tilted plush expression. Avoid generic puppy, avoid upright terrier ears, avoid Westie/Pomeranian/anime style, avoid clean sculpted dog anatomy, avoid doodles/text/music notes from the photo.. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `plush`: Soft plush toy mascot with rounded stitched forms, fuzzy fabric feel, simple sewn details, and readable toy-like proportions. User style notes: Photo-faithful soft plush toy sprite, slightly photoreal fuzzy fur, compact front-facing body, readable at 192x208, flat chroma-key background, no shadows..
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Ready-review loop: focused inspection of completed output with lean, blink, narrowed eyes, head tilt, or paw pose.

State requirements:
- Show review through lean, blink, narrowed eyes, head tilt, or paw/hand position.
- Do not add magnifying glasses, papers, code, UI, punctuation, symbols, or other new props unless they already exist in the base pet identity.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.
