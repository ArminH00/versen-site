# Versen integration

## Shopify

Vercel behöver dessa environment variables:

- `SHOPIFY_STORE_DOMAIN`: butikens myshopify-domän, till exempel `versen.myshopify.com`
- `SHOPIFY_API_VERSION`: Shopify API-version, standard är `2026-04`
- `SHOPIFY_APP_CLIENT_ID`: Client ID från Shopify Dev Dashboard
- `SHOPIFY_APP_CLIENT_SECRET`: Client secret från Shopify Dev Dashboard
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`: Storefront API-token. Skapas via setup-endpointen nedan.
- `VERSEN_SETUP_SECRET`: valfri stark engångshemlighet för setup-endpointen

Rotera `SHOPIFY_APP_CLIENT_SECRET` om den har visats i chat, skärmdump eller annan osäker plats.

Endpoints:

- `GET /api/products`: hämtar produkter från Shopify Storefront API
- `POST /api/cart`: skapar en Shopify cart från en eller flera varukorgsrader och returnerar `checkoutUrl`
- `GET /api/shopify-status`: kontrollerar om Admin API och Storefront API fungerar
- `POST /api/create-storefront-token`: skapar en Storefront-token via Admin API. Kräver `Authorization: Bearer <VERSEN_SETUP_SECRET>`.

Frontend har statiska produkter som fallback. När Shopify-env vars finns byter `produkter.html` automatiskt till produkter från `/api/products`.

Kundkorgen sparas i webbläsaren tills kunden går vidare. Checkout skapas först när `kundkorg.html` skickar raderna till `/api/cart`.

## Setup för Dev Dashboard-app

1. Sätt dessa i Vercel:
   - `SHOPIFY_STORE_DOMAIN`
   - `SHOPIFY_APP_CLIENT_ID`
   - `SHOPIFY_APP_CLIENT_SECRET`
   - `VERSEN_SETUP_SECRET`
2. Redeploya.
3. Kör en `POST` mot `/api/create-storefront-token` med `Authorization: Bearer <VERSEN_SETUP_SECRET>`.
4. Spara `access_token` från svaret som `SHOPIFY_STOREFRONT_ACCESS_TOKEN` i Vercel.
5. Redeploya igen.
6. Kontrollera `/api/shopify-status`.

## Medlemskap

Medlemskap ska inte bara låsas i frontend. Servern måste avgöra om en användare är medlem innan medlemspris eller checkout-rabatt används.

Launch-MVP:

1. Skapa en rabattkod i Shopify för medlemmar.
2. Sätt `SHOPIFY_MEMBER_DISCOUNT_CODE` i Vercel.
3. Sätt `VERSEN_MEMBER_ACCESS_CODE` i Vercel.
4. Medlemmen loggar in på `konto.html` med medlemskoden.
5. `/api/cart` applicerar rabattkod server-side endast om medlemskoden matchar.

Efter launch:

1. Använd Shopify för produktkatalog och checkout.
2. Använd en auth-provider för inloggning och session, till exempel Clerk eller Supabase Auth.
3. Spara medlemsstatus server-side.
4. När medlemmen checkar ut skapar `/api/cart` en cart med medlemsrabatt eller medlemsvariant.

Viktigt: rabatter och medlemspriser behöver även skyddas i Shopify/checkout, inte bara döljas visuellt på sidan.
