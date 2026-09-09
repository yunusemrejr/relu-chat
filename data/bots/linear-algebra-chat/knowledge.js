export const KB_VERSION = '2.0.0';
export const KB_UPDATED = '2026-09-09';
export const KB = [
  {
    "id": "vector",
    "name": "Vector",
    "aliases": [
      "vector",
      "vectors",
      "coordinate",
      "magnitude"
    ],
    "summary": "A vector is an element of a vector space. In coordinates it can be represented by an ordered list of numbers with rules for addition and scalar multiplication.",
    "f": {
      "int": [
        "Coordinates describe a vector relative to a basis; changing basis changes the coordinates, not the underlying vector."
      ],
      "ex": [
        "Adding (1, 2) and (3, −1) gives (4, 1). Multiplying (1, 2) by 3 gives (3, 6)."
      ],
      "form": [
        "In $\\mathbb{R}^n$, vector addition and scalar multiplication act coordinate by coordinate."
      ],
      "app": [
        "Vectors represent features, displacements, signals, and model parameters."
      ],
      "def": [
        "A vector is an element of a vector space. In coordinates it can be represented by an ordered list of numbers with rules for addition and scalar multiplication."
      ]
    },
    "related": [
      "dot-product"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "dot-product",
    "name": "Dot product",
    "aliases": [
      "dot product",
      "inner product",
      "scalar product"
    ],
    "summary": "The Euclidean dot product multiplies corresponding coordinates and sums the products. It measures directional alignment together with magnitude.",
    "f": {
      "int": [
        "A large dot product can result from long vectors, strong alignment, or both. Normalize first when you want only direction."
      ],
      "ex": [
        "(1, 2) · (3, 4) = 1 × 3 + 2 × 4 = 11."
      ],
      "form": [
        "For real vectors, $x^Ty=\\sum_i x_i y_i=\\|x\\|\\|y\\|\\cos\\theta$."
      ],
      "app": [
        "Use dot products in linear models, projections, and similarity search, checking that dimensions and coordinate meanings match."
      ],
      "def": [
        "The Euclidean dot product multiplies corresponding coordinates and sums the products. It measures directional alignment together with magnitude."
      ]
    },
    "related": [
      "vector-norm"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "vector-norm",
    "name": "Vector norm",
    "aliases": [
      "vector norm",
      "length",
      "l2 norm",
      "euclidean norm",
      "l1 norm"
    ],
    "summary": "A norm assigns a nonnegative size to a vector and satisfies definiteness, homogeneity, and the triangle inequality.",
    "f": {
      "int": [
        "The choice of norm determines what counts as a large vector or error."
      ],
      "ex": [
        "For (3, 4), the L2 norm is 5 and the L1 norm is 7."
      ],
      "form": [
        "$\\|x\\|_2=\\sqrt{\\sum_i x_i^2}$ and $\\|x\\|_1=\\sum_i|x_i|$."
      ],
      "app": [
        "Norms measure residual error, regularize model weights, and normalize embeddings."
      ],
      "def": [
        "A norm assigns a nonnegative size to a vector and satisfies definiteness, homogeneity, and the triangle inequality."
      ]
    },
    "related": [
      "matrix-multiplication"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "matrix-multiplication",
    "name": "Matrix multiplication",
    "aliases": [
      "matrix multiplication",
      "matrix product",
      "multiply matrices",
      "matrix"
    ],
    "summary": "Matrix multiplication composes linear maps. Each result entry is a row-column dot product, and the inner dimensions must match.",
    "f": {
      "int": [
        "Applying B and then A corresponds to AB, so the order is significant."
      ],
      "ex": [
        "If A is 2 by 3 and B is 3 by 4, AB is 2 by 4. BA is not defined for those shapes."
      ],
      "form": [
        "For $A\\in\\mathbb{R}^{m\\times n}$ and $B\\in\\mathbb{R}^{n\\times p}$, $(AB)_{ij}=\\sum_k A_{ik}B_{kj}$."
      ],
      "app": [
        "Check tensor shapes before optimizing a neural layer; transposition mistakes can produce plausible but incorrect values."
      ],
      "def": [
        "Matrix multiplication composes linear maps. Each result entry is a row-column dot product, and the inner dimensions must match."
      ]
    },
    "related": [
      "linear-independence"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "linear-independence",
    "name": "Linear independence",
    "aliases": [
      "linear independence",
      "independent vectors",
      "linear dependence"
    ],
    "summary": "Vectors are linearly independent when no nontrivial linear combination of them equals zero.",
    "f": {
      "int": [
        "Each independent vector adds a direction that the others cannot supply."
      ],
      "ex": [
        "(1, 0) and (0, 1) are independent. Adding (1, 1) makes the set dependent because it is their sum."
      ],
      "form": [
        "$\\sum_i c_i v_i=0$ implies every $c_i=0$ for an independent set."
      ],
      "app": [
        "Independence identifies redundant features and determines whether coordinates in a spanning set are unique."
      ],
      "def": [
        "Vectors are linearly independent when no nontrivial linear combination of them equals zero."
      ]
    },
    "related": [
      "basis-span"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "basis-span",
    "name": "Basis and span",
    "aliases": [
      "basis and span",
      "basis",
      "span",
      "dimension"
    ],
    "summary": "The span of vectors contains all their linear combinations. A basis is an independent set that spans a vector space.",
    "f": {
      "int": [
        "A basis is a complete coordinate system without redundant directions."
      ],
      "ex": [
        "(1, 0) and (0, 1) form a basis of the plane. The single vector (1, 1) spans only a line."
      ],
      "form": [
        "Every vector has a unique linear combination in a chosen basis. The number of basis vectors is the dimension."
      ],
      "app": [
        "Choose a basis to simplify a transformation, compress a representation, or interpret feature directions."
      ],
      "def": [
        "The span of vectors contains all their linear combinations. A basis is an independent set that spans a vector space."
      ]
    },
    "related": [
      "matrix-rank"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "matrix-rank",
    "name": "Matrix rank",
    "aliases": [
      "matrix rank",
      "rank",
      "full rank",
      "column space"
    ],
    "summary": "The rank of a matrix is the dimension of its column space, equal to the dimension of its row space.",
    "f": {
      "int": [
        "Rank counts how many independent output directions the matrix can produce."
      ],
      "ex": [
        "The matrix with rows (1, 2) and (2, 4) has rank 1 because one row is twice the other."
      ],
      "form": [
        "For an $m\\times n$ matrix, $\\operatorname{rank}(A)\\leq\\min(m,n)$."
      ],
      "app": [
        "Rank helps detect redundant measurements, singular systems, and the dimension of a low-rank approximation."
      ],
      "def": [
        "The rank of a matrix is the dimension of its column space, equal to the dimension of its row space."
      ]
    },
    "related": [
      "null-space"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "null-space",
    "name": "Null space",
    "aliases": [
      "null space",
      "nullspace",
      "kernel",
      "nullity"
    ],
    "summary": "The null space of A is the set of vectors mapped to zero by A. It is a subspace of the input space.",
    "f": {
      "int": [
        "Null-space directions are information that the transformation loses."
      ],
      "ex": [
        "For A = [1 1], every vector (t, −t) maps to zero, so the null space is a line."
      ],
      "form": [
        "$\\ker(A)=\\{x:Ax=0\\}$. Rank-nullity gives $\\operatorname{rank}(A)+\\operatorname{nullity}(A)=n$ for n columns."
      ],
      "app": [
        "Null-space analysis reveals nonunique solutions and unidentifiable parameter directions."
      ],
      "def": [
        "The null space of A is the set of vectors mapped to zero by A. It is a subspace of the input space."
      ]
    },
    "related": [
      "linear-system"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "linear-system",
    "name": "Linear system",
    "aliases": [
      "linear system",
      "linear equations",
      "ax b",
      "solve system"
    ],
    "summary": "A linear system asks for x satisfying Ax = b. It can have no solution, one solution, or infinitely many.",
    "f": {
      "int": [
        "A solution exists exactly when b lies in the column space of A."
      ],
      "ex": [
        "x + y = 3 and x − y = 1 give x = 2 and y = 1."
      ],
      "form": [
        "If $x_0$ is one solution, all solutions are $x_0+z$ with $z\\in\\ker(A)$."
      ],
      "app": [
        "Use a factorization-based solver for a system; explicitly computing an inverse is usually unnecessary."
      ],
      "def": [
        "A linear system asks for x satisfying Ax = b. It can have no solution, one solution, or infinitely many."
      ]
    },
    "related": [
      "matrix-inverse"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "matrix-inverse",
    "name": "Matrix inverse",
    "aliases": [
      "matrix inverse",
      "inverse",
      "invertible",
      "singular matrix"
    ],
    "summary": "An inverse reverses a square linear transformation. A square matrix is invertible exactly when it has full rank.",
    "f": {
      "int": [
        "A map that collapses different inputs onto one output cannot be uniquely undone."
      ],
      "ex": [
        "The diagonal matrix diag(2, 4) has inverse diag(1/2, 1/4)."
      ],
      "form": [
        "For an invertible square matrix, $A^{-1}A=AA^{-1}=I$."
      ],
      "app": [
        "Use invertibility to reason about uniqueness; for numerical solutions prefer solving Ax = b directly."
      ],
      "def": [
        "An inverse reverses a square linear transformation. A square matrix is invertible exactly when it has full rank."
      ]
    },
    "related": [
      "determinant"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "determinant",
    "name": "Determinant",
    "aliases": [
      "determinant",
      "det",
      "volume scaling"
    ],
    "summary": "The determinant of a square matrix is the signed volume scaling factor of its linear transformation. A zero determinant indicates singularity.",
    "f": {
      "int": [
        "Its sign indicates orientation; its magnitude indicates volume change."
      ],
      "ex": [
        "For rows (2, 1) and (3, 4), det(A) = 2 × 4 − 1 × 3 = 5."
      ],
      "form": [
        "For a 2 by 2 matrix, $\\det(A)=ad-bc$. Also $\\det(AB)=\\det(A)\\det(B)$."
      ],
      "app": [
        "Determinants help with geometry and symbolic analysis; a raw determinant is a poor numerical test of near-singularity."
      ],
      "def": [
        "The determinant of a square matrix is the signed volume scaling factor of its linear transformation. A zero determinant indicates singularity."
      ]
    },
    "related": [
      "eigenvalues-eigenvectors"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "eigenvalues-eigenvectors",
    "name": "Eigenvalues and eigenvectors",
    "aliases": [
      "eigenvalues and eigenvectors",
      "eigenvalue",
      "eigenvector",
      "eigendecomposition"
    ],
    "summary": "An eigenvector is a nonzero vector whose direction is preserved by a square linear map. Its eigenvalue is the corresponding scaling factor.",
    "f": {
      "int": [
        "Most vectors rotate or mix under a map; eigenvectors lie along special invariant directions."
      ],
      "ex": [
        "For diag(2, 3), (1, 0) has eigenvalue 2 and (0, 1) has eigenvalue 3."
      ],
      "form": [
        "$Av=\\lambda v$ with $v\\neq0$. Not every real matrix has a real eigenbasis."
      ],
      "app": [
        "Eigenvalues describe dynamical stability, principal directions of symmetric matrices, and graph properties."
      ],
      "def": [
        "An eigenvector is a nonzero vector whose direction is preserved by a square linear map. Its eigenvalue is the corresponding scaling factor."
      ]
    },
    "related": [
      "orthogonal-projection"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "orthogonal-projection",
    "name": "Orthogonal projection",
    "aliases": [
      "orthogonal projection",
      "projection",
      "orthogonal",
      "perpendicular"
    ],
    "summary": "Orthogonal projection finds the closest vector in a subspace under the Euclidean norm. The residual is perpendicular to that subspace.",
    "f": {
      "int": [
        "It is the shadow of a vector on the directions the subspace can represent."
      ],
      "ex": [
        "Projecting (3, 4) onto the horizontal axis gives (3, 0), with residual (0, 4)."
      ],
      "form": [
        "Onto a nonzero vector u: $\\operatorname{proj}_u(v)=u(u^Tv)/(u^Tu)$."
      ],
      "app": [
        "Projection underlies least squares, feature residualization, and decomposition of a signal into components."
      ],
      "def": [
        "Orthogonal projection finds the closest vector in a subspace under the Euclidean norm. The residual is perpendicular to that subspace."
      ]
    },
    "related": [
      "least-squares"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "least-squares",
    "name": "Least squares",
    "aliases": [
      "least squares",
      "least square",
      "linear regression",
      "normal equation"
    ],
    "summary": "Least squares chooses parameters that minimize the sum of squared residuals when exact agreement may be impossible.",
    "f": {
      "int": [
        "It finds the representable prediction closest to the observations."
      ],
      "ex": [
        "Fitting one constant to observations 1, 2, 6 gives 3, their mean; the residuals sum to zero."
      ],
      "form": [
        "Minimize $\\|Ax-b\\|_2^2$. At a solution, $A^T(Ax-b)=0$; uniqueness requires full column rank."
      ],
      "app": [
        "QR or SVD is often more numerically robust than forming normal equations, which square the condition number."
      ],
      "def": [
        "Least squares chooses parameters that minimize the sum of squared residuals when exact agreement may be impossible."
      ]
    },
    "related": [
      "singular-value-decomposition"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "singular-value-decomposition",
    "name": "Singular value decomposition",
    "aliases": [
      "singular value decomposition",
      "svd",
      "singular values",
      "low rank"
    ],
    "summary": "SVD factors a real matrix into orthogonal directions, nonnegative scale factors, and another orthogonal change of coordinates. It applies to rectangular matrices too.",
    "f": {
      "int": [
        "A linear map can be understood as rotate or reflect, scale, then rotate or reflect."
      ],
      "ex": [
        "For diag(3, 1), keeping only the singular value 3 gives a rank-one approximation diag(3, 0)."
      ],
      "form": [
        "$A=U\\Sigma V^T$. Truncating to the largest k singular values gives a best rank-k approximation in spectral and Frobenius norms."
      ],
      "app": [
        "SVD supports compression, pseudoinverses, least squares, and diagnosing numerical rank."
      ],
      "def": [
        "SVD factors a real matrix into orthogonal directions, nonnegative scale factors, and another orthogonal change of coordinates. It applies to rectangular matrices too."
      ]
    },
    "related": [
      "condition-number"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  },
  {
    "id": "condition-number",
    "name": "Condition number",
    "aliases": [
      "condition number",
      "conditioning",
      "numerical stability",
      "ill conditioned"
    ],
    "summary": "A condition number measures how sensitive a problem solution is to input perturbations. It describes the problem, distinct from algorithmic stability.",
    "f": {
      "int": [
        "A stable algorithm can still produce a sensitive answer when the underlying problem is ill-conditioned."
      ],
      "ex": [
        "diag(1, 0.001) has 2-norm condition number 1000, so some small perturbations can be strongly amplified."
      ],
      "form": [
        "For invertible A, $\\kappa_2(A)=\\sigma_{\\max}/\\sigma_{\\min}$."
      ],
      "app": [
        "Inspect conditioning before blaming precision alone. Scaling, regularization, or changing the formulation may help."
      ],
      "def": [
        "A condition number measures how sensitive a problem solution is to input perturbations. It describes the problem, distinct from algorithmic stability."
      ]
    },
    "related": [
      "vector"
    ],
    "sources": [
      {
        "title": "MIT OpenCourseWare: Linear Algebra",
        "url": "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/"
      }
    ]
  }
];
export function entryText(e) { return `${e.name} ${e.aliases.join(' ')} ${e.summary} ${Object.values(e.f).flat().map(x => typeof x === 'string' ? x : x.text).join(' ')}`; }
