# WhatsApp store manager

Shop owners run their shop by messaging the CPSE WhatsApp business number:
open orders, accept / move on / reject orders, today's sales, stock, low stock,
stock received, closing for the day, and new-order alerts with buttons.

Built on **Meta's WhatsApp Cloud API**. No AI: short words and tap-to-choose
buttons and lists, so every reply is predictable.

## How it works

```
Shop owner's WhatsApp ──► Meta ──► POST /api/v1/whatsapp/webhook (signed)
                                         │
                                         ▼
                          whatsappBot.js — same services as the app
                          (orders via transitionOrder, stock via the ledger)
                                         │
Shop owner's WhatsApp ◄── Meta ◄── graph.facebook.com/<version>/<phone id>/messages
```

| Piece | Where |
|---|---|
| Tables `merchant_whatsapp_links`, `whatsapp_messages` | `backend/migrations/0048_whatsapp_store_manager.sql` |
| Meta client: signature check, message shapes, sending | `backend/src/lib/whatsapp.js` |
| Linking, message log, new-order alerts | `backend/src/modules/whatsapp/whatsapp.service.js` |
| Commands | `backend/src/modules/whatsapp/whatsappBot.js` |
| Routes | `backend/src/modules/whatsapp/whatsapp.routes.js` (documented in `backend/docs/API.md` → WhatsApp store manager) |
| Shop app screen (More → WhatsApp) | `frontend/merchant/src/features/tools/WhatsAppPage.tsx` and the same in `frontend-redesign-v2` |
| Tests | `backend/tests/integration/whatsapp.test.js`, `backend/tests/whatsapp.test.js`, `frontend/merchant/tests/whatsapp.test.tsx` |

### Security

- **Linking proves the number.** The app shows a 6-digit code (15 minutes, 5
  tries). The link only becomes active when `LINK <code>` arrives *from that
  number*. Until then nothing that number sends is acted on.
- **One number, one account** (`PHONE_TAKEN`).
- **Every webhook call is signed.** `X-Hub-Signature-256` must be the
  HMAC-SHA256 of the exact body with the app secret; anything else is a 403
  and nothing is read.
- **Buttons are not trusted.** Every order, product or shop id in a tap is
  checked again against the owner's own shop, and every order action against
  what the order allows right now.
- **Refusing a customer asks first.** Reject and cancel need a Yes tap.
- **Suspended accounts** get a notice and nothing else.
- Every message in and out is logged in `whatsapp_messages`; a message Meta
  delivers twice is handled once.

### The 24-hour rule

WhatsApp only allows free-form messages to someone for 24 hours after they
last wrote to you. Replies are always inside that window. **New-order alerts**
may not be: inside the window they go out with Accept / Reject / View buttons;
outside it they need an approved **template**. Without one
(`WHATSAPP_ORDER_TEMPLATE` unset) the alert is logged as `skipped` with that
reason, and the order is still in the app as usual.

## Setting it up (one-time, done by the CPSE team)

What you need: a Meta (Facebook) Business account, and a phone number that is
**not** currently on WhatsApp or WhatsApp Business (it becomes the CPSE
business number). The first 1,000 service conversations a month are free.

1. **Create the app.** developers.facebook.com → My Apps → Create app →
   *Business* → add the **WhatsApp** product, linked to your Business account.
2. **Add the number.** WhatsApp → API setup → *Add phone number*, verify it by
   SMS or call. Note the **Phone number ID**.
3. **Permanent token.** Business settings → Users → *System users* → add an
   admin system user → *Generate token* for the app with
   `whatsapp_business_messaging` and `whatsapp_business_management`. (The
   token on the API setup page expires in 24 hours. Don't use it in
   production.)
4. **App secret.** App settings → Basic → *App secret*.
5. **Set the environment** on the server (Render → Environment):

   ```
   WHATSAPP_PROVIDER=meta
   WHATSAPP_PHONE_NUMBER_ID=<step 2>
   WHATSAPP_ACCESS_TOKEN=<step 3>
   WHATSAPP_APP_SECRET=<step 4>
   WHATSAPP_VERIFY_TOKEN=<any long random string you make up>
   WHATSAPP_BUSINESS_NUMBER=<the number, digits with country code, e.g. 919000000001>
   ```

   The server refuses to start with `WHATSAPP_PROVIDER=meta` and any of these
   missing.
6. **Register the webhook.** WhatsApp → Configuration → Webhook → *Edit*:
   - Callback URL: `https://cpse.onrender.com/api/v1/whatsapp/webhook`
   - Verify token: the same `WHATSAPP_VERIFY_TOKEN`
   - Then *Manage* → subscribe to **messages**.
   Meta needs a public HTTPS address. For a local test, use a tunnel (e.g.
   `cloudflared tunnel --url http://localhost:4000`) and its URL instead.
7. **New-order template** (for alerts outside the 24-hour window). WhatsApp
   Manager → Message templates → *Create*: category **Utility**, name
   `new_order_alert`, language English, body:

   ```
   New order at {{1}}: {{2}}. {{3}}. Open CPSE or reply "orders" to accept it.
   ```

   After Meta approves it, set `WHATSAPP_ORDER_TEMPLATE=new_order_alert` (and
   `WHATSAPP_TEMPLATE_LANGUAGE=en`).
8. **Apply migration `0048_whatsapp_store_manager.sql`** to the database.
9. **Try it.** In the shop app: More → WhatsApp → enter your number → *Open
   WhatsApp with this message* → send. Then send `hi`.

While the Meta app is in development mode, only numbers added under
API setup → *To* can receive messages. Switch the app to **Live** before shop
owners use it.

## What it does not do (yet)

- Plain-language questions ("how much did I sell on Diwali?"). Commands only.
- Editing prices or products, counter sales, khata and refunds. Use the app.
- Low-stock pushes. `low stock` answers on request; nothing is sent unasked
  except new-order alerts.
- Messages to customers. This is the shop owner's channel only.
