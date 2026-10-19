// MathNest — search, topic browser and practice quiz.

const TOPICS = [
  { icon: "➗", name: "Fractions", tag: "Arithmetic", blurb: "Add, subtract, multiply and divide fractions — plus converting between fractions, decimals and percents." },
  { icon: "📐", name: "Geometry basics", tag: "Geometry", blurb: "Angles, triangles, quadrilaterals and circles — what the formulas mean and when to use them." },
  { icon: "🧮", name: "Order of operations", tag: "Arithmetic", blurb: "PEMDAS from the ground up, with the traps that trick everyone on tests." },
  { icon: "❎", name: "Linear equations", tag: "Algebra", blurb: "Solve equations like 3x + 7 = 22 step by step, then move on to equations with variables on both sides." },
  { icon: "🛞", name: "Quadratic formula", tag: "Algebra", blurb: "When factoring fails, the quadratic formula saves the day. Includes the discriminant and what it tells you." },
  { icon: "📏", name: "Pythagorean theorem", tag: "Geometry", blurb: "a² + b² = c² — right triangles, finding missing sides and spotting Pythagorean triples." },
  { icon: "📈", name: "Slope & graphing lines", tag: "Algebra", blurb: "Slope-intercept form, point-slope form and how to sketch a line from two points." },
  { icon: "🔢", name: "Percentages", tag: "Arithmetic", blurb: "Percent of a number, percent change, markups, discounts and the classic increase/decrease traps." },
  { icon: "✖️", name: "Exponents & radicals", tag: "Algebra", blurb: "The laws of exponents, simplifying square roots and rational exponents." },
  { icon: "📊", name: "Statistics basics", tag: "Data", blurb: "Mean, median and mode — plus when each one is misleading." },
  { icon: "🎲", name: "Probability", tag: "Data", blurb: "From coin flips to dice to independent events — probability without the hand-waving." },
  { icon: "🧠", name: "Word problems", tag: "Strategy", blurb: "A repeatable strategy: define variables, translate sentences to equations, solve, sanity-check." },
];

const QUIZ = [
  { q: "Solve: 3x + 7 = 22", options: ["x = 3", "x = 5", "x = 7", "x = 15"], answer: 1, explain: "Subtract 7: 3x = 15. Divide by 3: x = 5." },
  { q: "What is 15% of 80?", options: ["8", "10.5", "12", "15"], answer: 2, explain: "0.15 × 80 = 12." },
  { q: "A right triangle has legs 6 and 8. What is the hypotenuse?", options: ["10", "12", "14", "100"], answer: 0, explain: "6² + 8² = 36 + 64 = 100, so c = √100 = 10." },
  { q: "Simplify: (x³)²", options: ["x⁵", "x⁶", "x⁸", "2x³"], answer: 1, explain: "Power of a power: multiply exponents — 3 × 2 = 6, so x⁶." },
  { q: "What is the slope of the line through (1, 2) and (5, 10)?", options: ["1/2", "2", "4", "8"], answer: 1, explain: "(10 − 2) / (5 − 1) = 8 / 4 = 2." },
];

// ---------- Search ----------

const form = document.getElementById("searchForm");
const input = document.getElementById("searchInput");
const results = document.getElementById("searchResults");
const hint = document.getElementById("searchHint");

if (window.matchMedia("(max-width: 520px)").matches) {
  input.placeholder = "Search math topics…";
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (q === "67") {
    window.location.href = "vault.html";
    return;
  }
  renderSearch(q);
});

function renderSearch(q) {
  if (!q) { results.hidden = true; return; }
  const needle = q.toLowerCase();
  const hits = TOPICS.filter(
    (t) =>
      t.name.toLowerCase().includes(needle) ||
      t.blurb.toLowerCase().includes(needle) ||
      t.tag.toLowerCase().includes(needle)
  );
  results.hidden = false;
  if (hits.length === 0) {
    results.innerHTML = "";
    const p = document.createElement("p");
    p.className = "no-results";
    p.textContent = `No topics matched “${q}”. Try “fractions”, “slope” or “percentages”.`;
    results.appendChild(p);
    return;
  }
  results.innerHTML = "";
  const count = document.createElement("p");
  count.className = "result-count";
  count.textContent = `${hits.length} topic${hits.length > 1 ? "s" : ""} found`;
  results.appendChild(count);
  for (const t of hits) {
    const div = document.createElement("div");
    div.className = "result-item";
    const strong = document.createElement("strong");
    strong.textContent = t.name;
    const span = document.createElement("span");
    span.textContent = t.blurb;
    div.appendChild(strong);
    div.appendChild(span);
    results.appendChild(div);
  }
}

