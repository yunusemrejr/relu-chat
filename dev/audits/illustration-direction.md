# Relu learning instruments

The site already has a distinctive six-subject colour key, cut corners,
Bricolage Grotesque headings and Atkinson Hyperlegible reading text. Preserve
those choices. Turn the existing flat, randomly seeded plates into precise
instruments that help a reader recognise the subject.

Primary craft reference: [Anatomy](https://skills.wheresryan.sh/anatomy), consulted
from the installed skill, its dial-indicator example, craft and motion references.
Use its physical supports, filled surfaces, four-tone shading, connected details,
static-first rendering and calm motion; adapt the method to the existing vanilla
site. No WebGL or runtime geometry engine is needed.

## Concepts and parts, before geometry

- Activation plot: a plotting instrument carries the real `max(0, x)` curve.
  Case, lower lip, four mounting screws, inset board, nine scale divisions,
  two axis rulers, six subject segments, six indicator collars, zero hinge,
  crosshair carriage, guides and stylus. The existing slider drives the same
  coordinates, output and subject key. A single introductory sweep yields to
  pointer or keyboard input.
- Game theory: a four-cell prisoner's-dilemma payoff board. Base, feet, edge
  trims, screws, four inset cells, eight payoff columns and their collars,
  two player rails, four choice tabs, eight rail ticks, two best-response
  markers and equilibrium bezel. Payoffs are `(3,3), (0,5), (5,0), (1,1)`;
  mutual defection is the equilibrium. Heights represent the payoffs.
- Islamic Golden Age: an astrolabe-inspired teaching instrument, not a
  historical replica or a working sky calculator. Suspension ring, throne,
  layered mater, limb, 72 scale ticks, four latitude-like engraving circles,
  rete, ecliptic ring, six star pointers, rule, sight ends, pivot, rivets and
  supporting cradle. A short rule movement illustrates measurement.
- Data science: a regression drafting plotter. Base, four feet, screws,
  inset plotting sheet, edge rulers and ticks, fitted rail, two rail ends,
  observed-point pins, residual segments, fitted-point collars, pen carriage
  and stylus. The fitted line is computed from the observations by least
  squares. No invented accuracy or performance readout.
- Reinforcement learning: a tabletop grid world. Base, feet, frame, 35
  square tiles, obstacle blocks, route inlay, start socket, agent pawn,
  destination bezel and fasteners. The legal route stays on the board,
  never enters obstacles and ends at the goal. The pawn follows that route.
- Linear algebra: a shear demonstration frame. Base, feet, screws, graph
  sheet, two ruler strips, ticks, original square, transformed lattice,
  basis arms, corner joints, fixed origin and movable corners. The matrix
  is `[[1, 0.6], [0, 1]]`; area and the first basis vector are preserved.
- Web platform: a browser workbench with a mounted main-thread board and
  worker board. Case, feet, screws, two mounted boards, processor sockets,
  processor pins, connected message bus, three task slots, task cards,
  result dock, ventilation slots and status lamps. Message travel explains
  worker handoff; it is a conceptual browser diagram, not literal hardware.

## Placement and motion

Use shared subject plates on the homepage, chat directory/intro, subject hubs,
topic pages, guide cards and standalone covers. Keep full subjects visible with
`meet`, even in wide or narrow slots. Keep article covers static and preserve
the site's existing actual interactive tool canvases. Add a compact five-stage
retrieval-to-render figure to the home and architecture pages. Tool previews
show the algorithm's own mathematical geometry.

Each illustration has one restrained Web Animations sequence, a readable static endpoint
and a replay control on the home subject figures. Movement runs only while a
figure is in view and the document is visible, stops at the end, respects a
site-wide pause control and dynamic reduced-motion preference, and does not
depend on hover. No render loop for decorative figures. Hover is optional
feedback, never required information. Existing content, links, semantics,
model downloads and chat engine remain intact.

## Verification

Check the mathematical/route invariants in the figure models, generated-site
idempotency, existing release checks, desktop/tablet/phone layouts, both themes,
keyboard/range/replay/pause interactions, no-JS and failed-JS fallbacks,
offscreen and hidden-document motion, dynamic reduced motion and browser errors.
Review actual screenshots, intermediate poses and 4x details. Report browser
coverage precisely. Release from one reviewed commit with the existing backup
and manifest workflow; preserve unrelated working-tree changes and runtime state.

## Implemented coverage and visual review

Six subject instruments replace seeded art across the existing page families.
Five additional guide motifs distinguish neural networks, retrieval racks,
branching search, quantization and evaluation. Guide/topic slugs choose these
motifs; no random chart values or performance claims are introduced. All 82
current guide covers regenerate without replacing their article bodies.

Reviewed on 2026-10-11 in Linux Chrome 152 and embedded Chromium 154, with
320, 390, 768 and 1440 px viewports, ink/paper themes, and desktop keyboard
interaction. Safari, Firefox, Edge and physical mobile devices were unavailable
through the browser test connection; their rendering has not been certified.
The implementation uses standard inline SVG and Web Animations, with complete
static fallbacks for missing animation support or JavaScript.

Visual checks covered all eleven instrument compositions, actual route playback,
start/midpoint/end poses and 4x geometry. The enlarged route review caught and
fixed an occlusion defect: floor inlay now paints below obstacles, and the pawn
uses a legal front-edge route that stays clear of wall silhouettes. Tested
layouts had no horizontal overflow or broken images. The ReLU keyboard endpoint
held at `x=4, y=4`; Chrome produced a real Nash-equilibrium chat answer and the
neural-network tool recomputed after weight/activation changes.

Confirmed that global pause stops visible tracks and disables replay, offscreen
figures stop, runtime reduced-motion changes cancel tracks, and no-JS or a
blocked `figures.js` leaves readable static figures with enhancement controls
hidden. A 390 px motion sample under 4x CPU slowdown emulation measured 99 frame
intervals: 16.7 ms median, 34 ms 95th percentile, none over 50 ms. This is a
bounded emulation check, not a physical-device benchmark. Screenshots and raw
browser measurements are local ignored artifacts in
`dev/exports/illustration-review/`.

Final local release checks passed: all 19 `npm test` commands, including the
14 new geometry/motion tests, six-bot checks, policy/WASM parity, deployment
safety and the 319-page site audit. The build is idempotent. A baseline comparison
of all 328 changed HTML pages preserved document titles, H1s, canonical URLs,
meta descriptions and robots directives. All 92 standalone guide SVGs parse as
XML. The two new shared runtime assets total 4,439 bytes gzipped.

Live verification exposed a cached October 4 cover at an unversioned Cloudflare
URL. Its new versioned URL matches the release bytes. The production verifier
now checks immutable images through release-specific URLs, reuses one TLS
connection per worker and retries a dropped connection once. Eight workers keep
the whole-site HTTP sweep bounded; byte hashes, canonical redirects, mutable
asset revalidation and WASM MIME checks remain required. Final release receipts
and HTTP results stay under ignored `dev/exports/`.
