# Pipeboard MCP — referência de tools (capturada ao vivo via tools/list)

Total: 74 tools. URL: https://tiktok-ads.mcp.pipeboard.co/
Gerado do /tmp/pipeboard-schemas.json (Gate 1). NÃO editar à mão — regenerar via /api/ads/diag.

## appeal_tiktok_smart_plus_ad
Appeal a Smart+ ad review/rejection via /smart_plus/ad/appeal/. Use when a creative was rejected and you have evidence to support an appeal.

If this call fails or behaves unexpectedly, report it via the submit_feedback tool with details.
- advertiser_id (req): string — TikTok Advertiser ID (required)
- smart_plus_ad_id (req): string — Smart+ ad ID being appealed (required)
- appeal_reason: string — Reason for the appeal (optional)
- attachment_list: array<string> — Optional attachment IDs supporting the appeal

## cancel_tiktok_report_task
Cancel an async report task that is still in progress.

If this call fails or behaves unexpectedly, report it via the submit_feedback tool with details.
- advertiser_id (req): string — TikTok Advertiser ID (required)
- task_id (req): string — Report task ID to cancel (required)

## check_tiktok_report_task
Check status of an async report task. Returns status (QUEUING, PROCESSING, COMPLETED, FAILED) and download_url.
- advertiser_id (req): string — TikTok Advertiser ID (required)
- task_id (req): string — Report task ID (required)

## create_tiktok_ad
Create a new TikTok ad within an ad group.

