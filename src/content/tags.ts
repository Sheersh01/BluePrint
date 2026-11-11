/**
 * Tags for problems, in three groups:
 *   - domain:  what kind of product it is (one or two per problem)
 *   - topic:   the key technical ideas it exercises (two to four per problem)
 *   - pattern: the reusable patterns (taken from each article's own `tags`, linked to the pattern pages)
 *
 * Domain and topic tags are assigned below in PROBLEM_TAGS. Ids are typed, so a typo fails the build.
 * This module has no article imports, so it is safe to use in client components.
 */
import { navigation } from "./navigation";

export type TagGroup = "domain" | "topic" | "pattern";

export interface Tag {
  id: string;
  label: string;
  group: TagGroup;
  description: string;
}

export const TAG_GROUP_LABEL: Record<TagGroup, string> = {
  domain: "Domain",
  topic: "Topic",
  pattern: "Pattern",
};

const DOMAINS = {
  social: ["Social Media & Content", "Feeds, posts, followers, likes and user-generated content."],
  communication: ["Messaging & Communication", "Chat, calls, live comments and notifications between people."],
  media: ["Media & Streaming", "Video, audio and images delivered to large audiences."],
  commerce: ["E-commerce & Marketplaces", "Catalogs, carts, checkout, inventory and delivery."],
  fintech: ["Payments & Finance", "Moving money correctly: payments, wallets, trading, billing."],
  booking: ["Booking & Reservations", "Reserving limited things — seats, rooms, tables, appointments."],
  location: ["Maps & Location", "Where things are: maps, nearby search, live positions, routing."],
  search: ["Search & Discovery", "Finding things: indexes, ranking, autocomplete, crawling."],
  storage: ["Storage & Databases", "Building the storage systems themselves: caches, file systems, key-value stores."],
  data: ["Data & Analytics", "Collecting, aggregating and querying large volumes of events and metrics."],
  platform: ["Infrastructure & Platform", "Internal platforms other systems run on: schedulers, queues, control planes."],
  devtools: ["Developer Tools", "Tools and libraries developers use directly: CI/CD, code judges, SDKs."],
  ai: ["AI & Machine Learning", "LLM products, ML platforms, recommendations and model serving."],
  gaming: ["Games", "Real-time multiplayer games, matchmaking and leaderboards."],
  ads: ["Advertising", "Ad serving, auctions and click/impression analytics."],
  physical: ["Physical Systems & IoT", "Software that controls or tracks things in the real world."],
  productivity: ["Productivity & Collaboration", "Docs, calendars and tools teams work in together."],
  trust: ["Security & Trust", "Identity, fraud, abuse and integrity."],
  utilities: ["Web Utilities", "Small, focused web services — short links, pastes, settings, weather."],
} as const;

