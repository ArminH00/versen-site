# Versen integration

## Shopify

Vercel behöver dessa environment variables:

- `SHOPIFY_STORE_DOMAIN`: butikens myshopify-domän, till exempel `versen.myshopify.com`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`: Storefront API-token från Shopify
- `SHOPIFY_API_VERSION`: Shopify API-version, standard är `2026-04`

Endpoints:

- `GET /api/products`: hämtar produkter från Shopify Storefront API
- `POST /api/cart`: skapar en Shopify cart och returnerar `checkoutUrl`

Frontend har statiska produkter som fallback. När Shopify-env vars finns byter `produkter.html` automatiskt till produkter från `/api/products`.

## Medlemskap

Medlemskap ska inte bara låsas i frontend. Servern måste avgöra om en användare är medlem innan medlemspris eller checkout-rabatt används.

Rekommenderad MVP:

1. Använd Shopify för produktkatalog och checkout.
2. Använd en auth-provider för inloggning och session, till exempel Clerk eller Supabase Auth.
3. Spara medlemsstatus server-side.
4. När medlemmen checkar ut skapar `/api/cart` en cart med medlemsrabatt eller medlemsvariant.

Viktigt: rabatter och medlemspriser behöver även skyddas i Shopify/checkout, inte bara döljas visuellt på sidan.
