export interface NavLeaf {
  title: string;
  slug: string;
}

export interface NavSection {
  /** Label shown in the sidebar and header */
  title: string;
  /** Shorter label for the header tabs (defaults to `title`) */
  navLabel?: string;
  /** Singular label used as the article eyebrow ("Problem", "Pattern", …) */
  singular: string;
  /** URL segment: /learn/system-design/<section>/<slug> */
  section: string;
  items: NavLeaf[];
}

const leaf = (title: string): NavLeaf => ({
  title,
  slug: title
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, ""),
});

export const BASE = "/learn/system-design";

export const navigation: NavSection[] = [
  {
    title: "Problems",
    singular: "Problem",
    section: "problem-breakdowns",
    items: [
      leaf("Bitly"),
      leaf("Dropbox"),
      leaf("Local Delivery Service"),
      leaf("Ticketmaster"),
      leaf("FB News Feed"),
      leaf("Tinder"),
      leaf("LeetCode"),
      leaf("WhatsApp"),
      leaf("Rate Limiter"),
      leaf("FB Live Comments"),
      leaf("FB Post Search"),
      leaf("YouTube Top K"),
      leaf("Uber"),
      leaf("YouTube"),
      leaf("Web Crawler"),
      leaf("Ad Click Aggregator"),
      leaf("Yelp"),
      leaf("Instagram"),
      leaf("Strava"),
      leaf("Distributed Cache"),
      leaf("Online Auction"),
      leaf("Job Scheduler"),
      leaf("News Aggregator"),
      leaf("Price Tracking Service"),
      leaf("Notification System"),
      leaf("Robinhood"),
      leaf("Google Docs"),
      leaf("Payment System"),
      leaf("Metrics Monitoring"),
      leaf("Online Chess"),
      leaf("ChatGPT"),
      leaf("Flash Sale"),
      leaf("Pastebin"),
      leaf("Twitter"),
      leaf("Typeahead"),
      leaf("Key-Value Store"),
      leaf("Message Queue"),
      leaf("Google Calendar"),
      leaf("Google Analytics"),
      { title: "Sorting Large Data Sets", slug: "large-scale-sorting" },
      leaf("Surge Pricing"),
      leaf("Concurrent Stream Limit"),
      leaf("Hotel Booking"),
      { title: "A/B Testing", slug: "ab-testing" },
      leaf("Dependency Injection"),
      leaf("Like Counter"),
      leaf("Database Control Plane"),
      leaf("Authentication System"),
      leaf("Weather App"),
      leaf("Facebook Marketplace"),
      leaf("Distributed Tracing"),
      leaf("File Downloader"),
      leaf("On-Call Escalation"),
      leaf("Live Viewer Count"),
      leaf("Cloud Data Migration"),
      leaf("P2P File Transfer"),
      leaf("Parts Compatibility"),
      leaf("Ads Management"),
      { title: "E-commerce Checkout", slug: "ecommerce-checkout" },
      { title: "CDN", slug: "cdn" },
      leaf("Recommendation Engine"),
      { title: "Web Search Engine", slug: "search-engine" },
      leaf("Video Conferencing"),
      leaf("Blogging Platform"),
      { title: "Online Voting", slug: "voting-system" },
      leaf("Live Video Streaming"),
      leaf("Gaming Leaderboard"),
      leaf("Fraud Detection"),
      leaf("IoT Platform"),
      leaf("Distributed File System"),
      leaf("Bigtable"),
      leaf("Stock Exchange"),
      leaf("Digital Wallet"),
      leaf("Subscription Management"),
      leaf("Crowdfunding"),
      leaf("Loyalty Rewards"),
      leaf("Tax Calculation"),
      leaf("Stack Overflow"),
      leaf("Content Moderation"),
      leaf("Slack"),
      leaf("Spotify"),
      leaf("Podcast Platform"),
      leaf("Bluesky"),
      leaf("ML Platform"),
      leaf("Blockchain Network"),
      leaf("DoorDash"),
      leaf("Telemedicine"),
      leaf("Autonomous Vehicle Platform"),
      leaf("Real-Time Bidding"),
      leaf("Nearby Friends"),
      leaf("Goodreads"),
      leaf("Prime Video Home"),
      leaf("Parking Payment"),
      leaf("Inventory System"),
      leaf("Order Event Processing"),
      leaf("Amazon Pickup Lockers"),
      leaf("Amazon Warehouse"),
      leaf("Google Maps"),
      leaf("GPU Job Manager"),
      leaf("Webhook System"),
      leaf("Interview Platform"),
      leaf("GitHub Actions"),
      leaf("Code Deployment"),
      leaf("Enterprise LLM Search"),
      leaf("Parking Lot"),
      leaf("Online Poker"),
      leaf("Elevator System"),
      leaf("User Preferences Service"),
      leaf("AI Model API"),
      leaf("Anomaly Detection"),
      leaf("User Feedback System"),
      leaf("Data Warehouse"),
      leaf("ATM"),
      leaf("Multiplayer Game"),
      leaf("Restaurant Booking"),
    ],
  },
  {
    title: "Patterns",
    singular: "Pattern",
    section: "patterns",
    items: [
      leaf("Real-time Updates"),
      leaf("Dealing with Contention"),
      leaf("Multi-step Processes"),
      leaf("Scaling Reads"),
      leaf("Scaling Writes"),
      leaf("Handling Large Blobs"),
      leaf("Managing Long Running Tasks"),
    ],
  },
  {
    title: "Technologies",
    singular: "Technology",
    section: "deep-dives",
    items: [
      leaf("Redis"),
      leaf("Elasticsearch"),
      leaf("Kafka"),
      leaf("Temporal"),
      leaf("API Gateway"),
      leaf("Cassandra"),
      leaf("DynamoDB"),
      leaf("PostgreSQL"),
      leaf("Flink"),
      leaf("ZooKeeper"),
    ],
  },
  {
    title: "Questions",
    singular: "Q&A",
    section: "questions",
    items: [
      { title: "Fundamentals & Performance", slug: "fundamentals" },
      { title: "Distributed Systems", slug: "distributed-systems" },
      { title: "Databases & Storage", slug: "databases" },
      { title: "Caching & CDN", slug: "caching" },
      { title: "Networking & Gateways", slug: "networking" },
      { title: "Messaging & Streaming", slug: "messaging" },
      { title: "APIs & Integration", slug: "apis" },
      { title: "Architecture & Operations", slug: "architecture" },
      { title: "Security", slug: "security" },
      { title: "Search & Recommendations", slug: "search-and-recommendations" },
      { title: "Situational Scenarios", slug: "scenarios" },
    ],
  },
  {
    title: "Tips & Tricks",
    navLabel: "Tips",
    singular: "Tip sheet",
    section: "tips",
    items: [
      { title: "The 45-Minute Game Plan", slug: "interview-game-plan" },
      { title: "Non-Functional Requirements", slug: "non-functional-requirements" },
      { title: "Back-of-the-Envelope Math", slug: "back-of-the-envelope" },
      { title: "API Design Cheat Sheet", slug: "api-design-cheat-sheet" },
      { title: "Choosing a Database", slug: "choosing-a-database" },
      { title: "Caching Failure Scenarios", slug: "caching-failure-scenarios" },
      { title: "Queue & Messaging Failures", slug: "messaging-failure-scenarios" },
      { title: "Payment Failure Scenarios", slug: "payment-failure-scenarios" },
      { title: "Red Flags to Avoid", slug: "red-flags" },
    ],
  },
  {
    title: "Real-Life Questions",
    navLabel: "Real-Life",
    singular: "Real interview question",
    section: "real-life",
    items: [
      { title: "Asset Monitoring Platform", slug: "asset-monitoring-platform" },
      { title: "Subscription Payment Plans", slug: "subscription-payment-plans" },
    ],
  },
  {
    title: "Code Review Questions",
    navLabel: "Code Review",
    singular: "Code review",
    section: "code-review",
    items: [
      { title: "Money Transfer", slug: "money-transfer" },
      { title: "Seat Booking", slug: "seat-booking-code" },
      { title: "Rate Limiter Middleware", slug: "rate-limiter-code" },
      { title: "Product Cache", slug: "product-cache-code" },
      { title: "Retrying an External API", slug: "external-api-retry-code" },
      { title: "Feed Endpoint", slug: "feed-endpoint-code" },
      { title: "Order Event Consumer", slug: "queue-consumer-code" },
      { title: "Login Endpoint", slug: "login-endpoint-code" },
    ],
  },
];

export const hrefFor = (section: string, slug: string) => `${BASE}/${section}/${slug}`;

export const sectionOf = (section: string) => navigation.find((s) => s.section === section);

/** Every page in the sidebar — used for search. */
export function allNavRoutes() {
  return navigation.flatMap((sec) =>
    sec.items.map((item) => ({ section: sec.section, slug: item.slug, title: item.title, group: sec.title })),
  );
}
