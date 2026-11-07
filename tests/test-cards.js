const assert = require("assert");
const store = {};
globalThis.chrome = {
  runtime: {},
  storage: { local: {
    get: (k, cb) => setTimeout(() => cb({ [k]: store[k] ? JSON.parse(JSON.stringify(store[k])) : undefined }), 0),
    set: (o, cb) => setTimeout(() => { Object.assign(store, JSON.parse(JSON.stringify(o))); cb && cb(); }, 0),
  } },
};
const C = require(require("path").join(__dirname, "..", "cards.js"));
const MIN = 60e3, DAY = 864e5;

(async () => {
  // --- scheduling rules from the project description ---
  assert.strictEqual(C.REPEAT_MS < MIN, true, "repeat is under 1 minute");
  assert.strictEqual(C.HARD_MS, 3 * MIN);
  assert.strictEqual(C.NORMAL_MS, 10 * MIN);
  let card = { goodCount: 0 };
  const now = 1_000_000;
  assert.strictEqual(C.schedule(card, "repeat", now).due, now + C.REPEAT_MS);
  assert.strictEqual(C.schedule(card, "hard", now).due, now + 3 * MIN);
  assert.strictEqual(C.schedule(card, "normal", now).due, now + 10 * MIN);
  const expected = { 1: DAY, 2: DAY, 3: DAY, 4: DAY, 5: 7 * DAY, 8: 7 * DAY, 10: 7 * DAY, 11: 30 * DAY, 25: 30 * DAY };
  for (const [n, ms] of Object.entries(expected)) {
    assert.strictEqual(C.goodInterval(Number(n)), ms, `good x${n}`);
  }
  // pressing Good repeatedly walks day -> week -> month
  let c = { goodCount: 0 };
  const seen = [];
  for (let i = 0; i < 11; i++) { c = C.schedule(c, "good", now); seen.push((c.due - now) / DAY); }
  assert.deepStrictEqual(seen, [1, 1, 1, 1, 7, 7, 7, 7, 7, 7, 30]);
  assert.strictEqual(c.goodCount, 11);
  // other ratings never touch goodCount
  assert.strictEqual(C.schedule({ goodCount: 6 }, "hard", now).goodCount, 6);
  // preview for the Good button uses the next count without mutating
  const probe = { goodCount: 4 };
  assert.strictEqual(C.intervalFor(probe, "good"), 7 * DAY);
  assert.strictEqual(probe.goodCount, 4);
  assert.throws(() => C.intervalFor({}, "nope"));
  // labels
  assert.strictEqual(C.formatInterval(C.REPEAT_MS), "<1 min");
  assert.strictEqual(C.formatInterval(3 * MIN), "3 min");
  assert.strictEqual(C.formatInterval(DAY), "1 day");
  assert.strictEqual(C.formatInterval(7 * DAY), "1 week");
  assert.strictEqual(C.formatInterval(30 * DAY), "1 month");
  assert.strictEqual(C.formatCountdown(32_000), "32s");

  // --- storage: folders and cards ---
  let d = await C.load();
  assert.deepStrictEqual(d.folders.map((f) => f.id), ["default"]);
  const food = await C.addFolder("Food");
  assert.strictEqual((await C.addFolder("  food ")).id, food.id, "folder names are unique ignoring case");
  await assert.rejects(C.addFolder("   "));

  const r1 = await C.addCard({ front: "사과", back: "apple", folderId: food.id });
  assert.strictEqual(r1.duplicate, false);
  assert.ok(r1.card.due <= Date.now(), "new cards are due right away");
  const r2 = await C.addCard({ front: "사과", back: "apple", folderId: food.id });
  assert.strictEqual(r2.duplicate, true, "same word, same folder = duplicate");
  const r3 = await C.addCard({ front: "사과", back: "apple", folderId: "default" });
  assert.strictEqual(r3.duplicate, false, "same word in another folder is allowed");
  const r4 = await C.addCard({ front: "물", back: "water", folderId: "does-not-exist" });
  assert.strictEqual(r4.card.folderId, "default", "unknown folder falls back to Default");

  // concurrent writes must not lose data
  await Promise.all(["a", "b", "c", "d", "e"].map((w) => C.addCard({ front: w, folderId: "default" })));
  d = await C.load();
  assert.strictEqual(d.cards.length, 4 + 5 - 1 + 0, "5 concurrent adds all stored");

  // due queue + folder filter
  const future = await C.updateCard(r1.card.id, C.schedule(r1.card, "good"));
  d = await C.load();
  assert.ok(!C.dueCards(d.cards, food.id).some((x) => x.id === future.id), "rated card leaves the queue");
  assert.strictEqual(C.dueCards(d.cards, "all").length, d.cards.length - 1);
  assert.strictEqual(C.dueCards(d.cards, food.id).length, 0);

  // rename / delete folder moves cards to Default
  await C.renameFolder(food.id, "Food & drink");
  await assert.rejects(C.renameFolder(food.id, "default"), /already exists/);
  await C.deleteFolder(food.id);
  d = await C.load();
  assert.ok(!d.folders.some((f) => f.id === food.id));
  assert.ok(d.cards.every((x) => d.folders.some((f) => f.id === x.folderId)), "no orphaned cards");
  await assert.rejects(C.deleteFolder("default"));

  await C.deleteCard(r4.card.id);
  d = await C.load();
  assert.ok(!d.cards.some((x) => x.id === r4.card.id));
  console.log("cards.js tests passed (" + d.cards.length + " cards left)");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
