# Diagram

`signals.png` (3200×1800) is the "signals → music" diagram for the DEV post. Its source is `signals.html` (1600×900 design, fonts from `web/node_modules`, so run `npm install` in `web/` first).

Render it on macOS with the built-in QuickLook (no browser needed):

```bash
qlmanage -t -s 3200 -o /tmp signals.html && sips -c 1800 3200 /tmp/signals.html.png --out signals.png
```

QuickLook draws into a 1024 px square, which is why the HTML uses `zoom: .64` and a top margin: the centered 16:9 crop then lands exactly on the design.
