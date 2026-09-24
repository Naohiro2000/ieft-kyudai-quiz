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
  return { order, shuffledCorrectIdx: order.indexOf(Number(q.correct_idx)) };
}
const render = (q, sq, lang) => sq.order.map(i => (lang === "en" ? q.choices_en : q.choices)[i]);

function assert(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }

// deterministic PRNG for repeatable test
function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function demo() {
  const q = { choices: ["A", "B", "C", "D"], choices_en: ["a", "b", "c", "d"], correct_idx: "0" }; // Sheets may return "0"
  for (let seed = 1; seed <= 50; seed++) {
    const rand = seededRand(seed);
    const r = buildShuffledQuestion(q, rand);
    const ja = render(q, r, "ja"), en = render(q, r, "en");
    assert(new Set(ja).size === 4, "no duplicate choices after shuffle");
    assert(ja[r.shuffledCorrectIdx] === "A", "shuffledCorrectIdx must point at the original correct choice");
    assert(en[r.shuffledCorrectIdx] === "a", "switching language mid-question keeps the same correct slot");
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

// --- 7:1:2 tier mix (copy of pickRound_ in index.html) ---
const TIER_MIX = { basic:7, adv:1, trivia:2 };
function pickRound_(questions, size) {
  const pools = {};
  questions.forEach(q => (pools[q.tier || "basic"] ||= []).push(q));
  const picked = [];
  for (const [tier, n] of Object.entries(TIER_MIX)) picked.push(...(pools[tier] || []).splice(0, n));
  for (const tier of Object.keys(TIER_MIX)) picked.push(...(pools[tier] || []).splice(0, size - picked.length));
  return picked.slice(0, size);
}
function testTierMix() {
  const mk = (tier, n) => Array.from({ length: n }, (_, i) => ({ id: tier + i, tier }));
  const count = (qs, t) => qs.filter(q => q.tier === t).length;
  let r = pickRound_([...mk("basic", 40), ...mk("adv", 20), ...mk("trivia", 15)], 10);
  assert(r.length === 10 && count(r, "basic") === 7 && count(r, "adv") === 1 && count(r, "trivia") === 2, "full pools -> exactly 7:1:2");
  r = pickRound_([...mk("basic", 3), ...mk("adv", 20), ...mk("trivia", 15)], 10);
  assert(r.length === 10 && count(r, "basic") === 3, "short basic pool is backfilled so the round stays 10");
  r = pickRound_([...mk("basic", 2), ...mk("trivia", 1)], 10);
  assert(r.length === 3, "fewer due than 10 -> use all");
  assert(new Set(pickRound_(mk("basic", 30), 10).map(q => q.id)).size === 10, "no duplicates");
  console.log("testTierMix: all checks passed");
}

// --- client-side streak (copy of nextStreak in index.html; must match GAS) ---
function nextStreak(last, streak, today) {
  if (!last) return 1;
  if (last === today) return streak;
  const y = new Date(today + "T00:00:00Z"); y.setUTCDate(y.getUTCDate() - 1);
  return last === y.toISOString().slice(0, 10) ? streak + 1 : 1;
}
function testStreak() {
  assert(nextStreak("", 0, "2026-10-01") === 1, "first ever -> 1");
  assert(nextStreak("2026-10-01", 3, "2026-10-01") === 3, "same day keeps");
  assert(nextStreak("2026-09-30", 3, "2026-10-01") === 4, "yesterday across month boundary +1");
  assert(nextStreak("2026-12-31", 5, "2027-01-01") === 6, "across year boundary +1");
  assert(nextStreak("2026-09-28", 3, "2026-10-01") === 1, "gap resets");
  console.log("testStreak: all checks passed");
}

// --- mastery points (copy of pointsDelta in index.html; must mirror GAS Leitner) ---
function pointsDelta(startBoxes, answers) {
  const box = { ...startBoxes };
  const before = Object.values(box).reduce((a, b) => a + b, 0);
  answers.forEach(a => { box[a.qid] = a.correct ? Math.min((box[a.qid] || 0) + 1, 5) : 1; });
  return Object.values(box).reduce((a, b) => a + b, 0) - before;
}
function testPoints() {
  assert(pointsDelta({ a: 0, b: 0 }, [{ qid: "a", correct: true }, { qid: "b", correct: true }]) === 2, "two new correct = +2");
  assert(pointsDelta({ a: 5 }, [{ qid: "a", correct: true }]) === 0, "box5 capped");
  assert(pointsDelta({ a: 4 }, [{ qid: "a", correct: false }]) === -3, "wrong drops to box1");
  assert(pointsDelta({ a: 0 }, [{ qid: "a", correct: false }, { qid: "a", correct: true }]) === 2, "miss then review = box2");
  console.log("testPoints: all checks passed");
}

// --- review round must start unanswered (copy of shuffleQuiz_ in index.html) ---
function shuffleQuiz_(questions) {
  return questions.map(q => {
    const order = shuffle_([0, 1, 2, 3], Math.random);
    return { ...q, order, shuffledCorrectIdx: order.indexOf(Number(q.correct_idx)), selectedIdx: null };
  });
}
function testReviewReset() {
  const missed = shuffleQuiz_([{ id: "q1", correct_idx: 0 }]);
  missed[0].selectedIdx = 2; // answered wrong in round 1
  const review = shuffleQuiz_(missed);
  assert(review[0].selectedIdx === null, "review round question must not carry the previous answer");
  console.log("testReviewReset: all checks passed");
}

demo();
testReviewReset();
testRoundLogic();
testTierMix();
testStreak();
testPoints();
