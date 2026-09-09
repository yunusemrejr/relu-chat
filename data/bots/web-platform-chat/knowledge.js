export const KB_VERSION = '2.0.0';
export const KB_UPDATED = '2026-09-09';
export const KB = [
  {
    "id": "webassembly",
    "name": "WebAssembly",
    "aliases": [
      "webassembly",
      "wasm",
      "web assembly"
    ],
    "summary": "WebAssembly is a portable binary instruction format that runs inside a host such as a browser. JavaScript loads modules and provides host capabilities.",
    "f": {
      "int": [
        "WASM is useful for compact numerical kernels, but host calls, copying, and initialization are part of its cost."
      ],
      "ex": [
        "A chatbot can run matrix multiplication in WASM while JavaScript manages the interface and answer selection."
      ],
      "form": [
        "A compiled module defines imports, exports, functions, and optionally linear memory. It does not directly own the browser DOM."
      ],
      "app": [
        "Benchmark the complete operation against JavaScript, including first load. A tiny kernel is not automatically faster."
      ],
      "def": [
        "WebAssembly is a portable binary instruction format that runs inside a host such as a browser. JavaScript loads modules and provides host capabilities."
      ]
    },
    "related": [
      "linear-memory"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "linear-memory",
    "name": "Linear memory",
    "aliases": [
      "linear memory",
      "wasm memory",
      "memory grow",
      "typed array views"
    ],
    "summary": "WebAssembly linear memory is a byte-addressed buffer accessed from JavaScript through typed-array views. Its bounds are checked by the runtime.",
    "f": {
      "int": [
        "Pointers are offsets into a shared buffer, not JavaScript objects. The host and module must agree on layout and ownership."
      ],
      "ex": [
        "A float32 vector of 25 elements occupies 100 bytes. A pointer must be aligned and leave that many bytes in bounds."
      ],
      "form": [
        "After memory growth, recreate JavaScript views as required by the memory type; old views must not be assumed valid."
      ],
      "app": [
        "Use fixed buffers for small inference kernels and explicit bounds checks at the host boundary."
      ],
      "def": [
        "WebAssembly linear memory is a byte-addressed buffer accessed from JavaScript through typed-array views. Its bounds are checked by the runtime."
      ]
    },
    "related": [
      "web-worker"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "web-worker",
    "name": "Web Worker",
    "aliases": [
      "web worker",
      "worker",
      "background thread",
      "workers"
    ],
    "summary": "A Web Worker runs JavaScript in a separate execution context, helping keep long computations away from the main UI thread.",
    "f": {
      "int": [
        "Moving work changes scheduling; it does not remove computation or transfer costs."
      ],
      "ex": [
        "A search worker receives a query, ranks a local index, and sends back the top results while typing stays responsive."
      ],
      "form": [
        "Workers communicate using messages. They cannot directly modify the document DOM."
      ],
      "app": [
        "Move sustained parsing or inference work to a worker when measurements show blocked interaction."
      ],
      "def": [
        "A Web Worker runs JavaScript in a separate execution context, helping keep long computations away from the main UI thread."
      ]
    },
    "related": [
      "transferable-objects"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "transferable-objects",
    "name": "Transferable objects",
    "aliases": [
      "transferable objects",
      "transfer",
      "arraybuffer",
      "postmessage"
    ],
    "summary": "Transferable objects allow ownership of a resource such as an ArrayBuffer to move between contexts without copying the buffer contents.",
    "f": {
      "int": [
        "Transferring a buffer hands it over: the sender cannot keep using it as if it still owned the data."
      ],
      "ex": [
        "worker.postMessage({buffer}, [buffer]) transfers an ArrayBuffer; the sender buffer becomes detached."
      ],
      "form": [
        "The transfer list names resources to transfer, but the message must also expose those resources to the receiver."
      ],
      "app": [
        "Use transfer for large one-way payloads and reuse buffers deliberately to avoid allocation churn."
      ],
      "def": [
        "Transferable objects allow ownership of a resource such as an ArrayBuffer to move between contexts without copying the buffer contents."
      ]
    },
    "related": [
      "service-worker"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "service-worker",
    "name": "Service worker",
    "aliases": [
      "service worker",
      "service workers",
      "offline",
      "pwa"
    ],
    "summary": "A service worker is an event-driven script that can intercept requests within its scope and support offline behavior. It is separate from a page worker.",
    "f": {
      "int": [
        "It can serve cached assets when the network is unavailable, but its process may stop between events."
      ],
      "ex": [
        "A previously visited lesson can load from Cache Storage while offline; an unvisited lesson may still be unavailable."
      ],
      "form": [
        "Service workers normally require a secure context; localhost is a development exception. Extend asynchronous event work with event.waitUntil."
      ],
      "app": [
        "Design installation, activation, updates, and offline failure pages together so a cached shell does not promise missing content."
      ],
      "def": [
        "A service worker is an event-driven script that can intercept requests within its scope and support offline behavior. It is separate from a page worker."
      ]
    },
    "related": [
      "cache-strategies"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "cache-strategies",
    "name": "Cache strategies",
    "aliases": [
      "cache strategies",
      "cache first",
      "network first",
      "stale while revalidate"
    ],
    "summary": "A cache strategy chooses when to read stored responses and when to request fresh content. Different assets need different freshness rules.",
    "f": {
      "int": [
        "A model with a content-versioned URL can be reused; an editable HTML page should get a chance to update."
      ],
      "ex": [
        "Use cache-first for versioned model bytes, network-first for navigation, and a bounded fallback if the network fails."
      ],
      "form": [
        "Stale-while-revalidate returns a cached response immediately while updating it in the background. The update must be tied to the event lifetime."
      ],
      "app": [
        "Do not cache failed responses, sensitive API writes, or partial range responses as full files."
      ],
      "def": [
        "A cache strategy chooses when to read stored responses and when to request fresh content. Different assets need different freshness rules."
      ]
    },
    "related": [
      "http-caching"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "http-caching",
    "name": "HTTP caching",
    "aliases": [
      "http caching",
      "cache control",
      "etag",
      "304",
      "revalidation"
    ],
    "summary": "HTTP caching uses response headers and validators to control reuse by browsers and intermediaries. It is separate from service-worker Cache Storage.",
    "f": {
      "int": [
        "A service-worker cache miss may still receive an old response from the browser HTTP cache if freshness rules allow it."
      ],
      "ex": [
        "Cache-Control: no-cache allows storage but requires revalidation; no-store asks caches not to store the response."
      ],
      "form": [
        "ETag and If-None-Match can produce 304 Not Modified responses when the stored representation is still current."
      ],
      "app": [
        "Give content-hashed files long lifetimes; revalidate mutable policy weights, manifests, and HTML."
      ],
      "def": [
        "HTTP caching uses response headers and validators to control reuse by browsers and intermediaries. It is separate from service-worker Cache Storage."
      ]
    },
    "related": [
      "indexeddb"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "indexeddb",
    "name": "IndexedDB",
    "aliases": [
      "indexeddb",
      "indexed db",
      "browser database",
      "local persistence"
    ],
    "summary": "IndexedDB is an asynchronous transactional database for structured browser data. It supports keys, indexes, and large records.",
    "f": {
      "int": [
        "Use it for durable local records, not as a synchronous global variable. Storage may be restricted or evicted."
      ],
      "ex": [
        "A chatbot stores public knowledge embeddings keyed by the model and knowledge-content hash, avoiding repeated encoding on later visits."
      ],
      "form": [
        "Transactions commit asynchronously. Resolve a write only on transaction completion, and handle aborts and version changes."
      ],
      "app": [
        "Treat cache failure as recoverable, bound storage growth, and provide clear controls for any personal data you persist."
      ],
      "def": [
        "IndexedDB is an asynchronous transactional database for structured browser data. It supports keys, indexes, and large records."
      ]
    },
    "related": [
      "promises-async-functions"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "promises-async-functions",
    "name": "Promises and async functions",
    "aliases": [
      "promises and async functions",
      "promise",
      "async await",
      "asynchronous"
    ],
    "summary": "A Promise represents eventual completion or failure. An async function returns a Promise, and await pauses that function until a value settles.",
    "f": {
      "int": [
        "Await does not move CPU work to another thread. A long synchronous loop still blocks interaction."
      ],
      "ex": [
        "Awaiting fetch lets other work run while data arrives; parsing a huge JSON string afterward still uses the current thread."
      ],
      "form": [
        "A rejected promise must be handled through await with try/catch or a rejection handler."
      ],
      "app": [
        "Start independent requests together, then await their results. Keep dependent mutations in the required order."
      ],
      "def": [
        "A Promise represents eventual completion or failure. An async function returns a Promise, and await pauses that function until a value settles."
      ]
    },
    "related": [
      "event-loop"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "event-loop",
    "name": "Event loop",
    "aliases": [
      "event loop",
      "microtask",
      "task",
      "main thread"
    ],
    "summary": "The browser event loop coordinates tasks, microtasks, and rendering opportunities. Long-running JavaScript can delay user input and painting.",
    "f": {
      "int": [
        "A page may have received the click but still feel frozen while a computation occupies its main thread."
      ],
      "ex": [
        "A self-perpetuating chain of microtasks can delay rendering even though each callback is short."
      ],
      "form": [
        "Promise reactions run as microtasks; timers queue tasks. Neither provides a hard real-time scheduling guarantee."
      ],
      "app": [
        "Break up expensive work or move it to a worker. Measure interaction delay alongside raw computation speed."
      ],
      "def": [
        "The browser event loop coordinates tasks, microtasks, and rendering opportunities. Long-running JavaScript can delay user input and painting."
      ]
    },
    "related": [
      "abortcontroller"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "abortcontroller",
    "name": "AbortController",
    "aliases": [
      "abortcontroller",
      "abort",
      "cancel fetch",
      "timeout"
    ],
    "summary": "AbortController signals cancellation to operations that support AbortSignal, including fetch. Cancellation is cooperative.",
    "f": {
      "int": [
        "Ignoring an old result is useful, but aborting can also avoid spending resources on a request that is no longer needed."
      ],
      "ex": [
        "Create a controller for a search request and abort it when a newer search replaces it."
      ],
      "form": [
        "Pass controller.signal to fetch and call controller.abort(). Distinguish cancellation from failures that need an error message."
      ],
      "app": [
        "Use bounded fetches for optional model assets so a stalled request does not disable the basic experience."
      ],
      "def": [
        "AbortController signals cancellation to operations that support AbortSignal, including fetch. Cancellation is cooperative."
      ]
    },
    "related": [
      "content-security-policy"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "content-security-policy",
    "name": "Content Security Policy",
    "aliases": [
      "content security policy",
      "csp",
      "script src",
      "connect src"
    ],
    "summary": "Content Security Policy restricts which sources and execution forms a page may use. It can reduce the impact of script injection.",
    "f": {
      "int": [
        "A policy is an additional defense; unsafe insertion of untrusted HTML is still a bug."
      ],
      "ex": [
        "connect-src can limit model and API requests to the same origin, while script-src limits executable script sources."
      ],
      "form": [
        "Deliver CSP through an HTTP response header. Directives such as script-src, connect-src, and frame-ancestors control different capabilities."
      ],
      "app": [
        "Test actual modules, WASM, workers, and styles before enforcing a changed policy."
      ],
      "def": [
        "Content Security Policy restricts which sources and execution forms a page may use. It can reduce the impact of script injection."
      ]
    },
    "related": [
      "cross-origin-isolation"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "cross-origin-isolation",
    "name": "Cross-origin isolation",
    "aliases": [
      "cross-origin isolation",
      "coop",
      "coep",
      "sharedarraybuffer"
    ],
    "summary": "Cross-origin isolation is a browser state enabled by compatible opener and embedder policies. It allows capabilities such as shared memory in supported contexts.",
    "f": {
      "int": [
        "It is a page-wide resource-loading contract, not merely a switch for faster inference."
      ],
      "ex": [
        "A page can use COOP: same-origin and COEP: require-corp, then check crossOriginIsolated before enabling threaded WASM."
      ],
      "form": [
        "Cross-origin subresources may need CORS or a suitable Cross-Origin-Resource-Policy header to load under COEP."
      ],
      "app": [
        "Provide a single-thread fallback and inspect blocked fonts, images, and scripts after enabling isolation."
      ],
      "def": [
        "Cross-origin isolation is a browser state enabled by compatible opener and embedder policies. It allows capabilities such as shared memory in supported contexts."
      ]
    },
    "related": [
      "accessible-form"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "accessible-form",
    "name": "Accessible form",
    "aliases": [
      "accessible form",
      "accessibility",
      "label",
      "keyboard",
      "aria"
    ],
    "summary": "An accessible form gives controls meaningful labels, supports keyboard use, and exposes feedback without relying only on color.",
    "f": {
      "int": [
        "A visible placeholder disappears as someone types; a programmatic label remains available to assistive technology."
      ],
      "ex": [
        "A chat composer has a labeled textarea, a named Send button, and a polite live region for completed answers."
      ],
      "form": [
        "Use native form controls first. Enter-to-send logic must respect IME composition and preserve Shift+Enter for multiline input."
      ],
      "app": [
        "Check focus visibility, touch targets, zoom, and errors with the actual interaction rather than only auditing markup."
      ],
      "def": [
        "An accessible form gives controls meaningful labels, supports keyboard use, and exposes feedback without relying only on color."
      ]
    },
    "related": [
      "responsive-layout"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "responsive-layout",
    "name": "Responsive layout",
    "aliases": [
      "responsive layout",
      "responsive",
      "viewport",
      "mobile",
      "media query"
    ],
    "summary": "Responsive layout adapts to available space, input methods, and user settings. It includes content behavior as well as breakpoints.",
    "f": {
      "int": [
        "A mobile chat needs room for the keyboard and composer, not just a narrower desktop layout."
      ],
      "ex": [
        "Use min-width: 0 on flexible children and overflow-wrap for long URLs so a message does not widen the viewport."
      ],
      "form": [
        "Dynamic viewport units such as dvh follow changing browser UI; provide a compatible fallback where needed."
      ],
      "app": [
        "Test narrow screens, landscape, large text, and reduced motion with real content."
      ],
      "def": [
        "Responsive layout adapts to available space, input methods, and user settings. It includes content behavior as well as breakpoints."
      ]
    },
    "related": [
      "performance-measurement"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  },
  {
    "id": "performance-measurement",
    "name": "Performance measurement",
    "aliases": [
      "performance measurement",
      "latency",
      "p95",
      "benchmark",
      "cold start"
    ],
    "summary": "Performance measurement separates startup, steady-state work, and user-visible response time. One fast average can hide expensive first visits.",
    "f": {
      "int": [
        "Downloading, parsing, compilation, computation, and rendering all contribute to waiting."
      ],
      "ex": [
        "Report a cold first visit separately from a warm cached visit, and include p95 query time across varied inputs."
      ],
      "form": [
        "Use monotonic performance timing for durations. State device, runtime, sample count, cache state, and percentile method."
      ],
      "app": [
        "Compare equivalent workloads and include failed requests. Optimize the measured bottleneck before adding a new runtime."
      ],
      "def": [
        "Performance measurement separates startup, steady-state work, and user-visible response time. One fast average can hide expensive first visits."
      ]
    },
    "related": [
      "webassembly"
    ],
    "sources": [
      {
        "title": "MDN Web Docs",
        "url": "https://developer.mozilla.org/en-US/docs/Web"
      }
    ]
  }
];
export function entryText(e) { return `${e.name} ${e.aliases.join(' ')} ${e.summary} ${Object.values(e.f).flat().map(x => typeof x === 'string' ? x : x.text).join(' ')}`; }
