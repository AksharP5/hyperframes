# Share-Sheet Carousel editing contract

## Surface ownership

This template depicts an operating-system share sheet. The supplied website is the item or sender shown inside that interface; it does not own the surrounding system UI.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- `shareTitle`, `senderName`, `itemLabel`, and `stripText`
- `acceptLabel` and `declineLabel`
- `slideImage1` through `slideImage4`; each image also drives its matching blurred background
- `brandLogo`, using a transparent horizontal wordmark

Keep replacement copy within 20% of the original length.

## Protected

Preserve the share-sheet palette, typography, buttons, geometry, carousel layout, scene structure, duration, timing, easing, and tap animation. Do not replace any image outside the declared slide and logo slots, and do not recolor the operating-system interface.