// ---------- Topic grid ----------

const grid = document.getElementById("topicGrid");
for (const t of TOPICS) {
  const card = document.createElement("article");
  card.className = "topic-card";
  const icon = document.createElement("div");
  icon.className = "topic-icon";
  icon.textContent = t.icon;
  const h3 = document.createElement("h3");
  h3.textContent = t.name;
  const p = document.createElement("p");
  p.textContent = t.blurb;
  const tag = document.createElement("span");
  tag.className = "topic-tag";
  tag.textContent = t.tag;
  card.append(icon, h3, p, tag);
  grid.appendChild(card);
}

// ---------- Quiz ----------

const quizEl = document.getElementById("quiz");
let quizIndex = 0;
let quizScore = 0;

function renderQuestion() {
  const item = QUIZ[quizIndex];
  quizEl.innerHTML = "";
  const card = document.createElement("div");
  card.className = "quiz-card";

  const meta = document.createElement("div");
  meta.className = "quiz-meta";
  const left = document.createElement("span");
  left.textContent = `Question ${quizIndex + 1} of ${QUIZ.length}`;
  const right = document.createElement("span");
  right.textContent = `Score: ${quizScore}`;
  meta.append(left, right);

  const q = document.createElement("div");
  q.className = "quiz-question";
  q.textContent = item.q;

  const opts = document.createElement("div");
  opts.className = "quiz-options";
  const feedback = document.createElement("div");
  feedback.className = "quiz-feedback";

  let answered = false;
  item.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.type = "button";
    btn.textContent = opt;
    btn.addEventListener("click", () => {
      if (answered) return;
      answered = true;
      const correct = i === item.answer;
      if (correct) quizScore++;
      for (const [j, b] of [...opts.children].entries()) {
        b.disabled = true;
        if (j === item.answer) b.classList.add("correct");
        else if (j === i && !correct) b.classList.add("wrong");
      }
      feedback.textContent = (correct ? "Correct — " : "Not quite — ") + item.explain;
      feedback.className = "quiz-feedback " + (correct ? "ok" : "no");
      actions.style.visibility = "visible";
      right.textContent = `Score: ${quizScore}`;
    });
    opts.appendChild(btn);
  });

  const actions = document.createElement("div");
  actions.className = "quiz-actions";
  actions.style.visibility = "hidden";
  const score = document.createElement("span");
  score.className = "quiz-score";
  const next = document.createElement("button");
  next.className = "quiz-next";
  next.textContent = quizIndex === QUIZ.length - 1 ? "See results" : "Next question";
  next.addEventListener("click", () => {
    quizIndex++;
    if (quizIndex < QUIZ.length) renderQuestion();
    else renderQuizFinal();
  });
  actions.append(score, next);

  card.append(meta, q, opts, feedback, actions);
  quizEl.appendChild(card);
}

function renderQuizFinal() {
  quizEl.innerHTML = "";
  const card = document.createElement("div");
  card.className = "quiz-card quiz-final";
  const big = document.createElement("div");
  big.className = "big";
  big.textContent = `${quizScore} / ${QUIZ.length}`;
  const msg = document.createElement("p");
  msg.textContent =
    quizScore === QUIZ.length ? "Perfect score — you're ready for the test."
    : quizScore >= 3 ? "Solid! Review the ones you missed and go again."
    : "Worth another pass — every retry makes it stick.";
  const restart = document.createElement("button");
  restart.className = "quiz-restart";
  restart.type = "button";
  restart.textContent = "Try again";
  restart.addEventListener("click", () => {
    quizIndex = 0;
    quizScore = 0;
    renderQuestion();
  });
  card.append(big, msg, restart);
  quizEl.appendChild(card);
}

renderQuestion();

document.getElementById("year").textContent = new Date().getFullYear();
