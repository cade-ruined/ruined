# Payment method assets

These SVGs are unmodified copies from Shopify's [Payment Icons library](https://github.com/activemerchant/payment_icons), pinned to commit `fc8c830a5ca576553df88bf364fd449ea7b4f069`. Geometry and colors are preserved. The upstream `MIT-LICENSE` is included in this directory.

## Original files

- [Visa](https://raw.githubusercontent.com/activemerchant/payment_icons/fc8c830a5ca576553df88bf364fd449ea7b4f069/app/assets/images/payment_icons/visa.svg)
- [Mastercard](https://raw.githubusercontent.com/activemerchant/payment_icons/fc8c830a5ca576553df88bf364fd449ea7b4f069/app/assets/images/payment_icons/master.svg)
- [American Express](https://raw.githubusercontent.com/activemerchant/payment_icons/fc8c830a5ca576553df88bf364fd449ea7b4f069/app/assets/images/payment_icons/american_express.svg)
- [Discover](https://raw.githubusercontent.com/activemerchant/payment_icons/fc8c830a5ca576553df88bf364fd449ea7b4f069/app/assets/images/payment_icons/discover.svg)
- [Diners Club](https://raw.githubusercontent.com/activemerchant/payment_icons/fc8c830a5ca576553df88bf364fd449ea7b4f069/app/assets/images/payment_icons/diners_club.svg)
- [Shop Pay](https://raw.githubusercontent.com/activemerchant/payment_icons/fc8c830a5ca576553df88bf364fd449ea7b4f069/app/assets/images/payment_icons/shopify_pay.svg)
- [Apple Pay](https://raw.githubusercontent.com/activemerchant/payment_icons/fc8c830a5ca576553df88bf364fd449ea7b4f069/app/assets/images/payment_icons/apple_pay.svg)
- [Google Pay](https://raw.githubusercontent.com/activemerchant/payment_icons/fc8c830a5ca576553df88bf364fd449ea7b4f069/app/assets/images/payment_icons/google_pay.svg)
- [License](https://raw.githubusercontent.com/activemerchant/payment_icons/fc8c830a5ca576553df88bf364fd449ea7b4f069/MIT-LICENSE)

## Store verification

Verified on 2026-10-09 using a read-only, tokenless Storefront API request to `https://ys6qmd-xp.myshopify.com/api/2026-07/graphql.json`:

```graphql
query FooterConfidence {
  shop {
    name
    paymentSettings {
      acceptedCardBrands
      supportedDigitalWallets
    }
  }
}
```

The response returned shop name `Ruined`, accepted cards `VISA`, `MASTERCARD`, `DISCOVER`, `AMERICAN_EXPRESS`, `DINERS_CLUB`, and supported wallets `SHOPIFY_PAY`, `APPLE_PAY`, `GOOGLE_PAY`. These are configured capabilities; no payment was submitted. Wallet presentation can depend on the buyer's device and checkout context. Do not infer additional payment methods from this set or from generic checkout scripts. Refresh this verification when payment settings change.

The [Shopify PaymentSettings reference](https://shopify.dev/docs/api/storefront/latest/objects/PaymentSettings) describes the accepted-card and supported-wallet fields.

All eight files were parsed as SVG and checked for scripts, event handlers, external references, foreign objects, embedded images, entities, and imports before being added.
