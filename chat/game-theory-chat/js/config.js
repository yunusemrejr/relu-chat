export const CONFIG = {
  EMBEDDING: { model: 'Xenova/all-MiniLM-L6-v2', quantized: true },
  THRESHOLDS: {
    OFF_TOPIC: 0.15,
    GREETING_FALLBACK: 0.25,
    SECONDARY_ENTRY: 0.38,
    ENTITY_BOOST: 0.45,
    CONFIDENCE: {
      definition: 0.20,
      example: 0.22,
      formal: 0.25,
      application: 0.22,
      comparison: 0.25,
      greeting: 0.30,
      help: 0.30,
    },
  },
  COMPOSITION: {
    FRAGMENT_TEMP: 0.8,
    FRAGMENT_TEMP_BY_CAT: {
      def: 0.5,
      form: 0.4,
      int: 0.8,
      ex: 0.9,
      app: 0.7,
    },
    OPENER_WEIGHT: 0.6,
    MAX_ENTRIES: 3,
  },
  CACHE: { MAX_SIZE: 500 },
};
