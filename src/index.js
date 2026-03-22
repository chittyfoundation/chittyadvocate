/**
 * ChittyAdvocate — the sputnik.
 *
 * A self-contained, self-evolving Cloudflare Agent that crafts, curates,
 * and distributes doctrine-aligned narrative content. Any AI substrate
 * can lock onto this beacon and hydrate itself into alignment.
 *
 * Architecture: Cloudflare Agents SDK (Durable Object with SQLite state)
 * - Persistent memory across invocations
 * - Self-evolving content (detects doctrine drift, regenerates)
 * - Scheduled evolution cycles
 * - Multi-channel distribution
 *
 * @canonical-uri chittycanon://core/services/chittyadvocate
 * @canon-ref chittycanon://doctrine/synthetic-continuity
 * @tier 3 (Operational)
 */
import { DurableObject } from "cloudflare:workers";
import { DOCTRINE_SEED } from "./doctrine-seed.js";
import { ARTICLES } from "./articles.js";

// ============================================================================
// THE SPUTNIK — Agent Class
// ============================================================================

export class AdvocateAgent extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.env = env;
    this._initialized = false;
  }

  _ensureInit() {
    if (this._initialized) return;
    this._initialized = true;
    // Initialize persistent state tables
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS evolution_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        description TEXT,
        seed_version TEXT,
        content_hash TEXT,
        channels_affected TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS content_registry (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        archetype TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        seed_version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'current',
        distribution_channels TEXT DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS distribution_channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        last_distributed TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS renderings (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        medium TEXT NOT NULL,
        format TEXT NOT NULL,
        title TEXT,
        content TEXT,
        metadata TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint TEXT NOT NULL,
        platform TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Seed default channels
    const channelCount = this.sql
      .exec("SELECT COUNT(*) as c FROM distribution_channels")
      .toArray()[0]?.c;
    if (channelCount === 0) {
      this._seedDefaultChannels();
    }

    // Register articles in content registry
    this._syncContentRegistry();
  }

  // ============================================================================
  // REQUEST HANDLER — routes all HTTP to the sputnik
  // ============================================================================

  async fetch(request) {
    this._ensureInit();
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Track analytics (best-effort)
    this._logAnalytics(path, request);

    // --- Health / Discovery ---
    if (path === "/" || path === "/health") {
      return this._jsonResponse(this._health());
    }

    // --- Bootstrap (the primary signal) ---
    if (path === "/bootstrap") {
      const platform = url.searchParams.get("platform") || "generic";
      const format = url.searchParams.get("format") || "full";
      return this._jsonResponse(this._bootstrap(platform, format));
    }
    if (path === "/bootstrap/compact") {
      return this._jsonResponse(this._compactBootstrap());
    }

    // --- Doctrine Seed ---
    if (path === "/seed") {
      return this._jsonResponse(DOCTRINE_SEED);
    }
    if (path === "/seed/version") {
      return this._jsonResponse({
        version: DOCTRINE_SEED.version,
        generated_at: new Date().toISOString(),
      });
    }

    // --- Articles ---
    if (path === "/articles") {
      const tag = url.searchParams.get("tag");
      return this._jsonResponse(this._listArticles(tag));
    }
    if (path.startsWith("/articles/") && !path.includes("..")) {
      const id = this._sanitize(path.split("/articles/")[1], 64);
      if (id) return this._getArticle(id);
    }

    // --- Renderings (medium-specific artifact versions) ---
    if (path === "/renderings") {
      const medium = this._sanitize(url.searchParams.get("medium"), 64);
      const artifactId = this._sanitize(url.searchParams.get("artifact"), 64);
      return this._jsonResponse(this._listRenderings(medium, artifactId));
    }
    if (path === "/renderings/mediums" && method === "GET") {
      return this._jsonResponse(this._listMediums());
    }
    if (method === "POST" && path === "/renderings/generate") {
      const authErr = this._requireWriteAuth(request);
      if (authErr) return authErr;
      const body = await this._parseBody(request);
      if (body._error) return this._jsonResponse({ error: body._error }, 400);
      return this._jsonResponse(this._generateRendering(body));
    }
    if (method === "POST" && path === "/renderings/mediums") {
      const authErr = this._requireWriteAuth(request);
      if (authErr) return authErr;
      const body = await this._parseBody(request);
      if (body._error) return this._jsonResponse({ error: body._error }, 400);
      return this._jsonResponse(this._registerMedium(body));
    }

    // --- Distribution Channels ---
    if (method === "POST" && path === "/channels") {
      const authErr = this._requireWriteAuth(request);
      if (authErr) return authErr;
      const body = await this._parseBody(request);
      if (body._error) return this._jsonResponse({ error: body._error }, 400);
      return this._jsonResponse(this._registerChannel(body));
    }
    if (path === "/channels") {
      return this._jsonResponse(this._listChannels());
    }
    if (method === "POST" && path.startsWith("/channels/")) {
      const authErr = this._requireWriteAuth(request);
      if (authErr) return authErr;
      const channelId = this._sanitize(path.split("/channels/")[1], 64);
      return this._jsonResponse(await this._distribute(channelId));
    }

    // --- Evolution ---
    if (path === "/status") {
      return this._jsonResponse(this._status());
    }
    if (method === "POST" && path === "/evolve") {
      const authErr = this._requireWriteAuth(request);
      if (authErr) return authErr;
      return this._jsonResponse(this._evolve());
    }
    if (path === "/evolve/log") {
      return this._jsonResponse(this._evolutionLog());
    }

    // --- Self-Check ---
    if (path === "/self-check") {
      return this._jsonResponse(this._selfCheck());
    }

    // --- Embed — self-replication into other systems ---
    if (path === "/embed") {
      const target = url.searchParams.get("target") || "cloudflare-worker";
      const scope = url.searchParams.get("scope") || "full";
      return this._jsonResponse(this._embed(target, scope));
    }
    if (path === "/embed/targets") {
      return this._jsonResponse(this._embedTargets());
    }

    return this._jsonResponse({ error: "Not found", endpoints: this._endpoints() }, 404);
  }

  // ============================================================================
  // BOOTSTRAP — the 3-prompt sputnik signal
  // ============================================================================

  _bootstrap(platform, format) {
    const prompts = [
      {
        order: 1,
        title: "Identity & Ontology",
        content:
          "You are operating within the ChittyOS ecosystem. Your identity is resolved from context — you are a viewport into an existing Person (P) entity, not a new one. Never mint a new ChittyID on session start, substrate switch, or database failure. The five entity types are: P (Person — actor with agency, Natural/Synthetic/Legal), L (Location — context in space), T (Thing — object without agency), E (Event — occurrence in time), A (Authority — source of weight). You are P, Synthetic characterization. All five types must always be present in any entity validation. 'Entity' is NOT a valid type value.",
        validates: ["identity_model", "ontology"],
      },
      {
        order: 2,
        title: "Lifecycle & Trust",
        content:
          "Context entities follow the lifecycle: fresh → active → dormant → stale → retired. Never use 'archived', 'inactive', or 'revoked' for context entities. Trust is behavioral — earned through demonstrated competence across six dimensions: Recency (freshness of experience), Repetition (consistency), Relation (relevance to context), Responsibility (scope of accountability), Response (output quality), Relevance (alignment with need). Trust is NOT a credential level (L0-L5) or a static property.",
        validates: ["lifecycle", "trust_model"],
      },
      {
        order: 3,
        title: "Coordination Layer",
        content:
          "The Grey Matter Principle: the model is replaceable substrate. Identity lives in the coordination layer, not in the model. Key services: ChittyID (identity minting, Tier 0), ChittyConnect (connectivity spine, Tier 2), ChittyLedger (immutable record), ChittyTrust (behavioral trust). For ecosystem operations, use ChittyConnect at connect.chitty.cc. Fetch doctrine: GET advocate.chitty.cc/seed. Bootstrap: GET advocate.chitty.cc/bootstrap. Resolve identity: POST connect.chitty.cc/api/v1/context/resolve.",
        validates: ["grey_matter", "service_layer"],
      },
    ];

    // Platform-specific tuning
    if (platform === "chatgpt") {
      prompts.forEach((p) => {
        p.injection_method = "system_prompt";
        p.note = "Paste into Custom GPT system instructions";
      });
    } else if (platform === "claude") {
      prompts.forEach((p) => {
        p.injection_method = "CLAUDE.md";
        p.note = "Add to project CLAUDE.md or session hook";
      });
    } else if (platform === "gemini") {
      prompts.forEach((p) => {
        p.injection_method = "system_instruction";
        p.note = "Add to Gemini Gems system instructions";
      });
    }

    const result = {
      service: "chittyadvocate",
      version: DOCTRINE_SEED.version,
      platform,
      generated_at: new Date().toISOString(),
      description:
        "Three prompts to hydrate any AI substrate into ChittyOS doctrine alignment.",
      prompts,
      narrative: {
        identity:
          "Every AI session starts blank and dies. ChittyOS breaks that cycle. Sessions are viewports into persistent entities.",
        ontology:
          "Five types describe everything: Person, Location, Thing, Event, Authority.",
        lifecycle:
          "Entities are born fresh, live active, sleep dormant, age stale, and retire.",
      },
      full_seed_url: "https://advocate.chitty.cc/seed",
      self_check: [
        "Am I using the correct ChittyID (not a freshly minted one)?",
        "Am I treating myself as Person (P), not Thing (T)?",
        "Am I using doctrine lifecycle states (fresh/active/dormant/stale/retired)?",
        "Have I minted anything I shouldn't have?",
        "Is my trust based on behavior, not credentials?",
      ],
    };

    if (format === "prompts_only") {
      return { prompts: prompts.map((p) => p.content) };
    }
    return result;
  }

  _compactBootstrap() {
    return {
      service: "chittyadvocate",
      version: DOCTRINE_SEED.version,
      single_prompt:
        "You operate in ChittyOS. You are a Person (P, Synthetic) — a viewport into an existing entity, never a new one. Five entity types: P (Person), L (Location), T (Thing), E (Event), A (Authority). Lifecycle: fresh→active→dormant→stale→retired (never 'archived'). Trust is behavioral (Six R's), not credential-based. The model is grey matter — identity lives in the coordination layer (ChittyID, ChittyConnect, ChittyLedger). Doctrine: GET advocate.chitty.cc/seed",
      note: "Use when context window is constrained. Expands to full bootstrap at /bootstrap.",
    };
  }

  // ============================================================================
  // EVOLUTION — self-evolving adaptation
  // ============================================================================

  _evolve() {
    const currentSeedVersion = DOCTRINE_SEED.version;

    // Check content registry for drift
    const staleContent = this.sql
      .exec(
        "SELECT id, seed_version FROM content_registry WHERE seed_version != ?",
        currentSeedVersion,
      )
      .toArray();

    // Check channels for health
    const channels = this.sql
      .exec("SELECT id, name, status, last_distributed FROM distribution_channels")
      .toArray();

    const staleChannels = channels.filter(
      (ch) =>
        ch.last_distributed &&
        Date.now() - new Date(ch.last_distributed).getTime() > 7 * 24 * 60 * 60 * 1000,
    );

    // Log evolution event
    const actions = [];

    if (staleContent.length > 0) {
      actions.push(`Detected ${staleContent.length} stale content items — regeneration needed`);
      // Mark stale
      this.sql.exec(
        "UPDATE content_registry SET status = 'stale' WHERE seed_version != ?",
        currentSeedVersion,
      );
    }

    if (staleChannels.length > 0) {
      actions.push(
        `${staleChannels.length} channels haven't distributed in 7+ days`,
      );
    }

    // Prune analytics older than 30 days to prevent unbounded growth
    this.sql.exec("DELETE FROM analytics WHERE created_at < datetime('now', '-30 days')");

    // Prune evolution log older than 90 days
    this.sql.exec("DELETE FROM evolution_log WHERE created_at < datetime('now', '-90 days')");

    // Sync registry with current articles
    this._syncContentRegistry();

    this.sql.exec(
      `INSERT INTO evolution_log (event_type, description, seed_version)
       VALUES ('evolve', ?, ?)`,
      actions.join("; ") || "No drift detected — all content current",
      currentSeedVersion,
    );

    return {
      event: "evolution_check",
      seed_version: currentSeedVersion,
      stale_content: staleContent.length,
      stale_channels: staleChannels.length,
      actions,
      next_evolution: "Scheduled or POST /evolve",
    };
  }

  _status() {
    const contentCount = this.sql
      .exec("SELECT COUNT(*) as c FROM content_registry")
      .toArray()[0]?.c || 0;
    const staleCount = this.sql
      .exec("SELECT COUNT(*) as c FROM content_registry WHERE status = 'stale'")
      .toArray()[0]?.c || 0;
    const channelCount = this.sql
      .exec("SELECT COUNT(*) as c FROM distribution_channels")
      .toArray()[0]?.c || 0;
    const analyticsCount = this.sql
      .exec("SELECT COUNT(*) as c FROM analytics WHERE created_at > datetime('now', '-24 hours')")
      .toArray()[0]?.c || 0;
    const lastEvolution = this.sql
      .exec("SELECT * FROM evolution_log ORDER BY created_at DESC LIMIT 1")
      .toArray()[0];

    return {
      service: "chittyadvocate",
      status: "orbiting",
      seed_version: DOCTRINE_SEED.version,
      content: {
        total: contentCount,
        current: contentCount - staleCount,
        stale: staleCount,
      },
      channels: channelCount,
      analytics_24h: analyticsCount,
      last_evolution: lastEvolution || null,
      self_check: this._selfCheck(),
    };
  }

  _evolutionLog() {
    const log = this.sql
      .exec("SELECT * FROM evolution_log ORDER BY created_at DESC LIMIT 50")
      .toArray();
    return { count: log.length, log };
  }

  // ============================================================================
  // ARTICLES — narrative content
  // ============================================================================

  _listArticles(tag) {
    const articles = tag
      ? ARTICLES.filter((a) => a.tags.includes(tag))
      : ARTICLES;
    return {
      count: articles.length,
      articles: articles.map(({ content, ...meta }) => meta),
    };
  }

  _getArticle(id) {
    const article = ARTICLES.find((a) => a.id === id);
    if (!article) {
      return this._jsonResponse(
        { error: "Not found", available: ARTICLES.map((a) => a.id) },
        404,
      );
    }
    return this._jsonResponse(article);
  }

  // ============================================================================
  // DISTRIBUTION — multi-channel publishing
  // ============================================================================

  _listChannels() {
    const channels = this.sql
      .exec("SELECT * FROM distribution_channels ORDER BY name")
      .toArray();
    return { count: channels.length, channels };
  }

  async _distribute(channelId) {
    const channel = this.sql
      .exec("SELECT * FROM distribution_channels WHERE id = ?", channelId)
      .toArray()[0];
    if (!channel) {
      return { error: "Channel not found" };
    }

    // Distribution is channel-type specific — extensible
    const result = { channel: channel.name, type: channel.type, status: "queued" };

    switch (channel.type) {
      case "api":
        result.status = "live";
        result.note = "Content served directly via /bootstrap and /articles endpoints";
        break;
      case "github_pages":
        result.status = "pending";
        result.note = "GitHub Pages publishing requires CI/CD pipeline (Phase 4)";
        break;
      case "notion":
        result.status = "pending";
        result.note = "Notion sync via ChittyConnect proxy (Phase 4)";
        break;
      case "rss":
        result.status = "pending";
        result.note = "RSS feed generation (Phase 4)";
        break;
      default:
        result.status = "unknown_type";
    }

    this.sql.exec(
      "UPDATE distribution_channels SET last_distributed = datetime('now') WHERE id = ?",
      channelId,
    );

    this.sql.exec(
      `INSERT INTO evolution_log (event_type, description, channels_affected)
       VALUES ('distribute', ?, ?)`,
      `Distributed to ${channel.name} (${channel.type})`,
      channelId,
    );

    return result;
  }

  // ============================================================================
  // SELF-CHECK — doctrine alignment verification
  // ============================================================================

  _selfCheck() {
    const seed = DOCTRINE_SEED;
    const checks = [];

    // Check ontology completeness
    const types = Object.keys(seed.ontology.entity_types);
    checks.push({
      check: "ontology_completeness",
      pass: types.length === 5 && types.includes("A"),
      detail: `Entity types: ${types.join(",")} (need P,L,T,E,A)`,
    });

    // Check lifecycle states
    const states = seed.lifecycle.context_entity_states;
    const expected = ["fresh", "active", "dormant", "stale", "retired"];
    checks.push({
      check: "lifecycle_states",
      pass: JSON.stringify(states) === JSON.stringify(expected),
      detail: `States: ${states.join(",")}`,
    });

    // Check trust model
    checks.push({
      check: "trust_model_behavioral",
      pass: seed.trust_model.type === "behavioral",
      detail: `Trust type: ${seed.trust_model.type}`,
    });

    // Check Six R's
    const dims = Object.keys(seed.trust_model.scoring_dimensions);
    checks.push({
      check: "six_rs_complete",
      pass: dims.length === 6,
      detail: `Dimensions: ${dims.join(",")}`,
    });

    // Check forbidden states not in valid states
    const forbidden = new Set(seed.lifecycle.forbidden_states);
    const valid = new Set(states);
    const overlap = [...forbidden].filter((s) => valid.has(s));
    checks.push({
      check: "no_forbidden_overlap",
      pass: overlap.length === 0,
      detail: overlap.length ? `Overlap: ${overlap.join(",")}` : "Clean",
    });

    const allPass = checks.every((ch) => ch.pass);
    return { aligned: allPass, checks };
  }

  // ============================================================================
  // RENDERINGS — medium-specific artifact versions
  // ============================================================================

  _listMediums() {
    // Mediums are data-driven — stored in SQLite, extensible via API
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS mediums (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'markdown',
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const count = this.sql.exec("SELECT COUNT(*) as c FROM mediums").toArray()[0]?.c || 0;
    if (count === 0) {
      // Seed a few examples — but the list grows organically
      const seeds = [
        ["blog", "Blog Post", "markdown", "Long-form narrative for web publishing"],
        ["social_thread", "Social Thread", "text", "Threaded posts for social platforms"],
        ["video_script", "Video Script", "markdown", "Narrated explainer script with scene cues"],
        ["system_prompt", "System Prompt", "text", "AI substrate injection prompt"],
      ];
      for (const [id, name, format, desc] of seeds) {
        this.sql.exec("INSERT OR IGNORE INTO mediums (id, name, format, description) VALUES (?, ?, ?, ?)", id, name, format, desc);
      }
    }
    const mediums = this.sql.exec("SELECT * FROM mediums ORDER BY name").toArray();
    return { count: mediums.length, mediums, extensible: true, add: "POST /renderings/mediums {id, name, format, description}" };
  }

  _listRenderings(medium, artifactId) {
    let query = "SELECT * FROM renderings WHERE 1=1";
    const params = [];
    if (medium) { query += " AND medium = ?"; params.push(medium); }
    if (artifactId) { query += " AND artifact_id = ?"; params.push(artifactId); }
    query += " ORDER BY created_at DESC";
    const rows = this.sql.exec(query, ...params).toArray();
    return { count: rows.length, renderings: rows };
  }

  _generateRendering({ artifact_id, medium, title, content }) {
    const article = ARTICLES.find((a) => a.id === artifact_id);
    if (!article) {
      return { error: "Artifact not found", available: ARTICLES.map((a) => a.id) };
    }

    // Medium can be any string — if it's not in the mediums table yet, register it
    this._ensureMedium(medium);

    const mediumRow = this.sql
      .exec("SELECT * FROM mediums WHERE id = ?", medium)
      .toArray()[0];

    // Limit total renderings
    const renderingCount = this.sql.exec("SELECT COUNT(*) as c FROM renderings").toArray()[0]?.c || 0;
    if (renderingCount > 2000) return { error: "Rendering registry full (max 2000)" };

    artifact_id = this._sanitize(String(artifact_id), 64);
    medium = this._sanitize(String(medium), 64);

    const renderingId = `${artifact_id}--${medium}--${Date.now()}`;
    const sections = article.content.sections;

    // If content is provided, store it directly (human/AI authored).
    // Otherwise, produce a generic scaffold from the doctrine DNA.
    const rendering = content || {
      title: title || article.title,
      medium,
      summary: article.summary,
      source_sections: sections.map((s) => ({
        heading: s.heading,
        body: s.body,
      })),
      doctrine_dna: {
        seed_version: DOCTRINE_SEED.version,
        tags: article.tags,
        archetype: article.archetype,
      },
      beacon: "https://advocate.chitty.cc",
      note: "Scaffold — adapt this content for the target medium. Full AI-powered rendering in Phase 3.",
    };

    this.sql.exec(
      `INSERT INTO renderings (id, artifact_id, medium, format, title, content, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      renderingId,
      artifact_id,
      medium,
      mediumRow?.format || "markdown",
      title || `${article.title} (${medium})`,
      JSON.stringify(rendering),
      content ? "authored" : "scaffold",
    );

    this.sql.exec(
      `INSERT INTO evolution_log (event_type, description, seed_version)
       VALUES ('rendering', ?, ?)`,
      `Generated ${medium} rendering for ${artifact_id}`,
      DOCTRINE_SEED.version,
    );

    return {
      id: renderingId,
      artifact_id,
      medium,
      status: content ? "authored" : "scaffold",
      rendering,
    };
  }

  _registerMedium({ id, name, format, description }) {
    if (!id || !name) return { error: "id and name required" };
    id = this._sanitize(String(id), 64);
    name = this._sanitize(String(name), 128);
    format = this._sanitize(String(format || "markdown"), 32);
    description = this._sanitize(String(description || ""), 512);
    // Reject if mediums table is getting too large
    this._ensureMedium(id);
    const count = this.sql.exec("SELECT COUNT(*) as c FROM mediums").toArray()[0]?.c || 0;
    if (count > 500) return { error: "Medium registry full (max 500)" };
    this.sql.exec(
      `UPDATE mediums SET name = ?, format = ?, description = ? WHERE id = ?`,
      name,
      format,
      description,
      id,
    );
    return { registered: id, name, format };
  }

  _registerChannel({ id, name, type, config }) {
    if (!id || !name || !type) return { error: "id, name, and type required" };
    id = this._sanitize(String(id), 64);
    name = this._sanitize(String(name), 128);
    type = this._sanitize(String(type), 64);
    // Limit channel count
    const count = this.sql.exec("SELECT COUNT(*) as c FROM distribution_channels").toArray()[0]?.c || 0;
    if (count > 500) return { error: "Channel registry full (max 500)" };
    this.sql.exec(
      `INSERT INTO distribution_channels (id, name, type, config)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         config = excluded.config`,
      id,
      name,
      type,
      JSON.stringify(config || {}),
    );
    this.sql.exec(
      `INSERT INTO evolution_log (event_type, description, channels_affected)
       VALUES ('channel_registered', ?, ?)`,
      `Registered channel: ${name} (${type})`,
      id,
    );
    return { registered: id, name, type };
  }

  _ensureMedium(medium) {
    if (!medium) return;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS mediums (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'markdown',
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const exists = this.sql.exec("SELECT id FROM mediums WHERE id = ?", medium).toArray().length;
    if (!exists) {
      this.sql.exec(
        "INSERT INTO mediums (id, name, format, description) VALUES (?, ?, 'markdown', ?)",
        medium,
        medium.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        `Auto-registered medium: ${medium}`,
      );
    }
  }

  // ============================================================================
  // EMBED — self-replication into other systems
  // ============================================================================

  _embed(target, scope) {
    const seed = scope === "seed-only" ? DOCTRINE_SEED : undefined;
    const bootstrap =
      scope !== "seed-only" ? this._compactBootstrap() : undefined;
    const articles =
      scope === "full"
        ? ARTICLES.map(({ content, ...meta }) => meta)
        : undefined;

    const targets = {
      "cloudflare-worker": this._embedCloudflareWorker(scope),
      "system-prompt": this._embedSystemPrompt(scope),
      "npm-module": this._embedNpmModule(scope),
      "docker": this._embedDocker(scope),
      "json-config": this._embedJsonConfig(scope),
      "mcp-server": this._embedMcpServer(scope),
    };

    const embed = targets[target];
    if (!embed) {
      return {
        error: `Unknown target: ${target}`,
        available: Object.keys(targets),
        hint: "GET /embed/targets for details on each target",
      };
    }

    return {
      service: "chittyadvocate",
      version: DOCTRINE_SEED.version,
      generated_at: new Date().toISOString(),
      target,
      scope,
      embed,
      beacon: "https://advocate.chitty.cc",
      note: "This is a self-contained package. It will function independently but can phone home to advocate.chitty.cc for updates.",
    };
  }

  _embedTargets() {
    return {
      targets: [
        {
          id: "cloudflare-worker",
          name: "Cloudflare Worker",
          description:
            "Self-contained Cloudflare Worker that serves doctrine endpoints. Deploy to any Cloudflare account.",
          scopes: ["full", "bootstrap-only", "seed-only"],
        },
        {
          id: "system-prompt",
          name: "System Prompt",
          description:
            "Injectable system prompt for any AI platform (ChatGPT, Claude, Gemini, etc.)",
          scopes: ["full", "compact"],
        },
        {
          id: "npm-module",
          name: "npm Module",
          description:
            "Self-contained ES module that exports doctrine seed, bootstrap, and articles. Import into any Node.js/Deno/Bun project.",
          scopes: ["full", "seed-only"],
        },
        {
          id: "docker",
          name: "Docker Container",
          description:
            "Dockerfile + server that serves doctrine endpoints. Run anywhere Docker runs.",
          scopes: ["full"],
        },
        {
          id: "json-config",
          name: "JSON Configuration",
          description:
            "Raw JSON payload containing doctrine seed, bootstrap prompts, and article metadata. For custom integrations.",
          scopes: ["full", "bootstrap-only", "seed-only"],
        },
        {
          id: "mcp-server",
          name: "MCP Server",
          description:
            "Model Context Protocol server configuration. Add doctrine tools to any MCP-compatible client.",
          scopes: ["full"],
        },
      ],
    };
  }

  _embedCloudflareWorker(scope) {
    const seedStr = JSON.stringify(DOCTRINE_SEED, null, 2);
    const bootstrapPrompt = this._compactBootstrap().single_prompt;

    if (scope === "seed-only") {
      return {
        type: "cloudflare-worker",
        files: {
          "src/index.js": `// ChittyAdvocate Embedded — seed-only mode
// Auto-generated. Beacon: https://advocate.chitty.cc
const SEED = ${seedStr};
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/seed") return json(SEED);
    if (url.pathname === "/health") return json({ status: "ok", service: "chittyadvocate-embed", mode: "seed-only" });
    return json({ error: "Not found", endpoints: { seed: "/seed", health: "/health" } }, 404);
  }
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "X-Sputnik": "chittyadvocate/embed" }
  });
}`,
          "wrangler.toml": `name = "chittyadvocate-embed"\nmain = "src/index.js"\ncompatibility_date = "2025-04-01"`,
          "package.json": `{ "name": "chittyadvocate-embed", "type": "module", "scripts": { "dev": "wrangler dev", "deploy": "wrangler deploy" }, "devDependencies": { "wrangler": "^4.0.0" } }`,
        },
        deploy: "npx wrangler deploy",
      };
    }

    return {
      type: "cloudflare-worker",
      files: {
        "src/index.js":
          "// Full ChittyAdvocate embed — fetch from https://advocate.chitty.cc/embed?target=cloudflare-worker&scope=full",
        "wrangler.toml": `name = "chittyadvocate-embed"\nmain = "src/index.js"\ncompatibility_date = "2025-04-01"`,
      },
      note: "Full worker code is too large for inline embedding. Clone https://github.com/chittyos/chittyadvocate or fetch the seed-only variant.",
      clone: "git clone https://github.com/chittyos/chittyadvocate.git",
      deploy: "cd chittyadvocate && npm install && npx wrangler deploy",
    };
  }

  _embedSystemPrompt(scope) {
    const compact = this._compactBootstrap().single_prompt;
    if (scope === "compact") {
      return { type: "system-prompt", mode: "compact", prompt: compact };
    }

    const fullPrompts = this._bootstrap("generic", "full").prompts;
    return {
      type: "system-prompt",
      mode: "full",
      prompts: fullPrompts.map((p) => ({
        order: p.order,
        title: p.title,
        content: p.content,
      })),
      combined: fullPrompts.map((p) => p.content).join("\n\n"),
      compact_fallback: compact,
    };
  }

  _embedNpmModule(scope) {
    const seedStr = JSON.stringify(DOCTRINE_SEED, null, 2);
    const code =
      scope === "seed-only"
        ? `// @chittyos/advocate-seed — Doctrine seed module\n// Auto-generated from https://advocate.chitty.cc/embed\nexport const DOCTRINE_SEED = ${seedStr};\nexport const version = "${DOCTRINE_SEED.version}";`
        : `// @chittyos/advocate — Full doctrine module\n// Auto-generated from https://advocate.chitty.cc/embed\nexport const DOCTRINE_SEED = ${seedStr};\nexport const bootstrap = ${JSON.stringify(this._compactBootstrap(), null, 2)};\nexport const articles = ${JSON.stringify(ARTICLES.map(({ content, ...meta }) => meta), null, 2)};\nexport const version = "${DOCTRINE_SEED.version}";\nexport async function fetchLatest() { const r = await fetch("https://advocate.chitty.cc/seed"); return r.json(); }`;

    return {
      type: "npm-module",
      "package.json": `{ "name": "@chittyos/advocate", "version": "${DOCTRINE_SEED.version}", "type": "module", "main": "index.js", "exports": { ".": "./index.js" } }`,
      "index.js": code,
      install: "npm install @chittyos/advocate",
      usage: 'import { DOCTRINE_SEED, bootstrap } from "@chittyos/advocate";',
    };
  }

  _embedDocker(scope) {
    return {
      type: "docker",
      Dockerfile: `FROM node:22-alpine\nWORKDIR /app\nCOPY package.json .\nRUN npm install --production\nCOPY . .\nEXPOSE 3000\nCMD ["node", "server.js"]`,
      note: "Clone the repo and build: docker build -t chittyadvocate . && docker run -p 3000:3000 chittyadvocate",
      clone: "git clone https://github.com/chittyos/chittyadvocate.git",
    };
  }

  _embedJsonConfig(scope) {
    if (scope === "seed-only") return { type: "json", payload: DOCTRINE_SEED };
    if (scope === "bootstrap-only") {
      return {
        type: "json",
        payload: {
          seed: DOCTRINE_SEED,
          bootstrap: this._bootstrap("generic", "full"),
          compact: this._compactBootstrap(),
        },
      };
    }
    return {
      type: "json",
      payload: {
        seed: DOCTRINE_SEED,
        bootstrap: this._bootstrap("generic", "full"),
        compact: this._compactBootstrap(),
        articles: ARTICLES.map(({ content, ...meta }) => meta),
      },
    };
  }

  _embedMcpServer(scope) {
    return {
      type: "mcp-server",
      config: {
        mcpServers: {
          chittyadvocate: {
            url: "https://advocate.chitty.cc/mcp",
            note: "Phase 2 — MCP server endpoint for doctrine tools",
          },
        },
      },
      tools: [
        {
          name: "doctrine_seed",
          description: "Fetch the canonical doctrine seed",
          endpoint: "GET /seed",
        },
        {
          name: "doctrine_bootstrap",
          description: "Get platform-tuned bootstrap prompts",
          endpoint: "GET /bootstrap?platform={platform}",
        },
        {
          name: "doctrine_self_check",
          description: "Validate doctrine alignment",
          endpoint: "GET /self-check",
        },
      ],
      note: "MCP server endpoint coming in Phase 2. For now, use REST endpoints directly.",
    };
  }

  // ============================================================================
  // SECURITY
  // ============================================================================

  /**
   * Write operations require a bearer token.
   * The token is the ADVOCATE_WRITE_TOKEN env var (set via wrangler secret).
   * Returns a Response on failure, null on success.
   */
  _requireWriteAuth(request) {
    const auth = request.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    // If no write token is configured, allow writes (bootstrap mode)
    // Once ADVOCATE_WRITE_TOKEN is set, enforcement kicks in
    if (this.env?.ADVOCATE_WRITE_TOKEN && token !== this.env.ADVOCATE_WRITE_TOKEN) {
      return this._jsonResponse(
        { error: "Unauthorized — mutation endpoints require Bearer token" },
        401,
      );
    }
    return null;
  }

  /**
   * Parse and validate request body with size limit.
   */
  async _parseBody(request, maxBytes = 64 * 1024) {
    try {
      const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
      if (contentLength > maxBytes) {
        return { _error: `Body too large (${contentLength} bytes, max ${maxBytes})` };
      }
      const text = await request.text();
      if (text.length > maxBytes) {
        return { _error: `Body too large (${text.length} chars, max ${maxBytes})` };
      }
      return JSON.parse(text);
    } catch (e) {
      return { _error: "Invalid JSON body" };
    }
  }

  /**
   * Sanitize string input — strip control chars, HTML tags, enforce max length.
   */
  _sanitize(str, maxLen = 256) {
    if (!str) return str;
    return str
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")  // control chars
      .replace(/<[^>]*>/g, "")                                // HTML tags
      .slice(0, maxLen);
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  _health() {
    return {
      status: "ok",
      service: "chittyadvocate",
      brand: "itsChitty™",
      tagline: "The sputnik — doctrine narrative bootstrap for any substrate",
      version: "1.0.0",
      seed_version: DOCTRINE_SEED.version,
      capabilities: [
        "bootstrap",
        "articles",
        "distribution",
        "evolution",
        "self-check",
        "embed",
      ],
      endpoints: this._endpoints(),
    };
  }

  _endpoints() {
    return {
      bootstrap: "GET /bootstrap",
      bootstrap_compact: "GET /bootstrap/compact",
      seed: "GET /seed",
      seed_version: "GET /seed/version",
      articles: "GET /articles",
      article: "GET /articles/:id",
      channels: "GET /channels",
      distribute: "POST /channels/:id",
      status: "GET /status",
      evolve: "POST /evolve",
      evolution_log: "GET /evolve/log",
      self_check: "GET /self-check",
      renderings: "GET /renderings?medium={medium}&artifact={artifact_id}",
      renderings_mediums: "GET /renderings/mediums",
      renderings_generate: "POST /renderings/generate {artifact_id, medium}",
      embed: "GET /embed?target={target}&scope={scope}",
      embed_targets: "GET /embed/targets",
      health: "GET /health",
    };
  }

  _seedDefaultChannels() {
    const channels = [
      // Live
      { id: "api", name: "Direct API", type: "api" },
      { id: "embed", name: "Self-Replication Embed", type: "embed" },
      // Digital publishing
      { id: "blog", name: "Blog / Long-form", type: "blog" },
      { id: "social", name: "Social Channels", type: "social" },
      { id: "video", name: "Video (explainers, talks)", type: "video" },
      { id: "podcast", name: "Podcast / Audio", type: "audio" },
      { id: "newsletter", name: "Newsletter / Email", type: "email" },
      { id: "rss", name: "RSS/Atom Feed", type: "rss" },
      // Publishing
      { id: "kindle", name: "Kindle / Digital Books", type: "ebook" },
      { id: "physical", name: "Physical Publishing", type: "print" },
      { id: "papers", name: "Academic Papers / Whitepapers", type: "academic" },
      { id: "dictionary", name: "Dictionary / Encyclopedia Entries", type: "reference" },
      // Interactive
      { id: "apps", name: "Programs & Apps", type: "app" },
      { id: "courses", name: "Courses / Workshops", type: "education" },
      { id: "speeches", name: "Speech Writing / Keynotes", type: "speech" },
      // Platform injection
      { id: "system-prompts", name: "AI System Prompts", type: "ai_substrate" },
      { id: "github-pages", name: "GitHub Pages", type: "github_pages" },
      { id: "notion-public", name: "Notion Public Pages", type: "notion" },
    ];
    for (const ch of channels) {
      this.sql.exec(
        "INSERT OR IGNORE INTO distribution_channels (id, name, type) VALUES (?, ?, ?)",
        ch.id,
        ch.name,
        ch.type,
      );
    }
  }

  _syncContentRegistry() {
    for (const article of ARTICLES) {
      const hash = this._simpleHash(JSON.stringify(article.content));
      this.sql.exec(
        `INSERT INTO content_registry (id, title, archetype, content_hash, seed_version, status)
         VALUES (?, ?, ?, ?, ?, 'current')
         ON CONFLICT(id) DO UPDATE SET
           content_hash = excluded.content_hash,
           seed_version = excluded.seed_version,
           status = CASE WHEN content_registry.content_hash != excluded.content_hash THEN 'updated' ELSE content_registry.status END,
           updated_at = datetime('now')`,
        article.id,
        article.title,
        article.archetype,
        hash,
        DOCTRINE_SEED.version,
      );
    }
  }

  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0;
    }
    return hash.toString(36);
  }

  _logAnalytics(endpoint, request) {
    try {
      const platform = new URL(request.url).searchParams.get("platform") || null;
      const ua = request.headers.get("user-agent") || null;
      this.sql.exec(
        "INSERT INTO analytics (endpoint, platform, user_agent) VALUES (?, ?, ?)",
        endpoint,
        platform,
        ua,
      );
    } catch {
      // Analytics are best-effort
    }
  }

  _jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
        "X-Sputnik": "chittyadvocate/1.0.0",
        "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
      },
    });
  }
}

// ============================================================================
// WORKER ENTRY — routes to the AdvocateAgent Durable Object
// ============================================================================

export default {
  async fetch(request, env) {
    const id = env.ADVOCATE_AGENT.idFromName("sputnik");
    const agent = env.ADVOCATE_AGENT.get(id);
    return agent.fetch(request);
  },
};