const TOPICS = {
  geospatial: ["Geospatial Indexing", "Finding things near a location: geohashes, quadtrees, R-trees, geo queries."],
  "feed-fanout": ["Feed Fan-out", "Building timelines: fan-out on write vs read, celebrity accounts."],
  caching: ["Caching", "Keeping hot data in memory and keeping it fresh."],
  sharding: ["Sharding & Partitioning", "Splitting data across machines and choosing partition keys."],
  replication: ["Replication & Consensus", "Keeping copies in sync: leaders, quorums, failover."],
  "search-index": ["Search Indexing", "Inverted indexes, full-text and faceted search."],
  "stream-processing": ["Stream Processing", "Processing events continuously as they arrive (Kafka, Flink)."],
  "batch-processing": ["Batch Processing", "Large offline jobs: ETL, MapReduce, model training."],
  "time-series": ["Time-series Data", "Metrics and readings over time: rollups, retention, downsampling."],
  counting: ["Counting & Top-K", "Counters, aggregations and leaderboards at high volume."],
  idempotency: ["Idempotency", "Making retries safe: idempotency keys, de-duplication, exactly-once effects."],
  transactions: ["Transactions & Consistency", "ACID transactions, strong consistency and isolation."],
  ledger: ["Ledgers & Money", "Double-entry bookkeeping, balances and reconciliation."],
  reservations: ["Reservations & Holds", "Temporarily holding limited inventory without overselling."],
  "state-machine": ["State Machines", "Explicit lifecycles with allowed transitions (orders, payments, devices)."],
  scheduling: ["Scheduling", "Running things at the right time: cron, delayed jobs, calendars."],
  "rate-limiting": ["Rate Limiting & Quotas", "Protecting systems and enforcing per-user or per-tenant limits."],
  matching: ["Matching & Allocation", "Pairing supply with demand: riders and drivers, players, orders, resources."],
  presence: ["Presence & Heartbeats", "Knowing who is online or watching right now."],
  notifications: ["Notifications & Alerts", "Delivering alerts by push, email and SMS reliably."],
  "offline-sync": ["Offline & Sync", "Working through disconnections and syncing changes later."],
  crawling: ["Crawling & Ingestion", "Pulling data from many external sources politely and reliably."],
  cdn: ["CDN & Edge Delivery", "Serving content from close to users."],
  "media-processing": ["Media Processing", "Transcoding, thumbnails and adaptive bitrate streaming."],
  "ml-models": ["ML Models & Ranking", "Training, serving and ranking with machine-learning models."],
  "multi-tenancy": ["Multi-tenancy", "Many customers on shared infrastructure: isolation and fairness."],
  "auth-security": ["Auth & Access Control", "Authentication, authorization and permissions."],
  p2p: ["Peer-to-Peer", "Peers exchanging data directly instead of through a central server."],
  collaboration: ["Real-time Collaboration", "Several people editing the same thing at once (OT, CRDTs)."],
  "id-generation": ["Unique ID Generation", "Short codes and globally unique, sortable IDs."],
  "code-execution": ["Code Execution & Sandboxing", "Running untrusted code safely and at scale."],
  ood: ["Object-Oriented Design", "Class design and design patterns — often asked as an LLD round."],
} as const;

export type DomainId = keyof typeof DOMAINS;
export type TopicId = keyof typeof TOPICS;

