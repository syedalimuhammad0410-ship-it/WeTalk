// Seeds curated, real external resources (clearly labeled as external in the UI).
import { randomUUID } from 'node:crypto';
import { one, run } from './db.ts';

const R: [string, string, string, string, string[], string, string][] = [
  // title, url, source, kind, skills, domain, difficulty
  ['Khan Academy: Early Math', 'https://www.khanacademy.org/math/early-math', 'Khan Academy', 'course', ['k-count', 'k-add10', 'k-sub10', 'place-value'], 'number', 'Beginner'],
  ['Khan Academy: Arithmetic', 'https://www.khanacademy.org/math/arithmetic', 'Khan Academy', 'course', ['add-2digit', 'sub-2digit', 'mult-facts', 'div-facts', 'multi-digit-mult', 'long-division', 'frac-intro', 'decimals'], 'number', 'Beginner'],
  ['Khan Academy: Algebra 1', 'https://www.khanacademy.org/math/algebra', 'Khan Academy', 'course', ['two-step-eq', 'multi-step-eq', 'slope', 'slope-intercept', 'systems', 'factor-quadratic', 'exponent-rules'], 'algebra', 'School'],
  ['Khan Academy: Geometry', 'https://www.khanacademy.org/math/geometry', 'Khan Academy', 'course', ['angles', 'area-triangle', 'circles', 'volume', 'pythagorean'], 'geometry', 'School'],
  ['Khan Academy: Statistics and Probability', 'https://www.khanacademy.org/math/statistics-probability', 'Khan Academy', 'course', ['mean-median-mode', 'std-dev', 'z-scores', 'simple-prob', 'compound-prob', 'binomial'], 'statistics', 'School'],
  ['Khan Academy: Trigonometry', 'https://www.khanacademy.org/math/trigonometry', 'Khan Academy', 'course', ['trig-ratios', 'unit-circle', 'law-of-sines'], 'trigonometry', 'School'],
  ['Khan Academy: Precalculus', 'https://www.khanacademy.org/math/precalculus', 'Khan Academy', 'course', ['composition', 'complex-numbers', 'vectors', 'geom-series'], 'functions', 'Advanced'],
  ['Khan Academy: Calculus 1', 'https://www.khanacademy.org/math/calculus-1', 'Khan Academy', 'course', ['limits', 'derivative-power', 'derivative-rules', 'optimization'], 'calculus', 'Advanced'],
  ['Khan Academy: Linear Algebra', 'https://www.khanacademy.org/math/linear-algebra', 'Khan Academy', 'course', ['matrix-mult', 'determinants', 'eigenvalues'], 'linear-algebra', 'University'],
  ['3Blue1Brown: Essence of Calculus', 'https://www.3blue1brown.com/topics/calculus', '3Blue1Brown', 'video', ['limits', 'derivative-power', 'derivative-rules', 'integrals-power', 'definite-integrals', 'taylor-series'], 'calculus', 'Advanced'],
  ['3Blue1Brown: Essence of Linear Algebra', 'https://www.3blue1brown.com/topics/linear-algebra', '3Blue1Brown', 'video', ['vectors', 'matrix-mult', 'determinants', 'eigenvalues'], 'linear-algebra', 'University'],
  ["Paul's Online Notes: Calculus I", 'https://tutorial.math.lamar.edu/Classes/CalcI/CalcI.aspx', "Paul's Online Math Notes (Lamar University)", 'article', ['limits', 'derivative-power', 'derivative-rules', 'optimization', 'newtons-method', 'integrals-power'], 'calculus', 'University'],
  ["Paul's Online Notes: Algebra", 'https://tutorial.math.lamar.edu/Classes/Alg/Alg.aspx', "Paul's Online Math Notes (Lamar University)", 'article', ['factor-quadratic', 'quadratic-formula', 'logarithms', 'exponential-growth', 'systems'], 'algebra', 'Advanced'],
  ["Paul's Online Notes: Differential Equations", 'https://tutorial.math.lamar.edu/Classes/DE/DE.aspx', "Paul's Online Math Notes (Lamar University)", 'article', ['separable-ode'], 'calculus', 'University'],
  ["Paul's Online Notes: Calculus III", 'https://tutorial.math.lamar.edu/Classes/CalcIII/CalcIII.aspx', "Paul's Online Math Notes (Lamar University)", 'article', ['partial-derivatives', 'vectors'], 'calculus', 'University'],
  ['MIT OpenCourseWare 18.06: Linear Algebra', 'https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/', 'MIT OpenCourseWare', 'course', ['matrix-mult', 'determinants', 'eigenvalues', 'systems'], 'linear-algebra', 'University'],
  ['MIT OpenCourseWare 18.01SC: Single Variable Calculus', 'https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/', 'MIT OpenCourseWare', 'course', ['limits', 'derivative-power', 'integrals-power', 'definite-integrals', 'integration-by-parts', 'taylor-series'], 'calculus', 'University'],
  ['OpenStax Math Textbooks (free)', 'https://openstax.org/subjects/math', 'OpenStax (Rice University)', 'book', ['frac-add-unlike', 'two-step-eq', 'logarithms', 'mean-median-mode', 'derivative-power'], 'algebra', 'All levels'],
  ['Desmos Graphing Calculator', 'https://www.desmos.com/calculator', 'Desmos', 'tool', ['slope-intercept', 'vertex-form', 'exponential-growth', 'unit-circle', 'coord-plane'], 'functions', 'All levels'],
  ['GeoGebra Classic', 'https://www.geogebra.org/classic', 'GeoGebra', 'tool', ['angles', 'pythagorean', 'distance-midpoint', 'circles', 'vectors'], 'geometry', 'All levels'],
  ['Seeing Theory: A Visual Introduction to Probability and Statistics', 'https://seeing-theory.brown.edu/', 'Brown University', 'interactive', ['simple-prob', 'compound-prob', 'expected-value', 'binomial', 'z-scores'], 'probability', 'School'],
  ['NRICH Mathematics', 'https://nrich.maths.org/', 'University of Cambridge', 'interactive', ['sequences-next', 'logic-puzzles', 'missing-digit', 'primes-factors'], 'puzzles', 'All levels'],
  ['Art of Problem Solving Wiki', 'https://artofproblemsolving.com/wiki/index.php/Main_Page', 'Art of Problem Solving', 'article', ['logic-puzzles', 'counting', 'modular', 'gcd-euclid', 'proofs-induction'], 'discrete', 'Advanced'],
  ['Book of Proof (free textbook)', 'https://www.people.vcu.edu/~rhammack/BookOfProof/', 'Richard Hammack, VCU', 'book', ['logic-truth', 'proofs-induction', 'gcd-euclid', 'real-analysis-sup'], 'discrete', 'University'],
  ['Project Euler', 'https://projecteuler.net/', 'Project Euler', 'interactive', ['primes-factors', 'gcd-euclid', 'modular', 'counting'], 'discrete', 'Advanced'],
  ['Investopedia: Time Value of Money', 'https://www.investopedia.com/terms/t/timevalueofmoney.asp', 'Investopedia', 'article', ['present-value', 'compound-interest', 'mortgage'], 'realworld', 'School'],
  ['Investopedia: Compound Interest', 'https://www.investopedia.com/terms/c/compoundinterest.asp', 'Investopedia', 'article', ['compound-interest', 'simple-interest', 'exponential-growth'], 'realworld', 'School'],
];

export function seed() {
  if (one<{ n: number }>('SELECT COUNT(*) n FROM resources')!.n > 0) return;
  for (const [title, url, source, kind, skills, domain, difficulty] of R) {
    run('INSERT INTO resources (id, title, url, source, kind, skill_ids, domain, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), title, url, source, kind, JSON.stringify(skills), domain, difficulty);
  }
}
