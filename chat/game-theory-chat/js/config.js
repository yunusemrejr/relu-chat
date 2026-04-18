export const CONFIG = {
  EMBEDDING: { model: 'Xenova/all-MiniLM-L6-v2', quantized: true },
  THRESHOLDS: {
    OFF_TOPIC: 0.18,
    GREETING_FALLBACK: 0.30,
    SECONDARY_ENTRY: 0.42,
    ENTITY_BOOST: 0.50,
  },
  COMPOSITION: {
    FRAGMENT_TEMP: 0.5,
    OPENER_WEIGHT: 0.6,
    MAX_ENTRIES: 3,
  },
  CACHE: { MAX_SIZE: 500 },
};
