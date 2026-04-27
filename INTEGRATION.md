# Versen integration

## Shopify

Vercel behöver dessa environment variables:

- `SHOPIFY_STORE_DOMAIN`: butikens myshopify-domän, till exempel `versen.myshopify.com`
- `SHOPIFY_API_VERSION`: Shopify API-version, standard är `2026-04`
- `SHOPIFY_APP_CLIENT_ID`: Client ID från Shopify Dev Dashboard
- `SHOPIFY_APP_CLIENT_SECRET`: Client secret från Shopify Dev Dashboard
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`: Storefront API-token. Skapas via setup-endpointen nedan.
- `VERSEN_SETUP_SECRET`: valfri stark engångshemlighet för setup-endpointen
- `VERSEN_SITE_URL`: publik URL, till exempel `https://project-f8ph5.vercel.app`
- `VERSEN_EMAIL_VERIFICATION_SECRET`: stark hemlighet för signerade verifieringslänkar
- `RESEND_API_KEY`: används för verifieringsmail
- `VERSEN_EMAIL_FROM`: avsändare, till exempel `Versen <konto@dindomän.se>`

Rotera `SHOPIFY_APP_CLIENT_SECRET` om den har visats i chat, skärmdump eller annan osäker plats.

Endpoints:

- `GET /api/products`: hämtar produkter från Shopify Storefront API
- `POST /api/cart`: skapar en Shopify cart från en eller flera varukorgsrader och returnerar `checkoutUrl`
- `GET/POST /api/account`: verifierar email, skapar konto, loggar in, loggar ut, skickar lösenordsåterställning och hämtar medlemsstatus
- `POST /api/membership-checkout`: skapar Shopify checkout för medlemskapsprodukten
- `GET /api/admin-members`: hämtar medlemmar för intern vy. Kräver `Authorization: Bearer <VERSEN_ADMIN_SECRET>`.
- `GET /api/shopify-status`: kontrollerar om Admin API och Storefront API fungerar
- `POST /api/create-storefront-token`: skapar en Storefront-token via Admin API. Kräver `Authorization: Bearer <VERSEN_SETUP_SECRET>`.
- `POST /api/shopify-order-webhook`: Shopify webhook som taggar kunder som medlemmar efter betalt medlemskap.

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

Launch-MVP:

1. Skapa medlemskapsprodukten i Shopify med handle `medlemskap`.
2. Koppla produkten till Recharge om den ska vara en månadsprenumeration.
3. Sätt `SHOPIFY_MEMBER_DISCOUNT_CODE` i Vercel.
4. Sätt `VERSEN_MEMBER_TAG` i Vercel, standard är `versen_member`.
5. Sätt `VERSEN_MEMBERSHIP_PRODUCT_HANDLE` i Vercel om handle inte är `medlemskap`.
6. Sätt `SHOPIFY_MEMBERSHIP_SELLING_PLAN_ID` om Storefront-token inte har scope för selling plans.
7. Sätt `SHOPIFY_WEBHOOK_SECRET` och skapa Shopify webhook för `orders/paid` mot `/api/shopify-order-webhook`.
8. Sätt `VERSEN_ADMIN_SECRET` för intern adminvy på `admin.html`.

Kundflöde:

1. Kunden trycker på medlemskap.
2. Om kunden inte är inloggad skickas kunden till `konto.html?next=membership`.
3. Kunden anger email och får verifieringslänk.
4. Efter verifierad email väljer kunden lösenord och Shopify-kontot skapas.
5. Kunden skickas tillbaka till `medlemskap.html`.
6. Versen skapar Shopify cart med medlemskapsprodukten och kundens access token.
7. Shopify/ReCharge tar betalt och hanterar prenumerationen.
8. Shopify webhook taggar kunden med `VERSEN_MEMBER_TAG`.
9. `/api/cart` tillåter produktcheckout och applicerar medlemsrabatt bara när kunden är inloggad och aktiv medlem.

Recharge:

- För lansering är Shopify + Recharge smartast om produkterna och checkout redan ligger i Shopify. Då slipper vi bygga separat subscription billing, kundportal och orderkoppling.
- Byt till Stripe/egen billing först om medlemskapet ska leva helt utanför Shopify eller om Recharge skapar för mycket begränsning i kundportalen.
- Om `RECHARGE_API_TOKEN` finns kontrollerar Versen även aktiv Recharge-prenumeration via kundens email.
- Lägg till `RECHARGE_MEMBERSHIP_PRODUCT_ID` eller `RECHARGE_MEMBERSHIP_VARIANT_ID` om bara en viss subscription-produkt ska räknas.
- Annars används Shopify-kundtaggen som medlemsstatus.

Efter launch:

1. Lägg till Recharge cancellation-webhook eller schemalagd synk så taggen tas bort när medlemskap avslutas.
2. Bygg en mer komplett intern adminpanel om man vill hantera återbetalningar, manuella godkännanden och support.
3. Byt till separat auth-provider först om Shopify-konton inte räcker för produktvisionen.

Viktigt: rabatter och medlemspriser behöver även skyddas i Shopify/checkout, inte bara döljas visuellt på sidan.
