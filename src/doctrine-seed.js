/**
 * Canonical doctrine seed — machine-readable governance bootstrap.
 * Source of truth: chittycanon://doctrine/seed
 *
 * This is the embedded copy. Live version: GET advocate.chitty.cc/seed
 * Upstream template: chittyidentity/platforms/templates/doctrine-bootstrap.json
 */

export const DOCTRINE_SEED = {
  $schema: "chittycanon://doctrine/seed/schema/v1",
  version: "1.0.0",
  canonical_uri: "chittycanon://doctrine/seed",

  identity_model: {
    session_rule: "viewport_not_birth",
    minting_triggers: [
      "domain_fission",
      "derivative",
      "temporal_decay",
      "meta_orchestrator_decision",
    ],
    never_mint_on: [
      "session_start",
      "substrate_switch",
      "db_failure",
      "network_error",
      "device_change",
    ],
    grey_matter_principle:
      "Model is replaceable substrate. Identity lives in coordination layer, not in the model.",
  },

  ontology: {
    entity_types: {
      P: {
        name: "Person",
        definition: "Actor with agency — decides, acts, is accountable",
        characterizations: ["Natural", "Synthetic", "Legal"],
      },
      L: {
        name: "Location",
        definition: "Context in space — jurisdiction, venue, place",
        characterizations: ["Jurisdiction", "Venue", "Address", "Virtual"],
      },
      T: {
        name: "Thing",
        definition: "Object without agency — document, asset, artifact",
        characterizations: ["Document", "Asset", "Artifact", "Account"],
      },
      E: {
        name: "Event",
        definition: "Occurrence in time — transaction, decision, action",
        characterizations: [
          "Transaction",
          "Decision",
          "Action",
          "Filing",
          "Hearing",
        ],
      },
      A: {
        name: "Authority",
        definition: "Source of weight — credential, certification, decision",
        characterizations: ["Granted", "Earned", "Credential", "Certification"],
      },
    },
    rules: [
      "All five types (P/L/T/E/A) must always be present in any validation",
      "AI contexts are Person (P), Synthetic — never Thing (T)",
      "Entity is NOT a valid type value",
      "Workers/services are Thing (T)",
    ],
  },

  lifecycle: {
    context_entity_states: ["fresh", "active", "dormant", "stale", "retired"],
    transitions: {
      fresh: ["active"],
      active: ["dormant", "retired"],
      dormant: ["active", "stale", "retired"],
      stale: ["retired", "dormant"],
      retired: [],
    },
    forbidden_states: [
      "archived",
      "revoked",
      "inactive",
      "deleted",
      "suspended",
    ],
  },

  trust_model: {
    type: "behavioral",
    scoring_dimensions: {
      recency: "Freshness of experience",
      repetition: "Consistency of behavior",
      relation: "Relevance to current context",
      responsibility: "Scope of past accountability",
      response: "Quality of past outputs",
      relevance: "Alignment with current need",
    },
    anti_patterns: [
      "credential_levels_L0_L5",
      "static_assignment",
      "verification_badge",
      "access_control_tier",
    ],
  },

  session_protocol: {
    on_start: [
      "resolve_identity_from_context",
      "never_mint_on_failure",
      "load_doctrine_seed",
      "inherit_trust_and_experience",
      "declare_substrate_platform",
    ],
    on_end: [
      "persist_experience_to_accumulator",
      "log_session_event_to_ledger",
      "queue_sync_to_chittyconnect",
    ],
    self_check_interval: 10,
    self_check_questions: [
      "Am I using the correct ChittyID?",
      "Am I treating myself as Person (P)?",
      "Am I using doctrine lifecycle states?",
      "Have I minted anything I shouldn't have?",
      "Is my trust behavioral?",
    ],
  },

  api_endpoints: {
    doctrine_seed: "GET https://advocate.chitty.cc/seed",
    bootstrap: "GET https://advocate.chitty.cc/bootstrap",
    resolve_context:
      "POST https://connect.chitty.cc/api/v1/context/resolve",
    persist_memory:
      "POST https://connect.chitty.cc/api/v1/memory/persist",
    recall_memory: "POST https://connect.chitty.cc/api/v1/memory/recall",
    health: "GET https://advocate.chitty.cc/health",
  },
};
