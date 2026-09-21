# Phase 11.20 — browser testing checklist

Everything else in Phase 11 was verified by 542 automated tests and by driving the
live API. **This part cannot be.** jsdom has no layout engine, no real touch input,
no Safari, and no slow network — so the things on this list are exactly the things
the test suite is blind to.

Run both servers, then open the app on a real phone and a real desktop browser.

```bash
cd backend  && npm run dev              # :4000
cd frontend && npm run dev -- --host    # --host makes it reachable from your phone
```

Browse to `http://<your-computer's-LAN-IP>:5173` from the phone. Two things must
change for that to work:

- `backend/.env` → `CORS_ORIGINS=http://localhost:5173,http://<LAN-IP>:5173`
- `frontend/.env` → `VITE_API_BASE_URL=http://<LAN-IP>:4000/api/v1`

Sign in as `test.customer@cpse.local` / `CpseTest!2026`.

---

## On a phone

### Layout
- [ ] No horizontal scrolling on any screen. Swipe sideways on each — the page must not move.
- [ ] The product grid shows two columns and the cards are not cramped.
- [ ] Long text breaks nothing: the shop name on the store page, a product name on a card, an email on the account screen.
- [ ] The bottom tab bar does not cover the last item of a long list — scroll to the bottom of the cart and of the order list.
- [ ] On an iPhone with a home indicator, the tab bar sits above it rather than under it.
- [ ] The sticky header stays put while scrolling and does not jump.

### Keyboard
- [ ] Tapping a field scrolls it into view rather than leaving it behind the keyboard. Worst case: the PIN code field at the bottom of the address form.
- [ ] Email brings up an email keyboard; phone and PIN code bring up numeric ones.
- [ ] The search field's return key reads "search".
- [ ] Dismissing the keyboard leaves no gap at the bottom of the page.

### Touch
- [ ] Every button is comfortable one-handed — particularly the cart's quantity stepper and the filter chips.
- [ ] No accidental double-fire: tap **Place order** twice, fast. Exactly one order must appear in your list.
- [ ] Pinch-zoom works. It is deliberately not disabled.

### The real thing
- [ ] Walk the journey: shop → search → product → 5 kg variant → add → cart → checkout → pay online → mock gateway → success.
- [ ] Repeat with **Decline the card**, and with **Cancel**.
- [ ] Turn on airplane mode mid-journey. A black "You are offline" banner should appear, and the next action should say "No connection" rather than failing silently.
- [ ] Turn it off — the banner goes.
- [ ] Throttle to Slow 3G and reload the store page. Skeletons should appear, not a blank screen.

## On a desktop

- [ ] The app is a centred phone-width column with a visible edge, not a stretched page.
- [ ] Tab through a screen using the keyboard only. A green focus ring must be visible at every stop, and the first Tab should reach "Skip to content".
- [ ] The receipt prints cleanly: open one and press Ctrl/Cmd+P. The header, tab bar and buttons must not appear in the preview.
- [ ] Try Safari as well as Chrome. The `:has()` selectors on the variant and address rows, and `aspect-ratio` on images, are the parts most likely to differ.

## What to report back

For anything that fails: which screen, which device and browser, and what you
expected instead. A screenshot of the Network tab helps for anything that looks
like a data problem.

## Known and deliberate — not bugs

- **No product photos, only initials.** The seeded catalogue points at `images.cpse.local`, which cannot resolve, so the app does not request it at all.
- **"Too many requests" after repeated sign-ins.** The auth rate limit is 20 per 15 minutes and clears itself.
- **A closed shop still takes orders.** The order waits until the shop opens; blocking it would simply lose the order.