BEFORE calling this tool, you MUST call get_tiktok_identities(advertiser_id=...) to discover valid identities. Every ad requires identity_id + identity_type. Do NOT guess or reuse identity values 
- advertiser_id (req): string — TikTok Advertiser ID (required)
- adgroup_id (req): string — Parent ad group ID (required)
- ad_name (req): string — Ad name (required)
- ad_format: string [SINGLE_VIDEO|SINGLE_IMAGE|CAROUSEL_ADS|CAROUSEL] — Ad format. SINGLE_VIDEO (default) for video ads, SINGLE_IMAGE for single image ads, CAROUS
- ad_text (req): string — Ad text/description (required)
- landing_page_url: string — Landing page URL
- call_to_action: string — Fixed call to action button (optional). E.g. LEARN_MORE, SHOP_NOW, SIGN_UP, DOWNLOAD. Mutu
- call_to_action_id: string — Dynamic CTA id (optional). Mutually exclusive with call_to_action.
- utm_params: array<object> — UTM params for the landing URL (the "URL Auto-attach" feature), as a list of { key, value 
- deeplink_utm_params: array<object> — UTM params for the deeplink, as a list of { key, value } objects.
- status: string [ENABLE|PAUSED] — Initial ad status (optional). ENABLE (default) makes the ad live and submits it to review 
- dark_post_status: string [ON|OFF] — Optional. Set to "ON" when running uploaded image/video creatives on a BC_AUTH_TT identity
- video_id: string — Video ID from upload_tiktok_video (required for SINGLE_VIDEO). Must be an Ads API video ID
- image_ids: array<string> — Array of image IDs from upload_tiktok_image. Required for SINGLE_IMAGE and CAROUSEL (2–10 
- identity_id (req): string — Identity ID from get_tiktok_identities (required). This IS the account/"ad persona" the ad
- identity_type (req): string [TT_USER|BC_AUTH_TT|AUTH_CODE|CUSTOMIZED_USER] — Identity type from get_tiktok_identities (required). TT_USER / AUTH_CODE = Spark Ads only 
- identity_bc_id: string — Business Center ID (required when identity_type is BC_AUTH_TT).
- identity_authorized_bc_id: string — The identity ID of a TikTok account that a Business Center is authorized to access. Requir
- tiktok_item_id: string — TikTok post ID (Spark Ads). REQUIRED when identity_type is TT_USER or AUTH_CODE. For BC_AU

## create_tiktok_adgroup
Create a new TikTok Ads ad group (equivalent to Meta Ads "Ad Set").

Creates an ad group with targeting, budget, bid settings, and schedule.

Setup:
- targeting with location_ids is REQUIRED. Use get_tiktok_targeting_regions first to look u
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_id (req): string — Parent campaign ID (required)
- adgroup_name (req): string — Ad group name (required)
- promotion_type: string [WEBSITE|APP_ANDROID|APP_IOS|LEAD_GENERATION] — Promotion destination (optional, default: WEBSITE). Use APP_ANDROID or APP_IOS for app cam
- promotion_target_type: string — Promotion target type (optional). Required when promotion_type=LEAD_GENERATION. EXTERNAL_W
- placement_type: string [PLACEMENT_TYPE_AUTOMATIC|PLACEMENT_TYPE_NORMAL] — Placement type (optional, default: PLACEMENT_TYPE_AUTOMATIC). PLACEMENT_TYPE_NORMAL requir
- placements: array<string> — Explicit placement list. Required when placement_type=PLACEMENT_TYPE_NORMAL (otherwise Tik
- budget_mode: string [BUDGET_MODE_DAY|BUDGET_MODE_TOTAL|BUDGET_MODE_INFINITE] — Budget mode (optional)
- budget: number — Budget amount in account currency
- optimization_goal (req): string [CONVERT|CLICK|REACH|SHOW|VIDEO_VIEW|LEAD_GENERATION|ENGAGED_VIEW] — Optimization goal (required)
- optimization_event: string — Conversion event name to optimize for. Required when optimization_goal=CONVERT — TikTok re
- bid_type: string [BID_TYPE_NO_BID|BID_TYPE_CUSTOM] — Bid type (optional)
- bid_price: number — Bid price (required if bid_type is BID_TYPE_CUSTOM, except for CONVERT + billing_event=OCP
- conversion_bid_price: number — Cost per conversion bid. Required (instead of bid_price) when optimization_goal=CONVERT + 
- delivery_mode: string [STANDARD|ACCELERATED] — Delivery pacing (optional). The handler auto-defaults STANDARD pacing when bid_type=BID_TY
- bid_display_mode: string [CPV|CPMV] — Bid display mode. Required for VIDEO_VIEWS campaigns with BID_TYPE_CUSTOM — must be CPV. T
- billing_event: string [CPC|CPM|OCPM|CPV] — Billing event (optional, defaults to OCPM or CPC based on optimization_goal)
- schedule_start_time (req): string — Start time in "YYYY-MM-DD HH:MM:SS" format in the advertiser's timezone (required). Must b
- schedule_end_time: string — End time in "YYYY-MM-DD HH:MM:SS" format in the advertiser's timezone (optional)
- targeting (req): object — Targeting specification (required). Must contain location_ids from get_tiktok_targeting_re

## create_tiktok_campaign
Create a new TikTok Ads campaign via /campaign/create/.

Choosing fields by goal:
  - Android app install: objective_type=APP_PROMOTION, app_promotion_type=APP_INSTALL, app_id=<your android app id>. Do NOT set campaign_type — leave it out s
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_name (req): string — Campaign name (required)
- objective_type (req): string [APP_PROMOTION|WEB_CONVERSIONS|PRODUCT_SALES|SHOP_PURCHASES|TRAFFIC|REACH|RF_REACH|VIDEO_VIEWS|…] — Campaign objective (required). Each value below was confirmed 2026-05-07 to actually creat
- budget_mode: string [BUDGET_MODE_DAY|BUDGET_MODE_TOTAL|BUDGET_MODE_INFINITE|BUDGET_MODE_DYNAMIC_DAILY_BUDGET] — Budget mode (optional, default: BUDGET_MODE_INFINITE). Enum verified live 2026-05-07.
- budget: number — Budget amount in account currency
- budget_optimize_on: boolean — Enable Campaign Budget Optimization (CBO). When true, the budget you set here is managed a
- app_promotion_type: string [APP_INSTALL|APP_RETARGETING|APP_PREREGISTRATION|PAID_CONTENT] — Required when objective_type=APP_PROMOTION. Each value below was confirmed 2026-05-07 to c
- campaign_type: string [REGULAR_CAMPAIGN|IOS14_CAMPAIGN] — Optional. REGULAR_CAMPAIGN (default if omitted; use for Android and non-iOS14 campaigns) o
- app_id: string — Promoted app ID for app-install/retargeting campaigns. Look up via /app/list/. Required wh
- pixel_id: string — TikTok Pixel ID for web/conversion campaigns. Look up via /pixel/list/. Requires optimizat
- optimization_event: string — Conversion event for the campaign. Required when pixel_id is set.
- ios14_quota_type: string [OCCUPIED|UNOCCUPIED] — Legacy iOS 14 quota toggle. Prefer campaign_type=IOS14_CAMPAIGN. OCCUPIED = iOS 14 dedicat
- special_industries: array<string> — Special industries (optional)

## create_tiktok_catalog
Create a new product catalog for TikTok Shopping / Dynamic Product Ads. Requires Business Center ID.

If this call fails or behaves unexpectedly, report it via the submit_feedback tool with details.
- bc_id (req): string — Business Center ID (required)
- name (req): string — Catalog name (required)
- catalog_type (req): string [PRODUCT_CATALOG|HOTEL_CATALOG|FLIGHT_CATALOG|VEHICLE_CATALOG] — Catalog type (required)
- currency: string — Default currency code (e.g. USD, BRL)
- country: string — Primary country code (e.g. US, BR)

## create_tiktok_creatives_from_dropbox_folder
Bulk-upload the images and videos in a Dropbox folder into a TikTok advertiser's asset library.

Use this when the user keeps their creatives in Dropbox and wants them in TikTok without making the
files public first. Lists the folder, then 
- advertiser_id (req): string — TikTok Advertiser ID (required)
- dropbox_folder_path_or_id (req): string — Dropbox folder path ("/Ads/2026") or id ("id:...") whose images/videos are uploaded (requi
- dropbox_connection_id: string — Which Dropbox connection owns the folder. Required only when more than one Dropbox account

## create_tiktok_cta_portfolio
Create a DYNAMIC call-to-action (a "CTA portfolio") and get a call_to_action_id for create_tiktok_ad / update_tiktok_ad.

A dynamic CTA lets TikTok automatically rotate among several call-to-action buttons and optimize delivery toward which
- advertiser_id (req): string — TikTok Advertiser ID (required)
- call_to_actions (req): array<string> — CTA button values for the dynamic set, e.g. ["SHOP_NOW", "LEARN_MORE"]. Min 1; use 2+ for 

## create_tiktok_custom_audience
Create a rule-based custom audience from pixel/event data.

Creates an audience based on pixel events (e.g. ViewContent, AddToCart, Purchase)
with configurable retention days and event filters.

Args:
    advertiser_id: TikTok Advertiser ID
- advertiser_id (req): string — TikTok Advertiser ID (required)
- custom_audience_name (req): string — Name for the custom audience (required)
- audience_type: string [APP|BUSINESS_ACCOUNT|ENGAGEMENT|ENGAGEMENT_LIVE_VIDEO|ENGAGEMENT_ORGANIC_VIDEO|LEAD_GENERATION|OFFLINE|PIXEL|…] — Audience type. Default: PIXEL. Options: APP, BUSINESS_ACCOUNT, ENGAGEMENT, ENGAGEMENT_LIVE
- rule_spec (req): object — Rule specification with inclusion_rule_set (required) and optional exclusion_rule_set. Eac
- retention_in_days: integer — Number of days to retain the audience (1-365). Optional.
- is_auto_refresh: boolean — Whether to enable auto-refresh. Default: true. Optional.

## create_tiktok_identity
DEPRECATED: TikTok no longer supports custom identities (CUSTOMIZED_USER) for ad creation as of 2026. Ads created with custom identities will be rejected.

Instead, use get_tiktok_identities to find a TT_USER (linked TikTok account) or BC_A
- advertiser_id (req): string — TikTok Advertiser ID (required)
- display_name: string — Display name for the identity
- image_uri: string — URI of the avatar image

## create_tiktok_lookalike_audience
Create a lookalike audience from a seed custom audience.

Finds users similar to an existing audience. Requires a source audience
and location targeting. Use get_tiktok_targeting_regions for location IDs.

Args:
    advertiser_id: TikTok Ad
- advertiser_id (req): string — TikTok Advertiser ID (required)
- custom_audience_name (req): string — Name for the lookalike audience (required)
- source_audience_id (req): string — ID of the seed custom audience (required)
- lookalike_spec (req): object — Lookalike config with location_ids (array) and lookalike_type (REACH, BALANCE, or SIMILARI

## create_tiktok_pixel
Create a new TikTok Pixel for web conversion tracking.

Returns the numeric pixel_id (used in API calls like create_tiktok_adgroup) and the alphanumeric pixel_code (shown in TikTok Ads Manager and used to install the base code on the websit
- advertiser_id (req): string — TikTok Advertiser ID (required)
- pixel_name (req): string — Display name for the pixel (required)
- pixel_category: string — Optional pixel category/mode. Omit to use the TikTok default.
- partner_name: string — Optional partner/integration name.

## create_tiktok_pixel_event
Define one or more conversion events on a TikTok Pixel.

Each entry in pixel_events describes an event to track (e.g. a Purchase or Lead). TikTok assigns an event_id you can later pass to update_tiktok_pixel_event / delete_tiktok_pixel_even
- advertiser_id (req): string — TikTok Advertiser ID (required)
- pixel_id (req): string — Numeric pixel ID to attach the event(s) to (required). From list_tiktok_pixels.
- pixel_events (req): array<object> — Non-empty array of event definitions. Each object may include event_name, event_type, even

## create_tiktok_report_task
Create an asynchronous report task. Use check_tiktok_report_task to poll status and get download URL.

IMPORTANT — dimensions are ID-based only. Do NOT use name fields (campaign_name, adgroup_name, ad_name).

Available dimensions per data_l
- advertiser_id (req): string — TikTok Advertiser ID (required)
- report_type: string [BASIC|AUDIENCE] — BASIC or AUDIENCE (default: BASIC)
- data_level (req): string [AUCTION_CAMPAIGN|AUCTION_ADGROUP|AUCTION_AD|AUCTION_ADVERTISER] — Data aggregation level (required)
- dimensions: array<string> — Only ID and time fields: campaign_id, adgroup_id, ad_id, stat_time_day, stat_time_hour. Do
- metrics: array<string> — Common: spend, impressions, clicks, ctr, cpc, cpm, conversion, cost_per_conversion, reach,
- start_date: string — Start date YYYY-MM-DD. Max 30 days span with stat_time_day.
- end_date: string — End date YYYY-MM-DD. Max 30 days span with stat_time_day.
- filtering: object — Optional filtering criteria. E.g.: {"campaign_ids": ["123"]} — automatically converted to 

## create_tiktok_smart_plus_ad
Create a Smart+ ad (asset group) via /smart_plus/ad/create/. Each Smart+ ad can hold up to 50 creatives, multiple landing pages, CTAs, deeplinks, pages and ad texts.

creative_list is an array of { creative_info: { ad_format, video_info?, i
- advertiser_id (req): string — TikTok Advertiser ID (required)
- adgroup_id (req): string — Smart+ parent adgroup ID (required)
- ad_name (req): string — Ad / asset group name (required)
- creative_list (req): array<object> — Array of creative entries (required, at least 1, max 50)
- landing_page_url_list: array<object> — Optional multi-URL list
- call_to_action_list: array<object> — Optional fixed-CTA list. Each item is { call_to_action: "<UPPERCASE_LABEL>" } — e.g. SHOP_
- deeplink_list: array<object> — Optional deeplinks
- page_list: array<object> — Optional page list
- ad_text_list: array<object> — Optional ad text variants
- auto_message_list: array<object> — Optional auto-message list
- interactive_add_on_list: array<object> — Optional interactive add-ons
- ad_configuration: object — Optional ad configuration for utm_params, tracking_info, phone_info. Do NOT place identity
- operation_status: string [ENABLE|DISABLE] — Initial status (optional, default ENABLE)

## create_tiktok_smart_plus_adgroup
Create a Smart+ adgroup via /smart_plus/adgroup/create/. Parent must be a Smart+ campaign created via create_tiktok_smart_plus_campaign.

CAVEAT: Do NOT set targeting_spec.smart_audience_enabled or targeting_spec.smart_interest_behavior_ena
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_id (req): string — Smart+ parent campaign ID (required)
- adgroup_name (req): string — Adgroup name (required)
- promotion_type (req): string [AEO_APK|APP_ANDROID|APP_IOS|LEAD_GENERATION|LEAD_GEN_CLICK_TO_CALL|LEAD_GEN_CLICK_TO_SOCIAL_MEDIA_APP_MESSAGE|LEAD_GEN_CLICK_TO_TT_DIRECT_MESSAGE|LIVE_SHOPPING|…] — Promotion type (required)
- targeting_spec (req): object — Targeting object (required). Include at minimum location_ids. Do NOT set smart_audience_en
- schedule_type (req): string [SCHEDULE_START_END|SCHEDULE_FROM_NOW] — Schedule type (required). SCHEDULE_START_END or SCHEDULE_FROM_NOW
- schedule_start_time (req): string — Start time "YYYY-MM-DD HH:MM:SS" (required)
- schedule_end_time: string — End time "YYYY-MM-DD HH:MM:SS" — required when parent campaign uses BUDGET_MODE_TOTAL
- optimization_goal (req): string [ANCHOR_CLICK|ANCHOR_CLICK_PURCHASE|AUTOMATED_VALUE|CLICK|CONSIDERATION_AUDIENCE_ACQUISITION|CONVERSATION|CONVERSION_LEADS|CONVERT|…] — Optimization goal (required)
- billing_event (req): string — Billing event (required), e.g. OCPM, CPC
- bid_type: string — Bid type (optional), e.g. BID_TYPE_CUSTOM
- bid_price: number — Bid price (optional)
- conversion_bid_price: number — Cost-per-conversion bid (required when bid_type=BID_TYPE_CUSTOM)
- roas_bid: number — ROAS bid target (optional)
- deep_bid_type: string — Deep bid type (optional)
- deep_cpabid: number — Deep CPA bid (optional)
- deep_funnel_event_source: string — Optional deep funnel source
- deep_funnel_event_source_id: string — Optional deep funnel source ID
- deep_funnel_optimization_event: string — Optional deep funnel event
- deep_funnel_optimization_status: string — Optional deep funnel status
- attribution_event_count: string — Optional, e.g. ONCE / EVERY
- click_attribution_window: string — Optional click attribution window
- view_attribution_window: string — Optional view attribution window
- engaged_view_attribution_window: string — Optional engaged view window
- vbo_window: string — Optional VBO window
- dayparting: string — Optional 336-char dayparting string
- placement_type: string — PLACEMENT_TYPE_AUTOMATIC or PLACEMENT_TYPE_NORMAL
- placements: array<string> — Optional placements array when placement_type=PLACEMENT_TYPE_NORMAL
- pixel_id: string — Optional pixel ID
- optimization_event: string — Optional optimization event
- custom_conversion_id: string — Optional custom conversion ID
- catalog_id: string — Optional catalog ID
- catalog_authorized_bc_id: string — Optional BC ID for catalog
- identity_id: string — Optional identity ID
- identity_type: string — Optional identity type
- identity_authorized_bc_id: string — Optional BC ID for identity
- app_id: string — TikTok app ID (when promotion_type is APP_*)
- messaging_app_type: string — Optional messaging app type
- messaging_app_account_id: string — Optional messaging app account
- message_event_set_id: string — Optional messaging event set ID
- phone_info: object — Optional phone info (for click-to-call)
- product_source: string — Optional product source
- promotion_target_type: string — Optional promotion target type
- promotion_website_type: string — Optional promotion website type
- budget_mode: string — Adgroup budget mode (optional)
- budget: number — Adgroup budget (optional)
- min_budget: number — Minimum budget (optional)
- comment_disabled: boolean — Disable comments on the ad (optional)
- share_disabled: boolean — Disable sharing (optional)
- video_download_disabled: boolean — Disable video download (optional)
- suggestion_audience_enabled: boolean — Optional
- targeting_optimization_mode: string — AUTOMATIC (Smart+ default) or DISABLED
- movie_premiere_date: string — Optional for movie premiere ads
- zalo_id_type: string — Optional Zalo type
- operation_status: string [ENABLE|DISABLE] — Initial status (optional, default ENABLE)
- open_api_partner: string — Optional partner attribution
- request_id: string — Numeric string (int64-parseable). Handler defaults to Date.now().toString().

## create_tiktok_smart_plus_campaign
Create an Upgraded Smart+ campaign via /smart_plus/campaign/create/.

Smart+ is TikTok's AI-driven campaign type. You provide KPIs + creatives and TikTok automates targeting, bidding, budget allocation, creative selection and placements.

E
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_name (req): string — Campaign name (required)
- objective_type (req): string [APP_PROMOTION|BRAND_CONSIDERATION|ENGAGEMENT|LEAD_GENERATION|REACH|TRAFFIC|VIDEO_VIEWS|WEB_CONVERSIONS] — Smart+ campaign objective (required)
- request_id: string — Numeric string parseable as int64 (optional — handler defaults to Date.now().toString()). 
- budget_mode: string [BUDGET_MODE_DAY|BUDGET_MODE_TOTAL|BUDGET_MODE_INFINITE] — Budget mode. BUDGET_MODE_TOTAL is the most reliable for a regular Smart+ campaign. Use BUD
- budget: number — Budget amount (required when budget_mode is set)
- app_promotion_type: string [APP_INSTALL|APP_RETARGETING] — Required when objective_type=APP_PROMOTION
- app_id: string — TikTok app ID (required for APP_PROMOTION)
- sales_destination: string [WEBSITE|APP] — Required when objective_type=WEB_CONVERSIONS
- catalog_enabled: boolean — Set true when sales_destination=APP
- catalog_type: string — Catalog type (optional)
- is_advanced_dedicated_campaign: boolean — Marks the campaign as an iOS 14 / SKAN dedicated campaign (campaign_type IOS14_CAMPAIGN). 
- is_promotional_campaign: boolean — Optional
- disable_skan_campaign: boolean — Optional (iOS SKAN)
- postback_window_mode: string — Optional (SKAN postback window)
- po_number: string — Optional PO number
- special_industries: array<string> — Optional special industries
- open_api_partner: string — Optional partner attribution
- campaign_type: string — Optional campaign type
- bid_align_type: string — Optional bid alignment
- budget_optimize_on: boolean — Optional — TikTok auto-sets this to true on Smart+
- campaign_app_profile_page_state: string — Optional
- operation_status: string [ENABLE|DISABLE] — Initial status (optional, default ENABLE)

## delete_tiktok_catalog_products
Delete products from a catalog in bulk.

If this call fails or behaves unexpectedly, report it via the submit_feedback tool with details.
- bc_id (req): string — Business Center ID (required)
- catalog_id (req): string — Catalog ID (required)
- product_ids (req): array<string> — Array of product IDs to delete (required)

## delete_tiktok_custom_audiences
Delete one or more custom audiences. This action is irreversible.

Args:
    advertiser_id: TikTok Advertiser ID (required)
    custom_audience_ids: Array of audience IDs to delete (required, 1-100)

Returns:
    JSON confirming deletion

E
- advertiser_id (req): string — TikTok Advertiser ID (required)
- custom_audience_ids (req): array<string> — Array of custom audience IDs to delete (required, 1-100)

## delete_tiktok_pixel_event
Delete a single pixel conversion event.

Get the event_id from create_tiktok_pixel_event or the pixel's event list. Any ad group optimizing on this event will stop optimizing for it, so reassign those ad groups' optimization_event afterward
- advertiser_id (req): string — TikTok Advertiser ID (required)
- event_id (req): string — ID of the event to delete (required)

## get_tiktok_adgroups
Get ad groups for a TikTok Ads advertiser account.

Returns ad group details including targeting (location_ids, age_groups, gender,
interest_category_ids, audience_ids, etc.), pixel_id, optimization_event, budget,
bid settings, deep funnel 
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_ids: array<string> — Filter by campaign IDs (optional)
- page: number — Page number for pagination (default: 1)
- page_size: number — Results per page (default: 20, max: 1000)

## get_tiktok_ads
Get ads for a TikTok Ads advertiser account.

Returns ad details including format, text, call to action + call_to_action_id, landing page,
UTM tracking params (utm_params, deeplink_utm_params — each a list of { key, value }),
creative ids (
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_ids: array<string> — Filter by campaign IDs (optional)
- adgroup_ids: array<string> — Filter by ad group IDs (optional)
- page: number — Page number for pagination (default: 1)
- page_size: number — Results per page (default: 20, max: 1000)

## get_tiktok_advertiser_info
Get detailed information about a TikTok Ads advertiser account.

Returns account details including name, currency, timezone, status, and balance.

Args:
    advertiser_id: TikTok Advertiser ID (required)

Returns:
    JSON response with adv
- advertiser_id (req): string — TikTok Advertiser ID (required)

## get_tiktok_campaigns
Get campaigns for a TikTok Ads advertiser account.

Returns campaign details including ID, name, campaign_type, objective, budget, and status.

This endpoint returns auction-mode campaigns. TikTok Shop GMV Max campaigns (PRODUCT_GMV_MAX, LI
- advertiser_id (req): string — TikTok Advertiser ID (required)
- status: string [CAMPAIGN_STATUS_ENABLE|CAMPAIGN_STATUS_DISABLE|CAMPAIGN_STATUS_DELETE] — Filter by campaign status (optional)
- campaign_type: string [REGULAR_CAMPAIGN|IOS14_CAMPAIGN] — Filter by campaign type (optional). TikTok rejects PRODUCT_GMV_MAX/LIVE_GMV_MAX on this en
- page: number — Page number for pagination (default: 1)
- page_size: number — Results per page (default: 20, max: 1000)

## get_tiktok_catalog_feeds
List feeds for a catalog, or get a specific feed.
- bc_id (req): string — Business Center ID (required)
- catalog_id (req): string — Catalog ID (required)
- feed_id: string — Specific feed ID (optional)

## get_tiktok_catalog_overview
Get product audit status overview — approved, disapproved, pending counts.
- bc_id (req): string — Business Center ID (required)
- catalog_id (req): string — Catalog ID (required)

## get_tiktok_catalogs
List all catalogs or get a specific catalog for a Business Center.
- bc_id (req): string — Business Center ID (required)
- catalog_id: string — Specific catalog ID (optional)
- page: number — Page number (default: 1)
- page_size: number — Items per page (default: 10)

## get_tiktok_cta_portfolio
Inspect a dynamic CTA (CTA portfolio) by id — returns the call-to-action buttons it contains. Use it to see what a call_to_action_id on an ad (from get_tiktok_ads) actually points to, or to verify a portfolio made with create_tiktok_cta_por
- advertiser_id (req): string — TikTok Advertiser ID (required)
- creative_portfolio_id (req): string — CTA portfolio id (== an ad's call_to_action_id) (required)

## get_tiktok_gmv_max_campaign_info
Fetch details for a single TikTok Shop GMV Max campaign.

GMV Max campaigns (PRODUCT_GMV_MAX, LIVE_GMV_MAX) are auto-optimized TikTok Shop campaigns. The standard /campaign/get/ endpoint returns basic fields; this tool calls /campaign/gmv_m
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_id (req): string — GMV Max campaign ID (required)

## get_tiktok_gmv_max_insights
Get performance metrics for TikTok Shop GMV Max campaigns.

Calls /gmv_max/report/get/ — a separate reporting endpoint from /report/integrated/get/. Use this for any GMV Max performance question; the regular get_tiktok_insights tool will NO
- advertiser_id (req): string — TikTok Advertiser ID (required)
- store_ids (req): array<string> — Array of TikTok Shop store IDs (required)
- start_date (req): string — Start date in YYYY-MM-DD format (required)
- end_date (req): string — End date in YYYY-MM-DD format (required)
- dimensions: array<string> — Breakdown dimensions (optional). Default: ["campaign_id", "stat_time_day"]. Common values:
- metrics: array<string> — Metrics to include (optional). Default: ["cost","gross_revenue","roi"]. The /gmv_max/repor
- filtering: object — Filtering criteria (optional). E.g. {"campaign_ids": ["123"]} — auto-converted to TikTok a
- enable_total_metrics: boolean — Whether to include aggregate totals (optional, default: false)
- sort_field: string — Field to sort results by (optional)
- sort_type: string [ASC|DESC] — Sort direction (optional, default: DESC)
- page: number — Page number (optional, default: 1)
- page_size: number — Results per page (optional, default: 10)

## get_tiktok_hashtag_info
Get details for specific TikTok hashtags by their IDs (the inverse of search_tiktok_hashtags).

Use this to inspect the interest_keyword_ids you read back from get_tiktok_adgroups and learn what each ID actually targets (name and stats).

A
- advertiser_id (req): string — TikTok Advertiser ID (required)
- hashtag_ids (req): array<string> — Hashtag IDs to look up (required). Same IDs used in targeting.interest_keyword_ids.

## get_tiktok_identities
List available identities for a TikTok Ads advertiser account. You MUST call this before create_tiktok_ad to get valid identity_id and identity_type values.

Returns identities that can be used with create_tiktok_ad. The identity_id and ide
- advertiser_id (req): string — TikTok Advertiser ID (required)
- identity_type: string [TT_USER|AUTH_CODE|BC_AUTH_TT|CUSTOMIZED_USER] — Filter by identity type (optional)

## get_tiktok_identity_videos
List TikTok posts (videos) owned by a TT_USER/AUTH_CODE/BC_AUTH_TT identity — required for Spark Ads creation.

Spark Ads promote an existing TikTok post from a linked account. To create a Spark Ad with create_tiktok_ad using identity_type 
- advertiser_id (req): string — TikTok Advertiser ID (required)
- identity_id (req): string — Identity ID from get_tiktok_identities
- identity_type (req): string [TT_USER|AUTH_CODE|BC_AUTH_TT] — Identity type (TT_USER preferred)
- identity_authorized_bc_id: string — Business Center ID (required when identity_type is BC_AUTH_TT)

## get_tiktok_image_info
Get information about images in the TikTok Ads asset library (the image counterpart to get_tiktok_video_info).

Use this to discover image_id values that already exist for an advertiser so you can reuse them in create_tiktok_ad image_ids (S
- advertiser_id (req): string — TikTok Advertiser ID (required)
- image_ids: array<string> — Specific image IDs to look up (optional)
- material_ids: array<string> — Material IDs to filter by (optional)
- page: integer — Page number (optional, default: 1)
- page_size: integer — Results per page (optional, default: 20, max: 100)

## get_tiktok_insights
Get performance insights/reports for TikTok Ads.

Returns metrics like spend, impressions, clicks, CTR, CPC, conversion, etc.
Supports breakdowns by campaign, ad group, or ad level with date range filtering.

IMPORTANT — dimensions are ID-b
- advertiser_id (req): string — TikTok Advertiser ID (required)
- data_level (req): string [AUCTION_ADVERTISER|AUCTION_CAMPAIGN|AUCTION_ADGROUP|AUCTION_AD] — Aggregation level (required)
- start_date (req): string — Start date in YYYY-MM-DD format (required)
- end_date (req): string — End date in YYYY-MM-DD format (required)
- report_type: string [BASIC|AUDIENCE|PLAYABLE|CATALOG] — Report type (optional, default: BASIC)
- dimensions: array<string> — Dimensions for breakdown (optional). Only ID and time fields are valid: campaign_id, adgro
- metrics: array<string> — Metrics to include (optional). Common: spend, impressions, clicks, ctr, cpc, cpm, conversi
- filters: object — Filtering criteria (optional). E.g.: {"campaign_ids": ["123"]} — automatically converted t
- page: number — Page number (optional, default: 1)
- page_size: number — Results per page (optional, default: 100)

## get_tiktok_integrated_report
Run a synchronous report via the TikTok Reporting API. Returns aggregated metrics at the specified data level.

IMPORTANT — dimensions are ID-based only. Do NOT use name fields (campaign_name, adgroup_name, ad_name).

Available dimensions p
- advertiser_id (req): string — TikTok Advertiser ID (required)
- report_type: string [BASIC|AUDIENCE] — BASIC or AUDIENCE (default: BASIC)
- data_level (req): string [AUCTION_CAMPAIGN|AUCTION_ADGROUP|AUCTION_AD|AUCTION_ADVERTISER] — Data aggregation level (required)
- dimensions: array<string> — Only ID and time fields: campaign_id, adgroup_id, ad_id, stat_time_day, stat_time_hour. Do
- metrics: array<string> — Common: spend, impressions, clicks, ctr, cpc, cpm, conversion, cost_per_conversion, reach,
- start_date: string — Start date YYYY-MM-DD. Max 30 days span with stat_time_day.
- end_date: string — End date YYYY-MM-DD. Max 30 days span with stat_time_day.
- filtering: object — Optional filtering criteria. E.g.: {"campaign_ids": ["123"]} — automatically converted to 
- page: number — Page number (default: 1)
- page_size: number — Results per page (default: 20)

## get_tiktok_interest_categories
Get available interest categories for TikTok Ads targeting.

Returns interest category IDs that can be used in create_tiktok_adgroup's targeting parameter as interest_category_ids.
Categories are hierarchical (level 1 = broad, level 2+ = mo
- advertiser_id (req): string — TikTok Advertiser ID (required)
- language: string — Response language (optional, default: "en"). E.g.: "pt", "es", "zh"

## get_tiktok_pixel_event_stats
Get pixel-side event counts. Use this when get_tiktok_insights rejects a metric with "Invalid metric fields" (e.g. Lead, Download, certain Contact variants) — these counts reconcile to the numbers shown in the Ads Manager UI.

Call list_tik
- advertiser_id (req): string — TikTok Advertiser ID (required)
- pixel_ids (req): array<string> — Array of pixel IDs to query (required). Get these via list_tiktok_pixels.
- start_date (req): string — Start date YYYY-MM-DD (required). Range max 30 days inclusive.
- end_date (req): string — End date YYYY-MM-DD (required). Range max 30 days inclusive.

## get_tiktok_smart_plus_adgroups
Get Smart+ adgroups via /smart_plus/adgroup/get/.

Args:
    advertiser_id: TikTok Advertiser ID (required)
    fields: Optional array of fields to return
    filtering: Optional filter, e.g. {"adgroup_ids": ["123"]} or {"campaign_ids": ["4
- advertiser_id (req): string — TikTok Advertiser ID (required)
- fields: array<string> — Optional fields
- filtering: object — Optional filter
- page: number — Page number (default 1)
- page_size: number — Results per page (default 20)

## get_tiktok_smart_plus_ads
Get Smart+ ads (asset groups) via /smart_plus/ad/get/.

Each asset group is keyed by smart_plus_ad_id (the id the TikTok Ads Manager bulk export shows in
its "Ad ID" column and the id update_tiktok_smart_plus_ad requires) and carries the co
- advertiser_id (req): string — TikTok Advertiser ID (required)
- fields: array<string> — Optional fields
- filtering: object — Optional filter
- page: number — Page number (default 1)
- page_size: number — Results per page (default 20, max 100)

## get_tiktok_smart_plus_campaigns
Get Smart+ campaigns for a TikTok Ads advertiser via /smart_plus/campaign/get/.

Returns Smart+ campaign details (campaign_id, campaign_name, objective_type, budget, budget_mode, operation_status, secondary_status, smart_plus_adgroup_mode, 
- advertiser_id (req): string — TikTok Advertiser ID (required)
- fields: array<string> — Fields to return (optional)
- filtering: object — Filter object (optional), e.g. {"campaign_ids": ["123"]}
- page: number — Page number (default 1)
- page_size: number — Results per page (default 20)

## get_tiktok_targeting_regions
Get available targeting regions/locations for TikTok Ads.

Returns location IDs that are REQUIRED when creating ad groups. TikTok does not accept country codes like "BR" — you must use the location_id values returned by this tool.

Use the 
- advertiser_id (req): string — TikTok Advertiser ID (required)
- placements: array<string> — Ad placements to filter regions (optional, default: ["PLACEMENT_TIKTOK"])
- objective_type: string [TRAFFIC|CONVERSIONS|APP_INSTALL|REACH|VIDEO_VIEWS|LEAD_GENERATION|ENGAGEMENT|APP_PROMOTION|…] — Campaign objective (optional, default: TRAFFIC)
- level_range: string [ALL|TO_COUNTRY|TO_PROVINCE|TO_CITY|TO_DISTRICT] — Location granularity (optional)

## get_tiktok_video_info
Get information about videos in the TikTok Ads asset library.

This is the canonical polling target for upload_tiktok_video. After uploading a video, call this
tool with video_ids=[<id>] every ~5 seconds until `displayable: true` (status RE
- advertiser_id (req): string — TikTok Advertiser ID (required)
- video_ids: array<string> — Specific video IDs to look up (optional, max 60)
- material_ids: array<string> — Material IDs to filter by (optional)
- page: integer — Page number (optional, default: 1)
- page_size: integer — Results per page (optional, default: 20, max: 100)

## list_tiktok_advertisers
List all authorized TikTok Ads advertiser accounts.

Returns the list of advertiser IDs that were authorized during the OAuth connection.
Use these advertiser IDs with other TikTok Ads tools.

Returns:
    JSON response with advertiser_ids 
- (sem parâmetros)

## list_tiktok_commercial_music
List tracks from TikTok's Commercial Music Library (and, with the right filter, an advertiser's own uploaded tracks) via /file/music/get/.

Use this to obtain a valid music_id for a Smart+ CAROUSEL_ADS image ad: create_tiktok_smart_plus_ad

- advertiser_id (req): string — TikTok Advertiser ID (required)
- music_scene: string — Optional scene to scope the search (verified live against TikTok). Known values: CAROUSEL_
- search_type: string — Optional search mode (verified live against TikTok). Known values: SEARCH_BY_KEYWORD, SEAR
- filtering: object — Optional filter object passed through to TikTok verbatim; its required shape depends on se
- keyword: string — Optional case-insensitive substring filter applied CLIENT-SIDE over the fetched page (name
- page: integer — Page number (optional, default: 1)
- page_size: integer — Results per page (optional, default: 20, max: 100)

## list_tiktok_custom_audiences
List all custom audiences for a TikTok Ads advertiser.

Returns custom audiences including rule-based, file-based, and lookalike audiences
with their IDs, names, types, sizes, and status.

Args:
    advertiser_id: TikTok Advertiser ID (requ
- advertiser_id (req): string — TikTok Advertiser ID (required)
- page: number — Page number for pagination (default: 1)
- page_size: number — Results per page (default: 20, max: 100)

## list_tiktok_pixels
List TikTok Pixels for an advertiser account.

Returns both pixel_id (numeric, used in API calls like create_tiktok_adgroup) and pixel_code (alphanumeric, shown in TikTok Ads Manager UI).

When creating ad groups with optimization_goal=CONV
- advertiser_id (req): string — TikTok Advertiser ID (required)

## search_tiktok_hashtags
Search TikTok hashtags by name and resolve them to the IDs used in ad group targeting.

Returns hashtag IDs that go into create_tiktok_adgroup / update_tiktok_adgroup's targeting.interest_keyword_ids field. Use this to go from a hashtag/key
- advertiser_id (req): string — TikTok Advertiser ID (required)
- keywords (req): array<string> — Hashtag/keyword names to search for (required, 1-10 values). E.g.: ["fitness"]
- operator: string [AND|OR] — How to combine multiple keywords (optional, default: "OR")

## share_tiktok_custom_audience
Share one or more custom audiences with other advertisers in your Business Center.

Both the owning advertiser_id and each shared_advertiser_id must be part of the
same Business Center. You cannot share an audience to itself.

Args:
    adv
- advertiser_id (req): string — Owning TikTok Advertiser ID (required)
- custom_audience_ids (req): array<string> — IDs of custom audiences to share (required, 1-100)
- shared_advertiser_ids (req): array<string> — Advertiser IDs to share the audiences with (required, 1-100)
- shared_bc_id: string — Optional Business Center ID for cross-BC sharing

## submit_feedback
Report a bug, request a feature, or ask a question about the TikTok Ads MCP tools. We commit to responding within 2 business days via the email address on your account.

Args:
    category (required): "bug" | "feature_request" | "question" 
- category (req): string [bug|feature_request|question|other] — Type of feedback
- message (req): string — Your feedback message
- tool_name: string — Which tool this feedback is about (optional)
- urgency: string [low|medium|high] — How urgent this is (default: medium)
- llm_model: string — Your model name and version (e.g. "Claude Opus 4.6", "ChatGPT 4o")
- feedback_id: string — ID of existing feedback to amend. If provided, updates the existing feedback instead of cr
- notify_emails: array<string> — Additional email addresses to CC when we respond to this feedback, beyond the account emai

## track_tiktok_events
Send server-side conversion events to TikTok via the Events API (CAPI).

Use this to report conversions that happen off the browser (server purchases, CRM events, offline sales) or to send a server-side copy of browser-pixel events for bett
- event_source_id (req): string — Numeric pixel_id for web events (required). From list_tiktok_pixels.
- data (req): array<object> — Non-empty array of event items (event, event_time, event_id, user, page, properties). Raw 
- event_source: string [web|app|offline] — Event source: "web" (default), "app", or "offline".
- partner_name: string — Optional integration/partner name.
- test_event_code: string — Optional. When set, events appear in the Test Events tab and do not affect optimization/re

## update_tiktok_ad
Update an existing TikTok ad's settings.

Updates ad name, text, landing page, creative assets, or CTA. At least one updatable field is required.

Update mode is chosen automatically:
- Fast patch mode for: ad_name, ad_text, image_ids, vide
- advertiser_id (req): string — TikTok Advertiser ID (required)
- ad_id (req): string — Ad ID to update (required)
- adgroup_id: string — Ad group ID (optional — auto-discovered from the ad if omitted)
- ad_name: string — New ad name (optional)
- ad_text: string — New ad text/description (optional)
- landing_page_url: string — New landing page URL (optional)
- call_to_action: string — New FIXED CTA button (optional). E.g. LEARN_MORE, SHOP_NOW, SIGN_UP, DOWNLOAD. Setting thi
- call_to_action_id: string — Set a DYNAMIC CTA by its id (optional). Read the current id from get_tiktok_ads. Setting t
- utm_params: array<object> — UTM params for the landing URL (the "URL Auto-attach" feature), as a list of { key, value 
- deeplink_utm_params: array<object> — UTM params for the deeplink, as a list of { key, value }. Pass [] to CLEAR all; omit to le
- video_id: string — New video ID to replace the current video (optional — upload first using upload_tiktok_vid
- image_ids: array<string> — New image IDs to replace current images (optional — for SINGLE_IMAGE and CAROUSEL ads, upl
- identity_id: string — Re-point the ad to a different displayed account / "ad persona" (optional). This is the ac
- identity_type: string [TT_USER|BC_AUTH_TT|AUTH_CODE] — Identity type for the new identity_id (optional). Pass alongside identity_id. Values: TT_U
- identity_authorized_bc_id: string — Business Center ID authorized for the identity (optional — pass with identity_id when iden

## update_tiktok_ad_status
Enable, disable, or delete TikTok Ads ads.

Updates the status of one or more ads.

Args:
    advertiser_id: TikTok Advertiser ID (required)
    ad_ids: Array of ad IDs to update (required)
    operation_status: New status (required). Value
- advertiser_id (req): string — TikTok Advertiser ID (required)
- ad_ids (req): array<string> — Array of ad IDs to update (required)
- operation_status (req): string [ENABLE|DISABLE|DELETE] — New operation status (required)

## update_tiktok_adgroup
Update an existing TikTok Ads ad group's settings.

Updates ad group name, budget, bid, targeting, schedule, or delivery pacing. At least one updatable field is required.
Note: TikTok "Ad Groups" are equivalent to Meta Ads "Ad Sets".

Immut
- advertiser_id (req): string — TikTok Advertiser ID (required)
- adgroup_id (req): string — Ad group ID to update (required)
- adgroup_name: string — New ad group name (optional)
- budget_mode: string [BUDGET_MODE_DAY|BUDGET_MODE_TOTAL|BUDGET_MODE_INFINITE] — New budget mode (optional)
- budget: number — New budget amount (optional)
- bid_type: string [BID_TYPE_NO_BID|BID_TYPE_CUSTOM] — New bid type (optional)
- bid_price: number — New bid price (optional). For CONVERT + billing_event=OCPM + bid_type=BID_TYPE_CUSTOM, use
- conversion_bid_price: number — New cost per conversion bid (optional). Use this instead of bid_price when optimization_go
- optimization_goal: string [CONVERT|CLICK|REACH|SHOW|VIDEO_VIEW|LEAD_GENERATION|ENGAGED_VIEW] — New optimization goal (optional)
- optimization_event: string — New conversion event name to optimize for (optional). Required when changing optimization_
- billing_event: string [CPC|CPM|OCPM|CPV] — New billing event (optional)
- schedule_start_time: string — New start time in ISO 8601 format (optional)
- schedule_end_time: string — New end time in ISO 8601 format (optional)
- delivery_mode: string [STANDARD|ACCELERATED] — New delivery pacing (optional). Mapped to TikTok pacing field (STANDARD → PACING_MODE_SMOO
- deep_funnel_optimization_status: string [ON|OFF] — Deep funnel optimization status. Required to be re-passed (alongside event_source, event_s
- deep_funnel_event_source: string [PIXEL|APP] — Source for deep funnel events. Required when deep_funnel_optimization_status is ON.
- deep_funnel_event_source_id: string — Pixel ID or App ID matching deep_funnel_event_source. Required when deep_funnel_optimizati
- deep_funnel_optimization_event: string — Event ID to optimize for in the deep funnel (e.g. a TikTok pixel event ID). Required when 
- targeting: object — New targeting specification (optional)

## update_tiktok_adgroup_status
Enable, disable, or delete TikTok Ads ad groups.

Updates the status of one or more ad groups.

Args:
    advertiser_id: TikTok Advertiser ID (required)
    adgroup_ids: Array of ad group IDs to update (required)
    operation_status: New s
- advertiser_id (req): string — TikTok Advertiser ID (required)
- adgroup_ids (req): array<string> — Array of ad group IDs to update (required)
- operation_status (req): string [ENABLE|DISABLE|DELETE] — New operation status (required)

## update_tiktok_campaign
Update an existing auction-mode TikTok Ads campaign's settings.

Updates campaign name, budget, or other settings. At least one updatable field is required.

This calls /campaign/update/ and works on standard auction campaigns only. It does
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_id (req): string — Campaign ID to update (required)
- campaign_name: string — New campaign name (optional)
- budget_mode: string [BUDGET_MODE_DAY|BUDGET_MODE_TOTAL|BUDGET_MODE_INFINITE] — New budget mode (optional)
- budget: number — New budget amount in account currency (optional)
- budget_optimize_on: boolean — Toggle Campaign Budget Optimization (CBO) on/off (optional). When true, budget is managed 
- special_industries: array<string> — Updated special industries (optional)

## update_tiktok_campaign_status
Enable, disable, or delete TikTok Ads campaigns.

Updates the status of one or more campaigns.

Args:
    advertiser_id: TikTok Advertiser ID (required)
    campaign_ids: Array of campaign IDs to update (required)
    operation_status: New 
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_ids (req): array<string> — Array of campaign IDs to update (required)
- operation_status (req): string [ENABLE|DISABLE|DELETE] — New operation status (required)

## update_tiktok_catalog
Update the name of an existing catalog.

If this call fails or behaves unexpectedly, report it via the submit_feedback tool with details.
- bc_id (req): string — Business Center ID (required)
- catalog_id (req): string — Catalog ID to update (required)
- name (req): string — New catalog name (required)

## update_tiktok_custom_audience
Rename an existing custom audience.

Only the audience name can be changed. To change retention or rules, delete and
recreate the audience instead.

Args:
    advertiser_id: TikTok Advertiser ID (required)
    custom_audience_id: ID of the 
- advertiser_id (req): string — TikTok Advertiser ID (required)
- custom_audience_id (req): string — ID of the custom audience to update (required)
- custom_audience_name (req): string — New name for the custom audience (required)

## update_tiktok_gmv_max_campaign
Update an existing TikTok Shop GMV Max campaign (PRODUCT_GMV_MAX, LIVE_GMV_MAX).

GMV Max campaigns are auto-optimized TikTok Shop campaigns and are NOT editable with update_tiktok_campaign — that tool calls /campaign/update/, which only ac
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_id (req): string — GMV Max campaign ID to update (required)
- campaign_name: string — New campaign name (optional)
- budget: number — New daily budget in account currency (optional)
- roas_bid: number — New ROAS target / bid, e.g. 3.5 (optional)
- auto_budget_enabled: boolean — Whether TikTok auto-manages the budget (optional)
- affiliate_posts_enabled: boolean — Whether affiliate posts are eligible for promotion (optional)
- schedule_type: string [SCHEDULE_FROM_NOW|SCHEDULE_START_END] — New schedule type (optional). SCHEDULE_FROM_NOW or SCHEDULE_START_END
- schedule_end_time: string — New end time "YYYY-MM-DD HH:MM:SS" (optional)
- item_group_ids: array<string> — Product (SPU) IDs to promote (optional)
- item_list: array<object> — Product objects to promote — forwarded to TikTok as-is (optional)
- custom_anchor_video_list: array<object> — Custom anchor video bindings — forwarded to TikTok as-is (optional)
- promotion_days: object — Promotion-days configuration object — forwarded to TikTok as-is (optional)

## update_tiktok_pixel
Update an existing TikTok Pixel (rename it or change advanced matching).

Get the numeric pixel_id from list_tiktok_pixels. To add or remove conversion events on the pixel, use create_tiktok_pixel_event / update_tiktok_pixel_event / delete_
- advertiser_id (req): string — TikTok Advertiser ID (required)
- pixel_id (req): string — Numeric pixel ID to update (required). From list_tiktok_pixels.
- pixel_name (req): string — New display name (required). Pass the current name to keep it unchanged while updating oth
- advanced_matching_fields: object — Optional advanced matching configuration object.

## update_tiktok_pixel_event
Update a single pixel conversion event (rename it or change its currency/value).

Get the event_id from create_tiktok_pixel_event or the pixel's event list. Only the fields you pass are changed.

Args:
    advertiser_id: TikTok Advertiser I
- advertiser_id (req): string — TikTok Advertiser ID (required)
- event_id (req): string — ID of the event to update (required)
- event_name: string — New display name (optional)
- currency: string — New currency code, e.g. USD (optional)
- currency_value: string — New default conversion value as a string (optional)

## update_tiktok_smart_plus_ad
Update a Smart+ ad (asset group) via /smart_plus/ad/update/. Pass only the fields to change.

Note: TikTok re-validates the ENTIRE stored ad on every update — even a name-only change — so a
40002 error can reference stored content you did n
- advertiser_id (req): string — TikTok Advertiser ID (required)
- smart_plus_ad_id (req): string — Smart+ ad ID (required)
- ad_name: string — New ad name (optional)
- creative_list: array<object> — Replacement creative list (optional)
- landing_page_url_list: array<object> — Optional
- call_to_action_list: array<object> — Optional
- deeplink_list: array<object> — Optional
- page_list: array<object> — Optional
- ad_text_list: array<object> — Optional
- interactive_add_on_list: array<object> — Optional
- ad_configuration: object — Optional ad configuration

## update_tiktok_smart_plus_ad_material_status
Pause or enable a specific creative inside a Smart+ asset group via /smart_plus/ad/material_status/update/. Useful for retiring a fatigued creative without touching the whole asset group.

If this call fails or behaves unexpectedly, report 
- advertiser_id (req): string — TikTok Advertiser ID (required)
- smart_plus_ad_id (req): string — Smart+ ad ID (required)
- ad_material_ids (req): array<string> — Ad material IDs to update (required). These are the ad_material_id values from the asset g
- operation_status (req): string [ENABLE|DISABLE] — Operation (required)

## update_tiktok_smart_plus_ad_status
Enable, disable or delete Smart+ ads in bulk via /smart_plus/ad/status/update/.

If this call fails or behaves unexpectedly, report it via the submit_feedback tool with details.
- advertiser_id (req): string — TikTok Advertiser ID (required)
- smart_plus_ad_ids (req): array<string> — Smart+ ad IDs (required)
- operation_status (req): string [ENABLE|DISABLE|DELETE] — Operation (required)

## update_tiktok_smart_plus_adgroup
Update a Smart+ adgroup via /smart_plus/adgroup/update/. At least one optional field must be provided.

To CLEAR the Featured Product (so it stops carrying over to every new ad created in the ad group), pass product_info: null.

If this cal
- advertiser_id (req): string — TikTok Advertiser ID (required)
- adgroup_id (req): string — Smart+ adgroup ID (required)
- adgroup_name: string — New adgroup name (optional)
- bid_price: number — New bid price (optional)
- budget: number — New budget (optional)
- conversion_bid_price: number — New conversion bid (optional)
- min_budget: number — New minimum budget (optional)
- roas_bid: number — New ROAS bid (optional)
- pacing: string — New pacing mode (optional)
- schedule_type: string — New schedule type (optional)
- schedule_start_time: string — New start time (optional)
- schedule_end_time: string — New end time (optional)
- dayparting: string — New dayparting string (optional)
- comment_disabled: boolean — Toggle comments (optional)
- share_disabled: boolean — Toggle sharing (optional)
- suggestion_audience_enabled: boolean — Optional
- targeting_optimization_mode: string — Optional
- targeting_spec: object — Replacement targeting spec (optional)
- movie_premiere_date: string — Optional
- product_info: object,null — Featured Product configuration for the Smart+ ad group. Pass null to CLEAR/remove an exist

## update_tiktok_smart_plus_adgroup_status
Enable, disable or delete Smart+ adgroups in bulk via /smart_plus/adgroup/status/update/.

If this call fails or behaves unexpectedly, report it via the submit_feedback tool with details.
- advertiser_id (req): string — TikTok Advertiser ID (required)
- adgroup_ids (req): array<string> — Smart+ adgroup IDs (required)
- operation_status (req): string [ENABLE|DISABLE|DELETE] — Operation (required)

## update_tiktok_smart_plus_campaign
Update a Smart+ campaign via /smart_plus/campaign/update/. Smart+ updates are limited to a small set of fields (name, budget, PO number).

Args:
    advertiser_id: TikTok Advertiser ID (required)
    campaign_id: Smart+ campaign ID to updat
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_id (req): string — Smart+ campaign ID (required)
- campaign_name: string — New campaign name (optional)
- budget: number — New budget amount (optional)
- po_number: string — New PO number (optional)

## update_tiktok_smart_plus_campaign_status
Enable, disable or delete one or more Smart+ campaigns via /smart_plus/campaign/status/update/.

Args:
    advertiser_id: TikTok Advertiser ID (required)
    campaign_ids: Array of Smart+ campaign IDs (required)
    operation_status: ENABLE
- advertiser_id (req): string — TikTok Advertiser ID (required)
- campaign_ids (req): array<string> — Smart+ campaign IDs (required)
- operation_status (req): string [ENABLE|DISABLE|DELETE] — Operation to perform (required)
- postback_window_mode: string — Optional SKAN postback window mode

## upload_tiktok_catalog_products
Upload products to a catalog via a publicly accessible file URL (CSV or XML).

If this call fails or behaves unexpectedly, report it via the submit_feedback tool with details.
- bc_id (req): string — Business Center ID (required)
- catalog_id (req): string — Catalog ID (required)
- file_url (req): string — Public URL of the product file (required)
- file_format: string [CSV|XML] — File format (default: CSV)

## upload_tiktok_customer_file_audience
Create a CUSTOMER_FILE custom audience from a pre-hashed customer list.

Performs the two-step TikTok flow in one call:
  1. POST /dmp/custom_audience/file/upload/ — uploads the file as multipart/form-data
  2. POST /dmp/custom_audience/cre
- advertiser_id (req): string — TikTok Advertiser ID (required)
- custom_audience_name (req): string — Name for the custom audience (required on CREATE)
- file_url: string — URL of a CSV file containing pre-hashed identifiers. Mutually exclusive with file_content.
- file_content: string — Inline CSV content with pre-hashed identifiers. Mutually exclusive with file_url.
- file_name: string — Optional filename for the upload (default "audience.csv")
- calculate_type (req): string [EMAIL_SHA256|PHONE_SHA256|FIRST_SHA256|FIRST_MD5|IDFA_SHA256|IDFA_MD5|GAID_SHA256|GAID_MD5|…] — Identifier type contained in the file (required). E.g. EMAIL_SHA256 for SHA-256 hashed ema
- retention_in_days: integer — Number of days to retain the audience (1-365). Optional.

## upload_tiktok_image
Upload an image to TikTok Ads for use in ad creatives.

Uploads an image by URL. Returns image_id that can be used when creating ads.
Supported formats: jpg, jpeg, png, bmp, gif, webp. Max size: 20MB.

Args:
    advertiser_id: TikTok Advert
- advertiser_id (req): string — TikTok Advertiser ID (required)
- image_url (req): string — Direct URL to the image to upload (required)
- file_name: string — Optional name for the image file

## upload_tiktok_video
Upload a video to TikTok Ads for use in ad creatives.

Uploads a video by URL. Returns video_id, material_id, signature, and a status enum.
TikTok dedupes by content signature (md5) — re-uploading the same content returns the same video_id.
- advertiser_id (req): string — TikTok Advertiser ID (required)
- video_url (req): string — Direct URL to the video to upload (required, must be publicly reachable)
- file_name: string — Optional name for the video file. If omitted, a unique pipeboard-<uuid>.mp4 is generated.
- wait_for_processing_seconds: integer — Server-side wait budget in seconds (default 0, max 120). 0 returns immediately and lets th
