# Versen integration

## Rekommenderad arkitektur

Versen ska agera egen butik mot kund: Supabase Auth, intern checkout, Stripe-betalningar, Stripe-medlemskap och egna emails via Resend. Shopify ska bara vara intern motor för produkter, lager, orderhantering och fulfillment. Recharge används inte i nya kundflödet.

## Environment variables

Vercel behöver dessa environment variables:

- `SUPABASE_URL` eller `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: server-side key för profiles, orders och subscriptions
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: Stripe publishable key for Payment Element
- `STRIPE_SECRET_KEY`: Stripe secret key, endast server-side
- `STRIPE_WEBHOOK_SECRET`: verifierar Stripe webhooks mot `/api/checkout?webhook=stripe`
- `STRIPE_MEMBERSHIP_PRICE_ID`: fallback price id för medlemskap
- `STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID`: Stripe price id för månadsmedlemskap
- `STRIPE_MEMBERSHIP_YEARLY_PRICE_ID`: Stripe price id för årsmedlemskap
- `RESEND_API_KEY`: egna emails via Resend
- `RESEND_FROM_EMAIL` eller `VERSEN_EMAIL_FROM`: avsändare, till exempel `Versen <konto@dindomän.se>`
- `SHOPIFY_STORE_DOMAIN`: butikens myshopify-domän, till exempel `versen.myshopify.com`
- `SHOPIFY_API_VERSION`: Shopify API-version, standard är `2026-04`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`: Admin API-token för order sync
- `SHOPIFY_APP_CLIENT_ID`: Client ID från Shopify Dev Dashboard
- `SHOPIFY_APP_CLIENT_SECRET`: Client secret från Shopify Dev Dashboard
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`: Storefront API-token. Skapas via setup-endpointen nedan.
- `VERSEN_SETUP_SECRET`: valfri stark engångshemlighet för setup-endpointen
- `VERSEN_SITE_URL`: publik URL, till exempel `https://project-f8ph5.vercel.app`
- `VERSEN_EMAIL_VERIFICATION_SECRET`: stark hemlighet för signerade verifieringslänkar

Rotera `SHOPIFY_APP_CLIENT_SECRET` om den har visats i chat, skärmdump eller annan osäker plats.

Endpoints:

- `GET /api/products`: hämtar produkter från Shopify Storefront API
- `POST /api/cart`: legacy cart-endpoint. Nya produktköp ska gå via intern checkout.
- `GET/POST /api/account`: verifierar email, skapar konto, loggar in, loggar ut, skickar lösenordsåterställning och hämtar medlemsstatus
- `POST /api/checkout`: validerar cart, skapar Stripe PaymentIntent och sparar order i Supabase
- `POST /api/checkout?webhook=stripe`: Stripe webhook för produktbetalningar och medlemsstatus
- `POST /api/membership-checkout`: skapar Stripe Subscription för medlemskap och returnerar Payment Element client secret
- `GET /api/admin-members`: hämtar medlemmar för intern vy. Kräver `Authorization: Bearer <VERSEN_ADMIN_SECRET>`.
- `GET /api/shopify-status`: kontrollerar om Admin API och Storefront API fungerar
- `POST /api/create-storefront-token`: skapar en Storefront-token via Admin API. Kräver `Authorization: Bearer <VERSEN_SETUP_SECRET>`.
- `POST /api/shopify-order-webhook`: Shopify order/fulfillment webhook som uppdaterar Supabase orderstatus och triggar egna Resend-mail.

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

Medlemskap ska inte bara låsas i frontend. Servern avgör om en användare är medlem innan medlemspris eller checkout-rabatt används.

Nya medlemskap ägs av Stripe subscriptions. Supabase speglar status i `profiles` och `subscriptions`. Shopify/ReCharge ska inte skapa eller tolka medlemskap.

Kundflöde:

1. Kunden trycker på medlemskap.
2. Om kunden inte är inloggad skickas kunden till `konto.html?next=membership`.
3. Kunden anger email och får verifieringslänk.
4. Efter verifierad email väljer kunden lösenord och Supabase-kontot skapas.
5. Kunden skickas tillbaka till `medlemskap.html`.
6. Versen skapar en Stripe Subscription och visar Stripe Payment Element på medlemskapssidan.
7. Stripe tar betalt.
8. Stripe webhook uppdaterar Supabase `profiles.membership_status` och `subscriptions`.
9. Resend skickar medlemsmail.
10. Intern checkout tillåter produktbetalning när kunden är inloggad och aktiv medlem.

Viktigt: bygg inte dubbla subscription-system. Stripe äger medlemskap; Supabase speglar; Shopify hanterar produkter, lager, order och fulfillment bakom kulisserna. Shopify ska inte skicka kundmail.
