# Notification Cascade editing contract

## Surface ownership

This is a generic notification presentation with a HyperFrames-branded payoff. The notification geometry, backdrop, stacking behavior, typography, and motion belong to the template. The supplied website is the subject brand placed into declared slots.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- `notifTitle`, `message1` through `message4`, and `appName`
- `headlineTop`, `headlineAccent`, and `footerText`
- `brandLogo`, using a transparent mark that remains legible on the dark closing card

Keep replacement copy within 20% of the original length.

## Protected

Do not change CSS, layout, backdrop, notification chrome, scene structure, duration, timing, easing, stacking, or reveal behavior. Do not replace any image outside the declared closing-card logo slot. Colors are protected because this template declares no color variables.
