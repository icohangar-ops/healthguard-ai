# Trust Ledger OS Video Script

## Goal
Create a 2-minute product video from screenshots stitched with FFmpeg.

## Shot Order
1. Title card: Trust Ledger OS
2. Problem: agentic drift and invisible risk
3. PRISM trace: runtime observability for a risky action
4. Prelint review: pre-merge policy review catching drift
5. GIDE edit: secure offline fix flow
6. Ledger result: approved / denied decision recorded

## Narration Draft
"AI teams are moving fast, but their controls are not. Code changes, agent actions, and spend decisions can drift before anyone notices.

Trust Ledger OS gives every high-impact decision a review path, a trace, and a permanent record.

Prelint catches risky product drift before merge. PRISM shows exactly what the agent did and how long it took. GIDE keeps the fix loop secure and offline when needed.

The result is simple: faster teams, fewer surprises, and a trust ledger you can audit later.

Approve, deny, or counter the decision, then keep building."

## FFmpeg Notes
- Use 6 screenshots, 20 seconds each.
- Keep output at 1080p and 30 fps.
- Add simple crossfade transitions later if needed.

Example command:

```bash
ffmpeg \
  -loop 1 -t 20 -i screenshots/01-hero.png \
  -loop 1 -t 20 -i screenshots/02-risk-dashboard.png \
  -loop 1 -t 20 -i screenshots/03-prism-trace.png \
  -loop 1 -t 20 -i screenshots/04-prelint-review.png \
  -loop 1 -t 20 -i screenshots/05-gide-edit.png \
  -loop 1 -t 20 -i screenshots/06-ledger-entry.png \
  -filter_complex "[0:v][1:v][2:v][3:v][4:v][5:v]concat=n=6:v=1:a=0,format=yuv420p" \
  -r 30 -c:v libx264 trust-ledger-os-demo.mp4
```