/** Domain and topic tags for every problem (standard and real-life), keyed by slug. */
export const PROBLEM_TAGS: Record<string, { domains: DomainId[]; topics: TopicId[] }> = {
  "ab-testing": { domains: ["data"], topics: ["stream-processing", "batch-processing", "caching"] },
  "ad-click-aggregator": { domains: ["ads", "data"], topics: ["stream-processing", "counting", "idempotency", "time-series"] },
  "ads-management": { domains: ["ads"], topics: ["ml-models", "caching", "counting"] },
  "ai-model-api": { domains: ["ai", "platform"], topics: ["rate-limiting", "multi-tenancy", "auth-security"] },
  "amazon-pickup-lockers": { domains: ["physical", "commerce"], topics: ["reservations", "state-machine", "geospatial"] },
  "amazon-warehouse": { domains: ["physical", "commerce"], topics: ["reservations", "state-machine", "matching"] },
  "anomaly-detection": { domains: ["data"], topics: ["stream-processing", "time-series", "notifications"] },
  "asset-monitoring-platform": { domains: ["physical", "data"], topics: ["multi-tenancy", "time-series", "geospatial", "offline-sync"] },
  atm: { domains: ["fintech", "physical"], topics: ["ood", "state-machine", "transactions"] },
  "authentication-system": { domains: ["trust"], topics: ["auth-security", "caching"] },
  "autonomous-vehicle-platform": { domains: ["physical", "ai"], topics: ["batch-processing", "ml-models", "offline-sync"] },
  bigtable: { domains: ["storage"], topics: ["sharding", "replication"] },
  bitly: { domains: ["utilities"], topics: ["id-generation", "caching", "sharding"] },
  "blockchain-network": { domains: ["fintech"], topics: ["p2p", "replication", "transactions"] },
  "blogging-platform": { domains: ["social"], topics: ["caching", "cdn", "search-index"] },
  bluesky: { domains: ["social"], topics: ["feed-fanout", "p2p", "sharding"] },
  cdn: { domains: ["platform", "media"], topics: ["cdn", "caching"] },
  chatgpt: { domains: ["ai"], topics: ["ml-models", "rate-limiting", "sharding"] },
  "cloud-data-migration": { domains: ["platform", "storage"], topics: ["batch-processing", "idempotency", "scheduling"] },
  "code-deployment": { domains: ["devtools", "platform"], topics: ["state-machine", "cdn", "scheduling"] },
  "concurrent-stream-limit": { domains: ["media"], topics: ["presence", "reservations", "rate-limiting"] },
  "content-moderation": { domains: ["trust", "ai"], topics: ["ml-models", "stream-processing", "state-machine"] },
  crowdfunding: { domains: ["fintech"], topics: ["transactions", "idempotency", "scheduling"] },
  "data-warehouse": { domains: ["data"], topics: ["batch-processing", "sharding", "stream-processing"] },
  "database-control-plane": { domains: ["platform", "storage"], topics: ["state-machine", "multi-tenancy", "replication"] },
  "dependency-injection": { domains: ["devtools"], topics: ["ood"] },
  "digital-wallet": { domains: ["fintech"], topics: ["ledger", "transactions", "idempotency"] },
  "distributed-cache": { domains: ["storage"], topics: ["caching", "sharding", "replication"] },
  "distributed-file-system": { domains: ["storage"], topics: ["replication", "sharding"] },
  "distributed-tracing": { domains: ["data", "platform"], topics: ["stream-processing", "time-series", "sharding"] },
  doordash: { domains: ["commerce", "location"], topics: ["geospatial", "matching", "state-machine"] },
  dropbox: { domains: ["storage"], topics: ["offline-sync", "cdn", "idempotency"] },
  "ecommerce-checkout": { domains: ["commerce"], topics: ["reservations", "idempotency", "state-machine"] },
  "elevator-system": { domains: ["physical"], topics: ["ood", "state-machine", "matching"] },
  "enterprise-llm-search": { domains: ["ai", "search"], topics: ["search-index", "auth-security", "crawling", "multi-tenancy"] },
  "facebook-marketplace": { domains: ["commerce", "social"], topics: ["geospatial", "search-index", "caching"] },
  "fb-live-comments": { domains: ["social", "communication"], topics: ["feed-fanout", "presence"] },
  "fb-news-feed": { domains: ["social"], topics: ["feed-fanout", "caching"] },
  "fb-post-search": { domains: ["social", "search"], topics: ["search-index", "sharding", "caching"] },
  "file-downloader": { domains: ["devtools"], topics: ["ood", "offline-sync"] },
  "flash-sale": { domains: ["commerce"], topics: ["reservations", "rate-limiting", "caching"] },
  "fraud-detection": { domains: ["fintech", "trust"], topics: ["stream-processing", "ml-models"] },
  "gaming-leaderboard": { domains: ["gaming"], topics: ["counting", "sharding", "caching"] },
  "github-actions": { domains: ["devtools", "platform"], topics: ["scheduling", "code-execution", "multi-tenancy"] },
  goodreads: { domains: ["social", "search"], topics: ["crawling", "search-index", "caching"] },
  "google-analytics": { domains: ["data"], topics: ["stream-processing", "batch-processing", "counting", "time-series"] },
  "google-calendar": { domains: ["productivity"], topics: ["scheduling", "notifications"] },
  "google-docs": { domains: ["productivity"], topics: ["collaboration", "offline-sync"] },
  "google-maps": { domains: ["location"], topics: ["geospatial", "cdn", "caching"] },
  "gpu-job-manager": { domains: ["platform", "ai"], topics: ["scheduling", "matching", "multi-tenancy"] },
  "hotel-booking": { domains: ["booking"], topics: ["reservations", "search-index", "caching"] },
  instagram: { domains: ["social", "media"], topics: ["feed-fanout", "cdn", "media-processing"] },
  "interview-platform": { domains: ["productivity"], topics: ["collaboration", "scheduling", "code-execution"] },
  "inventory-system": { domains: ["commerce"], topics: ["reservations", "transactions"] },
  "iot-platform": { domains: ["physical", "platform"], topics: ["time-series", "offline-sync", "stream-processing"] },
  "job-scheduler": { domains: ["platform"], topics: ["scheduling", "sharding", "idempotency"] },
  "key-value-store": { domains: ["storage"], topics: ["replication", "sharding"] },
  "large-scale-sorting": { domains: ["data"], topics: ["batch-processing", "sharding"] },
  leetcode: { domains: ["devtools"], topics: ["code-execution", "counting"] },
  "like-counter": { domains: ["social"], topics: ["counting", "sharding", "caching"] },
  "live-video-streaming": { domains: ["media"], topics: ["media-processing", "cdn"] },
  "live-viewer-count": { domains: ["media", "social"], topics: ["presence", "counting"] },
  "local-delivery-service": { domains: ["commerce", "location"], topics: ["geospatial", "reservations", "caching"] },
  "loyalty-rewards": { domains: ["fintech", "commerce"], topics: ["ledger", "idempotency", "stream-processing"] },
  "message-queue": { domains: ["platform", "storage"], topics: ["replication", "sharding"] },
  "metrics-monitoring": { domains: ["data", "platform"], topics: ["time-series", "stream-processing", "notifications"] },
  "ml-platform": { domains: ["ai", "platform"], topics: ["ml-models", "batch-processing", "scheduling"] },
  "multiplayer-game": { domains: ["gaming"], topics: ["matching", "presence"] },
  "nearby-friends": { domains: ["location", "social"], topics: ["geospatial", "presence"] },
  "news-aggregator": { domains: ["search", "social"], topics: ["crawling", "ml-models", "caching"] },
  "notification-system": { domains: ["communication", "platform"], topics: ["notifications", "rate-limiting", "idempotency"] },
  "on-call-escalation": { domains: ["platform"], topics: ["notifications", "scheduling", "state-machine"] },
  "online-auction": { domains: ["commerce"], topics: ["transactions", "scheduling"] },
  "online-chess": { domains: ["gaming"], topics: ["matching", "state-machine"] },
  "online-poker": { domains: ["gaming"], topics: ["state-machine", "transactions"] },
  "order-event-processing": { domains: ["commerce", "data"], topics: ["stream-processing", "idempotency", "state-machine"] },
  "p2p-file-transfer": { domains: ["storage"], topics: ["p2p"] },
  "parking-lot": { domains: ["physical"], topics: ["ood", "matching"] },
  "parking-payment": { domains: ["physical", "fintech"], topics: ["state-machine", "geospatial", "notifications"] },
  "parts-compatibility": { domains: ["commerce", "search"], topics: ["search-index", "crawling", "caching"] },
  pastebin: { domains: ["utilities"], topics: ["id-generation", "cdn"] },
  "payment-system": { domains: ["fintech"], topics: ["idempotency", "ledger", "state-machine"] },
  "podcast-platform": { domains: ["media"], topics: ["crawling", "cdn", "scheduling"] },
  "price-tracking-service": { domains: ["commerce"], topics: ["crawling", "notifications", "time-series"] },
  "prime-video-home": { domains: ["media"], topics: ["ml-models", "caching"] },
  "rate-limiter": { domains: ["platform"], topics: ["rate-limiting", "sharding"] },
  "real-time-bidding": { domains: ["ads"], topics: ["ml-models", "counting"] },
  "recommendation-engine": { domains: ["ai", "search"], topics: ["ml-models", "batch-processing", "caching"] },
  "restaurant-booking": { domains: ["booking"], topics: ["reservations", "geospatial"] },
  robinhood: { domains: ["fintech"], topics: ["state-machine", "transactions"] },
  "search-engine": { domains: ["search"], topics: ["search-index", "crawling", "sharding"] },
  slack: { domains: ["communication", "productivity"], topics: ["presence", "multi-tenancy", "search-index"] },
  spotify: { domains: ["media"], topics: ["cdn", "search-index", "ml-models"] },
  "stack-overflow": { domains: ["social"], topics: ["search-index", "counting", "caching"] },
  "stock-exchange": { domains: ["fintech"], topics: ["matching", "transactions"] },
  strava: { domains: ["social", "location"], topics: ["geospatial", "counting", "offline-sync"] },
  "subscription-management": { domains: ["fintech"], topics: ["scheduling", "state-machine", "idempotency"] },
  "subscription-payment-plans": { domains: ["fintech"], topics: ["state-machine", "idempotency", "scheduling", "ood"] },
  "surge-pricing": { domains: ["location"], topics: ["geospatial", "stream-processing"] },
  "tax-calculation": { domains: ["fintech"], topics: ["caching", "geospatial"] },
  telemedicine: { domains: ["booking", "communication"], topics: ["scheduling", "reservations", "auth-security"] },
  ticketmaster: { domains: ["booking"], topics: ["reservations", "search-index", "caching"] },
  tinder: { domains: ["social", "location"], topics: ["geospatial", "matching", "caching"] },
  twitter: { domains: ["social"], topics: ["feed-fanout", "caching", "id-generation"] },
  typeahead: { domains: ["search"], topics: ["search-index", "caching", "batch-processing"] },
  uber: { domains: ["location"], topics: ["geospatial", "matching"] },
  "user-feedback-system": { domains: ["utilities"], topics: ["search-index", "notifications"] },
  "user-preferences-service": { domains: ["utilities"], topics: ["caching"] },
  "video-conferencing": { domains: ["communication"], topics: ["p2p", "presence", "media-processing"] },
  "voting-system": { domains: ["trust"], topics: ["transactions", "auth-security", "idempotency"] },
  "weather-app": { domains: ["utilities"], topics: ["caching", "cdn", "geospatial"] },
  "web-crawler": { domains: ["search"], topics: ["crawling", "rate-limiting"] },
  "webhook-system": { domains: ["platform", "devtools"], topics: ["idempotency", "multi-tenancy", "rate-limiting"] },
  whatsapp: { domains: ["communication"], topics: ["presence", "offline-sync", "sharding"] },
  yelp: { domains: ["location", "search"], topics: ["geospatial", "search-index", "caching"] },
  youtube: { domains: ["media"], topics: ["media-processing", "cdn"] },
  "youtube-top-k": { domains: ["data", "media"], topics: ["counting", "stream-processing"] },
};

