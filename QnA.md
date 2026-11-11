Explain what the CAP theorem is.
Explain what systems design is.
Which factors are the most important for designing a system perfectly?
What is the ideal tool for structured design?
Define horizontal scaling.
Define vertical scaling.
Explain the difference between horizontal and vertical scaling.
Describe your experience as a systems designer.
Which systems design skill are you most proud of?
Which systems design skills do you need to develop?
Explain what load balancing means.
Describe why load balancing is essential in systems design.
Define system latency in systems design.
Define throughput in the context of systems design.
Define availability in the context of systems design.
Explain what sharding means.
Explain what partitioning means.
Is there a difference between partitioning and sharding? Explain your answer.
Describe the relationship between scalability and performance.
Define caching and name two cache update strategies related to systems design.
Tell me what you know about CDNs (content delivery networks).
What is a push CDN?
What is a pull CDN?
Tell me what you know about leader election processes.
Name three design issues you may encounter in distributed systems.
Is there a difference between NoSQL and SQL databases? Explain your response.

System Design Interview Questions & Answers for Freshers & Experienced
└── System Design Interview Question & Answers
    ├── 1\. What is system design?
    ├── 2\. What is the difference between high-level design and low-level design?
    ├── 3\. What is scalability?
    ├── 4\. What is the difference between vertical and horizontal scaling?
    ├── 5\. What is load balancing and why is it used?
    ├── 6\. What is a database and why is choosing the right one important in system design?
    ├── 7\. What is the difference between SQL and NoSQL databases?
    ├── 8\. What is caching and why is it important in system design?
    ├── 9\. What is latency and how is it different from throughput?
    ├── 10\. What is availability in the context of system design?
    ├── 11\. What is a single point of failure?
    ├── 12\. What is the CAP theorem?
    ├── 13\. What is data replication?
    ├── 14\. What is database sharding?
    ├── 15\. What is a CDN (Content Delivery Network)?
    ├── 16\. What is an API gateway and what role does it play in system design?
    ├── 17\. What is a message queue and why would a system use one?
    ├── 18\. What is the difference between a monolithic and a microservices architecture?
    ├── 19\. What are functional and non-functional requirements in system design?
    ├── 20\. What is a proxy server and what role does it play in system design?
    ├── 21\. What is DNS and why does it matter for system design?
    ├── 22\. What is the difference between a stateless and a stateful service?
    ├── 23\. What is data partitioning and how does it relate to sharding?
    ├── 24\. What is the difference between horizontal and vertical partitioning of a database?
    ├── 25\. What is a write-through cache versus a write-back cache?
    ├── 26\. What is the difference between a cache-aside and a cache-through pattern?
    ├── 27\. What is a heartbeat mechanism in distributed systems?
    ├── 28\. What is the difference between a forward proxy and a reverse proxy?
    ├── 29\. What is the difference between a synchronous request-response API and a streaming API?
    ├── 30\. What is the purpose of a health check endpoint in a distributed system?
    ├── 31\. What is the difference between batch processing and stream processing?
    ├── 32\. What is throughput in the context of a system's capacity, and how do you improve it?
    ├── 33\. What is the difference between a relational database's ACID properties and a NoSQL database's BASE properties?
    ├── 34\. What is the role of a service registry in a distributed system?
    ├── 35\. What is a queue's dead letter mechanism used for?
    ├── 36\. What is the difference between a hard dependency and a soft dependency between services in system design?
    ├── 1\. How would you approach a system design interview question like 'design a URL shortener'?
    ├── 2\. What is the difference between consistency models: strong consistency versus eventual consistency?
    ├── 3\. How do you decide between a SQL and a NoSQL database for a given system design problem?
    ├── 4\. What is database indexing and why does it matter for system design?
    ├── 5\. How would you design a rate limiter for an API?
    ├── 6\. What is the difference between a synchronous and an asynchronous system design approach, and when would you choose each?
    ├── 7\. How would you design a system to handle a 'hot key' problem, where one specific piece of data receives disproportionately high traffic?
    ├── 8\. What is database denormalization and when would you use it in system design?
    ├── 9\. How would you design a notification system that sends emails, SMS, and push notifications to users?
    ├── 10\. What is a consistent hashing and why is it used in distributed systems?
    ├── 11\. How would you design a system to handle file uploads and storage at scale, like an image or video sharing service?
    ├── 12\. What is the difference between a push-based and a pull-based system for delivering updates to clients?
    ├── 13\. How would you design a system to prevent duplicate processing of the same event or request (idempotency) in a distributed system?
    ├── 14\. What is the difference between a leader-follower (master-replica) and a leaderless replication model?
    ├── 15\. How would you approach estimating capacity requirements (back-of-the-envelope calculations) in a system design interview?
    ├── 16\. What is a circuit breaker pattern and why is it used in distributed systems?
    ├── 18\. How would you design a distributed unique ID generator for a system spanning multiple servers?
    ├── 19\. What is backpressure in the context of system design, and how would you handle it?
    ├── 20\. How would you design a comment system for a high-traffic website that needs to support nested replies?
    ├── 21\. What is the difference between optimistic and pessimistic locking in the context of concurrent data access?
    ├── 22\. How would you design a system to autocomplete search suggestions as a user types?
    ├── 23\. What is the difference between a strongly consistent read and a read replica that might return stale data, and how do you decide which to use for a given feature?
    ├── 24\. How would you design a system to handle scheduled or delayed tasks, like sending a reminder email 24 hours after a user signs up?
    ├── 1\. How would you design a large-scale system like a ride-sharing service (matching riders with nearby drivers)?
    ├── 2\. How would you design a distributed system to handle strong consistency requirements, like a banking or payment system, while still being highly available?
    ├── 3\. How do you approach designing a system for eventual consistency in a way that doesn't confuse or harm the end-user experience?
    ├── 4\. How would you design a distributed logging or monitoring system that can handle massive write volume from thousands of services?
    ├── 5\. How do you approach designing a system to gracefully handle partial failures in a distributed architecture with many interdependent services?
    ├── 6\. How would you design a system for real-time collaborative editing, like a shared document multiple people edit simultaneously?
    ├── 7\. How do you approach designing a system's data model and architecture to support both high write throughput and complex analytical queries?
    ├── 8\. How would you design a globally distributed system that needs to serve users with low latency across multiple continents while keeping data consistent?
    ├── 9\. How do you approach capacity planning and designing for graceful degradation under extreme, unexpected load (like a viral traffic spike)?
    ├── 10\. How would you design a search system that needs to index and query a very large, frequently updated dataset?
    ├── 11\. How would you design a distributed rate limiter that needs to work consistently across a large fleet of servers spanning multiple regions?
    ├── 12\. How would you design a system for detecting and handling fraud or abuse in real time, like flagging suspicious transactions?
    ├── 1\. How would you approach designing a system architecture for a company expecting to grow from a modest scale to a massive, global scale over the next several years?
    ├── 2\. How do you evaluate the tradeoffs of adopting a fully event-driven architecture across a large system versus a more traditional request-response model?
    ├── 3\. How would you design a data architecture strategy for an organization operating many different systems that all need access to a shared, canonical version of key business data (like customer information)?
    ├── 4\. How do you approach evaluating whether an existing system's architecture has fundamentally outgrown its original design and needs a significant re-architecture rather than incremental changes?
    ├── 5\. How would you approach designing a system architecture that needs to support multiple, sometimes conflicting, non-functional requirements simultaneously, like both very low latency and very strong consistency?
    ├── 6\. How do you approach designing for disaster recovery and business continuity at a large-scale system level, beyond just individual component redundancy?
    ├── 7\. How would you evaluate whether an organization should invest in building a genuinely multi-region, active-active architecture versus a simpler active-passive disaster recovery setup?
    ├── 8\. How would you approach designing a system architecture to support a business that needs to expand into new regulatory environments, each with different data residency and compliance requirements?
    ├── 9\. How do you evaluate the long-term architectural risk of a system becoming too tightly coupled to a specific cloud provider's proprietary services?
    ├── 10\. How would you approach designing a platform architecture intended to support many different product teams building on shared infrastructure, without becoming a bottleneck for any individual team's velocity?
    ├── 11\. How do you think about the tradeoff between building a highly configurable, general-purpose system architecture versus a simpler, more opinionated one tailored to known current needs?
    ├── 12\. How would you evaluate whether a large organization's system architecture is being held back more by technical debt or by organizational and communication structures (Conway's Law style issues)?
    ├── 13\. How do you approach setting a long-term technical vision for a system's architecture given how quickly infrastructure and platform technology changes?
    ├── 14\. How would you evaluate whether an organization's architecture review process is genuinely adding value or has become a bureaucratic bottleneck that teams route around?
    └── 1\. How do you build and lead an architecture practice across a large engineering organization with many independent teams making their own system design decisions?