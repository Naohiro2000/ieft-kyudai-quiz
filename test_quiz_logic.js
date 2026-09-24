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

// --- Round-building logic (10-question cap + missed-question review rounds) ---
// Mirrors the state machine in index.html's startQuiz/answer/nextBtn handler,
// without the DOM, so the round progression can be asserted directly.
function simulateQuiz(numQuestions, quizSize, correctPattern) {
  // correctPattern(qid, attemptNum) -> bool, lets tests script "wrong then right"
  const questions = Array.from({ length: numQuestions }, (_, i) => ({ id: "q" + i }));
  const firstRoundSize = Math.min(numQuestions, quizSize);
  let queue = questions.slice(0, firstRoundSize);
  let round = 0;
  let correctCount = 0;
  const allAnswers = [];
  const attemptsSeen = {};
  while (queue.length > 0) {
    const missed = [];
    queue.forEach(q => {
      attemptsSeen[q.id] = (attemptsSeen[q.id] || 0) + 1;
      const correct = correctPattern(q.id, attemptsSeen[q.id]);
      if (correct && round === 0) correctCount++;
      allAnswers.push({ qid: q.id, correct });
      if (!correct) missed.push(q);
    });
    queue = missed;
    round++;
  }
  return { firstRoundSize, correctCount, allAnswers, rounds: round };
}

function testRoundLogic() {
  // 15 available questions, cap at 10 -> only 10 make the first round
  let r = simulateQuiz(15, 10, () => true);
  assert(r.firstRoundSize === 10, "quiz caps at QUIZ_SIZE even with more due questions");
  assert(r.rounds === 1, "all-correct run finishes in exactly 1 round");
  assert(r.correctCount === 10, "score counts first-attempt correct answers");

  // Fewer than QUIZ_SIZE due questions -> use them all, no padding
  r = simulateQuiz(4, 10, () => true);
  assert(r.firstRoundSize === 4, "quiz uses fewer than QUIZ_SIZE when that's all that's due");

  // q1 and q3 wrong on first try, then right on review -> 2 rounds, review re-answers them
  r = simulateQuiz(5, 10, (qid, attempt) => !(["q1", "q3"].includes(qid) && attempt === 1));
  assert(r.rounds === 2, "missed questions trigger exactly one review round when they pass on retry");
  assert(r.correctCount === 3, "score only counts first-round correctness, not the review pass");
  assert(r.allAnswers.length === 7, "5 first-round + 2 review re-answers = 7 total POSTed answers");

  console.log("testRoundLogic: all checks passed");
}

demo();
testRoundLogic();