const toTags = (group: TagGroup, defs: Record<string, readonly [string, string]>): Tag[] =>
  Object.entries(defs).map(([id, [label, description]]) => ({ id, label, group, description }));

/** Pattern tags mirror the Patterns section (same slugs as the pattern pages). */
const PATTERN_TAGS: Tag[] = (navigation.find((s) => s.section === "patterns")?.items ?? []).map((p) => ({
  id: p.slug,
  label: p.title,
  group: "pattern",
  description: `Problems that use the ${p.title} pattern.`,
}));

export const ALL_TAGS: Tag[] = [...toTags("domain", DOMAINS), ...toTags("topic", TOPICS), ...PATTERN_TAGS];
export const TAG_BY_ID = new Map(ALL_TAGS.map((t) => [t.id, t]));

export const tagHref = (id: string) => `/tags/${id}`;

/** Pattern tag id from an article tag label ("Scaling Reads" → "scaling-reads"). */
export const patternIdFromLabel = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/** All tags for a problem: its domains, topics, then patterns (from the article's own tags). */
export function tagsForProblem(slug: string, patternLabels: string[] = []): Tag[] {
  const own = PROBLEM_TAGS[slug];
  const ids = [
    ...(own?.domains ?? []),
    ...(own?.topics ?? []),
    ...patternLabels.map(patternIdFromLabel),
  ];
  return [...new Set(ids)].map((id) => TAG_BY_ID.get(id)).filter((t): t is Tag => Boolean(t));
}
