// Self-check for the client-side scoring/shuffle logic in site/index.html.
// Extracted here as pure functions to test without a browser DOM.
// Run: node test_quiz_logic.js

function shuffle_(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildShuffledQuestion(q, rand) {
  const order = shuffle_([0, 1, 2, 3], rand);
  return {
    shuffledChoices: order.map(i => q.choices[i]),
    shuffledCorrectIdx: order.indexOf(q.correct_idx),
  };
}

function assert(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }

// deterministic PRNG for repeatable test
function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function demo() {
  const q = { choices: ["A", "B", "C", "D"], correct_idx: 0 };
  for (let seed = 1; seed <= 50; seed++) {
    const rand = seededRand(seed);
    const r = buildShuffledQuestion(q, rand);
    assert(r.shuffledChoices.length === 4, "shuffled choices must keep all 4");
    assert(new Set(r.shuffledChoices).size === 4, "no duplicate choices after shuffle");
    assert(r.shuffledChoices[r.shuffledCorrectIdx] === "A", "shuffledCorrectIdx must point at the original correct choice");
  }
  console.log("demo: all checks passed");
}

demo();
